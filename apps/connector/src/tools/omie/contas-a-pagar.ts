import { z } from "zod";
import {
  describeOmieCompanies,
  fetchCategoriaMap,
  getOmieCompanies,
  omieAmbiguousPrompt,
  resolveClienteName,
  resolveOmieCompanies,
  type OmieClient,
} from "../../clients/omie.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

type ContaPagar = {
  codigo_lancamento_omie: number;
  codigo_cliente_fornecedor?: number;
  codigo_categoria?: string | null;
  numero_documento: string | null;
  data_vencimento: string; // dd/mm/yyyy
  valor_documento: number;
  status_titulo: "PAGO" | "A_PAGAR" | "VENCIDO" | string;
  observacao: string | null;
};
type ListarContasPagarResponse = {
  conta_pagar_cadastro?: ContaPagar[];
  total_de_paginas?: number;
  total_de_registros?: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Without a supplier filter we walk the whole payables ledger, capped.
const ALL_MAX_PAGES = 15;
// Windowed fetch: ListarContasPagar has NO due-date sort (only CODIGO /
// CODIGO_INTEGRACAO — verified against Omie's live docs, unlike
// ListarContasReceber which does support DATA_VENCIMENTO). Sorting
// descending by CODIGO is the best available proxy for "most recent" since
// it's Omie's internal entry-order id and bills are normally entered near
// their due date. We stop once a run of pages in a row contributes nothing
// to the window, on the assumption we've paged past it into older history.
const WINDOW_MAX_PAGES = 30;
const STOP_AFTER_EMPTY_PAGES = 3;

function brToYmd(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : br;
}

async function fetchApForSupplier(
  client: OmieClient,
  filters: { codigo?: number; cnpj?: string },
): Promise<{ items: ContaPagar[]; totalRegistros: number; capped: boolean }> {
  const scoped = filters.codigo !== undefined || filters.cnpj !== undefined;
  const maxPages = scoped ? 5 : ALL_MAX_PAGES;
  const items: ContaPagar[] = [];
  let totalRegistros = 0;

  for (let pagina = 1; pagina <= maxPages; pagina += 1) {
    const res = await client.call<
      Record<string, unknown>,
      ListarContasPagarResponse
    >({
      resource: "financas/contapagar",
      method: "ListarContasPagar",
      param: {
        pagina,
        registros_por_pagina: 200,
        apenas_importado_api: "N",
        ...(filters.codigo !== undefined
          ? { filtrar_cliente: filters.codigo }
          : {}),
        ...(filters.cnpj !== undefined
          ? { filtrar_por_cpf_cnpj: filters.cnpj }
          : {}),
      },
    });
    if (!res.ok) {
      if (/n[ãa]o existem registros/i.test(res.faultstring)) break;
      throw new Error(`Omie ListarContasPagar failed: ${res.faultstring}`);
    }
    const page = res.data.conta_pagar_cadastro ?? [];
    items.push(...page);
    totalRegistros = res.data.total_de_registros ?? totalRegistros;
    const totalPaginas = res.data.total_de_paginas;
    if (
      page.length === 0 ||
      page.length < 200 || // partial page = last page
      (totalPaginas !== undefined && pagina >= totalPaginas)
    ) {
      break;
    }
  }
  return { items, totalRegistros: totalRegistros || items.length, capped: false };
}

// Windowed fetch: descending by CODIGO (most-recently-entered first), keep
// rows whose data_vencimento falls in [desde, ate], stop once several pages
// in a row add nothing to the window (having already seen at least one hit).
async function fetchApWindow(
  client: OmieClient,
  filters: { codigo?: number; cnpj?: string },
  desde: string,
  ate: string,
): Promise<{ items: ContaPagar[]; capped: boolean }> {
  const items: ContaPagar[] = [];
  let seenAnyInWindow = false;
  let consecutiveEmpty = 0;
  let pagina = 1;
  for (; pagina <= WINDOW_MAX_PAGES; pagina += 1) {
    const res = await client.call<
      Record<string, unknown>,
      ListarContasPagarResponse
    >({
      resource: "financas/contapagar",
      method: "ListarContasPagar",
      param: {
        pagina,
        registros_por_pagina: 100,
        apenas_importado_api: "N",
        ordenar_por: "CODIGO",
        ordem_descrescente: "S",
        ...(filters.codigo !== undefined
          ? { filtrar_cliente: filters.codigo }
          : {}),
        ...(filters.cnpj !== undefined
          ? { filtrar_por_cpf_cnpj: filters.cnpj }
          : {}),
      },
    });
    if (!res.ok) {
      if (/n[ãa]o existem registros/i.test(res.faultstring)) break;
      throw new Error(`Omie ListarContasPagar failed: ${res.faultstring}`);
    }
    const page = res.data.conta_pagar_cadastro ?? [];
    if (page.length === 0) break;

    let hitsThisPage = 0;
    for (const row of page) {
      const ymd = brToYmd(row.data_vencimento);
      if (ymd >= desde && ymd <= ate) {
        items.push(row);
        hitsThisPage += 1;
      }
    }
    if (hitsThisPage > 0) {
      seenAnyInWindow = true;
      consecutiveEmpty = 0;
    } else if (seenAnyInWindow) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= STOP_AFTER_EMPTY_PAGES) {
        pagina += 1; // count this page as fetched before breaking
        break;
      }
    }

    const totalPaginas = res.data.total_de_paginas;
    if (page.length < 100 || (totalPaginas !== undefined && pagina >= totalPaginas)) {
      pagina += 1;
      break;
    }
  }
  return { items, capped: pagina > WINDOW_MAX_PAGES };
}

export async function contasAPagarHandler(
  args: {
    empresa?: string | string[] | undefined;
    codigoFornecedor?: number | undefined;
    cnpjFornecedor?: string | undefined;
    desde?: string | undefined;
    ate?: string | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const hasWindow = args.desde !== undefined || args.ate !== undefined;
  if (hasWindow) {
    if (!args.desde || !args.ate) {
      return {
        content: [{ type: "text", text: "Informe desde E ate juntos (ISO YYYY-MM-DD), ou nenhum dos dois." }],
        isError: true,
      };
    }
    if (!ISO_DATE.test(args.desde) || !ISO_DATE.test(args.ate)) {
      return {
        content: [{ type: "text", text: "desde/ate devem estar em formato ISO YYYY-MM-DD." }],
        isError: true,
      };
    }
  }

  const companies = await getOmieCompanies({ ssmPrefix: ctx.tenant.ssmPrefix });
  const resolution = resolveOmieCompanies(companies, args.empresa);
  if (resolution.kind === "ambiguous") {
    return { content: [{ type: "text", text: omieAmbiguousPrompt(companies) }] };
  }
  if (resolution.kind === "notfound") {
    return {
      content: [
        {
          type: "text",
          text: `Empresa(s) não encontrada(s): ${resolution.requested.join(", ")}. Opções:\n${describeOmieCompanies(companies)}`,
        },
      ],
      isError: true,
    };
  }
  const selected = resolution.companies;
  const multi = selected.length > 1;
  const cnpj = args.cnpjFornecedor
    ? args.cnpjFornecedor.replace(/\D/g, "")
    : undefined;
  const scoped = args.codigoFornecedor !== undefined || cnpj !== undefined;
  const scopeLabel = cnpj
    ? `fornecedor CNPJ ${args.cnpjFornecedor}`
    : args.codigoFornecedor !== undefined
      ? `fornecedor ${args.codigoFornecedor}`
      : "todos os fornecedores";
  const windowLabel = hasWindow ? ` · ${args.desde} a ${args.ate}` : "";

  const blocks: string[] = [];
  let grandP = 0;
  let grandV = 0;
  let grandPago = 0;
  let anyItems = false;
  let anyCapped = false;

  for (const co of selected) {
    const name = co.label ?? co.code;
    const filters = {
      ...(args.codigoFornecedor !== undefined ? { codigo: args.codigoFornecedor } : {}),
      ...(cnpj !== undefined ? { cnpj } : {}),
    };
    const { items, totalRegistros, capped } = hasWindow
      ? { ...(await fetchApWindow(co.client, filters, args.desde!, args.ate!)), totalRegistros: undefined }
      : await fetchApForSupplier(co.client, filters);
    if (capped) anyCapped = true;

    const tag = multi ? `— ${name} —` : null;
    if (items.length === 0) {
      if (tag) blocks.push(`${tag}\nSem lançamentos${windowLabel ? " no período" : ""}.`);
      continue;
    }
    anyItems = true;

    // Category + supplier names — one categoria fetch per company, cached;
    // supplier names resolved on demand and cached per unique code.
    const categoriaMap = await fetchCategoriaMap(co.client);
    const nomeCache = new Map<number, string>();

    let aPagar = 0;
    let vencido = 0;
    let pago = 0;
    for (const item of items) {
      // Omie uses "A VENCER" for not-yet-due — do NOT match on bare "venc"
      // (that would miscount future titles as overdue). Only VENCIDO/ATRASADO.
      if (item.status_titulo === "PAGO") pago += item.valor_documento;
      else if (/vencid|atrasad/i.test(item.status_titulo))
        vencido += item.valor_documento;
      else aPagar += item.valor_documento; // A_PAGAR, "A VENCER", etc.
    }
    grandP += aPagar;
    grandV += vencido;
    grandPago += pago;

    const lineCount = multi ? 10 : 25;
    const sorted = items
      .slice()
      .sort((x, y) => brToYmd(x.data_vencimento).localeCompare(brToYmd(y.data_vencimento)));
    const lines: string[] = [];
    for (const item of sorted.slice(0, lineCount)) {
      const num = item.numero_documento ?? `#${item.codigo_lancamento_omie}`;
      const forn =
        !scoped && item.codigo_cliente_fornecedor
          ? `${await resolveClienteName(co.client, item.codigo_cliente_fornecedor, nomeCache)} · `
          : "";
      const categoria = item.codigo_categoria
        ? ` · ${categoriaMap.get(item.codigo_categoria) ?? item.codigo_categoria}`
        : "";
      lines.push(
        `  ${forn}${num} · vence ${item.data_vencimento} · R$ ${item.valor_documento.toFixed(2)} · ${item.status_titulo}${categoria}`,
      );
    }

    const cappedNote = capped
      ? ` (janela pode estar incompleta — ${WINDOW_MAX_PAGES} páginas percorridas sem esgotar o período; refine o filtro)`
      : "";
    const loadedNote =
      !hasWindow && totalRegistros !== undefined && totalRegistros > items.length
        ? ` (mostrando ${lineCount} de ${items.length} carregados; ledger tem ${totalRegistros})`
        : items.length > lineCount
          ? ` (mostrando ${lineCount} de ${items.length})`
          : "";
    const totalsLabel = hasWindow ? " no período" : "";
    const head = [
      tag,
      `A pagar${totalsLabel}: R$ ${aPagar.toFixed(2)} · Vencido: R$ ${vencido.toFixed(2)} · Pago: R$ ${pago.toFixed(2)}`,
      `Lançamentos (por vencimento)${loadedNote}${cappedNote}:`,
    ]
      .filter((s): s is string => s !== null)
      .join("\n");
    blocks.push(`${head}\n${lines.join("\n")}`);
  }

  if (!anyItems) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum lançamento a pagar para ${scopeLabel}${windowLabel}${multi ? " nas empresas selecionadas" : ""}.`,
        },
      ],
    };
  }

  const single = !multi ? ` · ${selected[0]!.label ?? selected[0]!.code}` : "";
  const grandLabel = hasWindow ? " no período" : "";
  const grand = multi
    ? `\n\nTotal consolidado${grandLabel} — A pagar: R$ ${grandP.toFixed(2)} · Vencido: R$ ${grandV.toFixed(2)} · Pago: R$ ${grandPago.toFixed(2)}`
    : "";
  const cappedWarning = anyCapped
    ? "\n\n⚠ Uma ou mais empresas atingiram o limite de páginas antes de esgotar o período — total pode estar incompleto."
    : "";

  return {
    content: [
      {
        type: "text",
        text: `Contas a pagar · ${scopeLabel}${windowLabel}${single}\n\n${blocks.join("\n\n")}${grand}${cappedWarning}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "omie_contas_a_pagar",
  description:
    "Contas a pagar no Omie por empresa (fornecedores). Informe `cnpjFornecedor` (exato) ou `codigoFornecedor` para focar num fornecedor; sem filtro, resume a carteira de pagáveis. Informe `desde`/`ate` (ISO YYYY-MM-DD) para escopar por DATA DE VENCIMENTO — sem eles, mantém o comportamento antigo (carteira inteira, sem janela). `empresa` aceita um nome ou vários. Cada lançamento retorna nome do fornecedor e categoria (não só códigos). Retorna a pagar/vencido/pago por empresa + total consolidado. Obs: NFS-e de serviço não têm DANFE/XML dentro do Omie.",
  inputSchema: {
    cnpjFornecedor: z
      .string()
      .optional()
      .describe(
        "CNPJ/CPF do fornecedor (aceita máscara). Filtro exato — jeito preferido de focar num fornecedor.",
      ),
    codigoFornecedor: z
      .number()
      .int()
      .optional()
      .describe("codigo_cliente_omie do fornecedor (se você já tem o código)."),
    empresa: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Nome da empresa Omie (ex: 'Matriz') ou lista. Omita para escolher via pergunta quando houver mais de uma.",
      ),
    desde: z
      .string()
      .regex(ISO_DATE, "use formato ISO YYYY-MM-DD")
      .optional()
      .describe('Data de vencimento inicial (ISO YYYY-MM-DD). Requer `ate` junto.'),
    ate: z
      .string()
      .regex(ISO_DATE, "use formato ISO YYYY-MM-DD")
      .optional()
      .describe('Data de vencimento final (ISO YYYY-MM-DD). Requer `desde` junto.'),
  },
  handler: contasAPagarHandler,
});
