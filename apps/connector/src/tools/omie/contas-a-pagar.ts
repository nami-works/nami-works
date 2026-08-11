import { z } from "zod";
import {
  describeOmieCompanies,
  fetchCategoriaMap,
  getOmieCompanies,
  omieAmbiguousPrompt,
  resolveClienteName,
  resolveOmieCompanies,
  type OmieClient,
  type OmieCompany,
} from "../../clients/omie.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";
import {
  aggregateItems,
  filterByTipo,
  GROUP_BY_VALUES,
  TIPO_VALUES,
  type AggregatableItem,
  type GroupByKey,
  type TipoFlag,
} from "./aggregation.js";

type ContaPagar = {
  codigo_lancamento_omie: number;
  codigo_cliente_fornecedor?: number;
  codigo_categoria?: string | null;
  numero_documento: string | null;
  data_vencimento: string; // dd/mm/yyyy
  data_pagamento?: string | null; // dd/mm/yyyy, only set once PAGO
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
// ListarContasReceber which does support DATA_VENCIMENTO). Since CODIGO order
// isn't reliably correlated with due date, a windowed pull walks the FULL
// ledger (bounded only by Omie's own total_de_paginas) and filters client-side
// — there's no safe early-stop heuristic here. SAFETY_MAX_PAGES is a pure
// runaway guard, not a real limit: if it's ever hit the response says so
// loudly rather than silently truncating.
// registros_por_pagina=100 (paired with the ordenar_por/ordem_descrescente
// params below) is the configuration already verified live against real Omie
// data earlier this session — do not change either without re-verifying live;
// a prior attempt at 200-per-page with no sort params silently returned zero
// rows for a large company (Matriz), most likely because Omie honored a
// smaller real page size than requested while still reporting total_de_paginas
// against the requested size, tripping the "partial page = last page" check
// after page 1.
const WINDOW_PAGE_SIZE = 100;
const SAFETY_MAX_PAGES = 2000;

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

// Windowed fetch: walks the FULL ledger (no due-date sort available for
// contapagar — see module comment) and keeps rows whose baseData field falls
// in [desde, ate]. Stops only at true ledger exhaustion or the safety valve.
async function fetchApWindow(
  client: OmieClient,
  filters: { codigo?: number; cnpj?: string },
  desde: string,
  ate: string,
  baseData: "vencimento" | "pagamento",
): Promise<{ items: ContaPagar[]; capped: boolean }> {
  const items: ContaPagar[] = [];
  let pagina = 1;
  for (; pagina <= SAFETY_MAX_PAGES; pagina += 1) {
    const res = await client.call<
      Record<string, unknown>,
      ListarContasPagarResponse
    >({
      resource: "financas/contapagar",
      method: "ListarContasPagar",
      param: {
        pagina,
        registros_por_pagina: WINDOW_PAGE_SIZE,
        apenas_importado_api: "N",
        // No longer relied on for early-stopping (see module comment — CODIGO
        // order isn't reliably tied to due date), but kept because it's the
        // proven-working query shape; dropping it was bundled into the
        // regression described on WINDOW_PAGE_SIZE above.
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

    for (const row of page) {
      const dateField = baseData === "pagamento" ? row.data_pagamento : row.data_vencimento;
      if (!dateField) continue;
      const ymd = brToYmd(dateField);
      if (ymd >= desde && ymd <= ate) items.push(row);
    }

    const totalPaginas = res.data.total_de_paginas;
    if (page.length < WINDOW_PAGE_SIZE || (totalPaginas !== undefined && pagina >= totalPaginas)) {
      pagina += 1;
      break;
    }
  }
  return { items, capped: pagina > SAFETY_MAX_PAGES };
}

export async function contasAPagarHandler(
  args: {
    empresa?: string | string[] | undefined;
    codigoFornecedor?: number | undefined;
    cnpjFornecedor?: string | undefined;
    desde?: string | undefined;
    ate?: string | undefined;
    baseData?: "vencimento" | "pagamento" | undefined;
    groupBy?: GroupByKey[] | undefined;
    excluir?: TipoFlag[] | undefined;
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
  const groupBy = args.groupBy;
  if (groupBy && !hasWindow) {
    return {
      content: [{ type: "text", text: "groupBy requer desde/ate (o agregado é sempre sobre uma janela)." }],
      isError: true,
    };
  }
  const baseData = args.baseData ?? "vencimento";

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

  type CompanyResult = {
    block: string | null;
    p: number;
    v: number;
    pago: number;
    hasItems: boolean;
    capped: boolean;
    aggItems: AggregatableItem[];
  };

  async function processCompany(co: OmieCompany): Promise<CompanyResult> {
    const name = co.label ?? co.code;
    const filters = {
      ...(args.codigoFornecedor !== undefined ? { codigo: args.codigoFornecedor } : {}),
      ...(cnpj !== undefined ? { cnpj } : {}),
    };
    const { items, totalRegistros, capped } = hasWindow
      ? { ...(await fetchApWindow(co.client, filters, args.desde!, args.ate!, baseData)), totalRegistros: undefined }
      : await fetchApForSupplier(co.client, filters);

    const tag = multi ? `— ${name} —` : null;
    if (items.length === 0) {
      return {
        block: tag ? `${tag}\nSem lançamentos${windowLabel ? " no período" : ""}.` : null,
        p: 0,
        v: 0,
        pago: 0,
        hasItems: false,
        capped,
        aggItems: [],
      };
    }

    // Category + supplier names — one categoria fetch per company, cached;
    // supplier names resolved on demand and cached per unique code.
    const categoriaMap = await fetchCategoriaMap(co.client);
    const nomeCache = new Map<number, string>();

    let aPagar = 0;
    let vencido = 0;
    let pago = 0;
    const aggItems: AggregatableItem[] = [];
    for (const item of items) {
      // Omie uses "A VENCER" for not-yet-due — do NOT match on bare "venc"
      // (that would miscount future titles as overdue). Only VENCIDO/ATRASADO.
      const status = item.status_titulo === "PAGO"
        ? "pago"
        : /vencid|atrasad/i.test(item.status_titulo)
          ? "vencido"
          : "aberto"; // A_PAGAR, "A VENCER", etc.
      if (status === "pago") pago += item.valor_documento;
      else if (status === "vencido") vencido += item.valor_documento;
      else aPagar += item.valor_documento;

      if (groupBy) {
        aggItems.push({
          empresaCodigo: co.code,
          empresaLabel: name,
          empresaClient: co.client,
          categoriaDescricao: item.codigo_categoria
            ? (categoriaMap.get(item.codigo_categoria) ?? item.codigo_categoria)
            : "(sem categoria)",
          categoriaCodigoRaw: item.codigo_categoria ?? null,
          fornecedorCodigo: item.codigo_cliente_fornecedor ?? null,
          dataVencimento: brToYmd(item.data_vencimento),
          valor: item.valor_documento,
          status,
        });
      }
    }

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
      ? ` (janela pode estar incompleta — limite de segurança de ${SAFETY_MAX_PAGES} páginas atingido; isso não deveria acontecer em uso normal)`
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
    return { block: `${head}\n${lines.join("\n")}`, p: aPagar, v: vencido, pago, hasItems: true, capped, aggItems };
  }

  const perCompany = await Promise.all(selected.map(processCompany));

  const blocks: string[] = [];
  let grandP = 0;
  let grandV = 0;
  let grandPago = 0;
  let anyItems = false;
  let anyCapped = false;
  const allAggItems: AggregatableItem[] = [];
  for (const result of perCompany) {
    if (result.block) blocks.push(result.block);
    grandP += result.p;
    grandV += result.v;
    grandPago += result.pago;
    if (result.hasItems) anyItems = true;
    if (result.capped) anyCapped = true;
    allAggItems.push(...result.aggItems);
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

  if (groupBy) {
    const filtered = filterByTipo(allAggItems, args.excluir);
    const { rows: consolidated, fornecedorTruncated } = await aggregateItems(filtered, groupBy);

    let porEmpresa: Record<string, ReturnType<typeof Array.prototype.slice>> | undefined;
    if (multi && !groupBy.includes("empresa")) {
      const byEmpresa: Record<string, AggregatableItem[]> = {};
      for (const item of filtered) {
        (byEmpresa[item.empresaLabel] ??= []).push(item);
      }
      porEmpresa = {};
      for (const [label, itemsForEmpresa] of Object.entries(byEmpresa)) {
        const { rows } = await aggregateItems(itemsForEmpresa, groupBy);
        porEmpresa[label] = rows;
      }
    }

    const payload = {
      window: { desde: args.desde, ate: args.ate, baseData },
      escopo: { empresas: selected.map((c) => c.label ?? c.code), excluir: args.excluir ?? [] },
      groupBy,
      consolidado: consolidated,
      ...(porEmpresa ? { porEmpresa } : {}),
      warnings: [
        ...(anyCapped ? ["Uma ou mais empresas atingiram o limite de segurança de páginas — ver campo capped por empresa."] : []),
        ...(fornecedorTruncated
          ? [`groupBy inclui fornecedor com mais de ${allAggItems.length > 0 ? "40" : "0"} fornecedores no período — cauda longa agregada em "Outros" (valor preservado, nomes não).`]
          : []),
      ],
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2),
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
    ? "\n\n⚠ Uma ou mais empresas atingiram o limite de segurança de páginas — total pode estar incompleto (isso não deveria acontecer em uso normal; avise o time)."
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
    "Contas a pagar no Omie por empresa (fornecedores). Informe `cnpjFornecedor` (exato) ou `codigoFornecedor` para focar num fornecedor; sem filtro, resume a carteira de pagáveis. Informe `desde`/`ate` (ISO YYYY-MM-DD) para escopar por data — sem eles, mantém o comportamento antigo (carteira inteira, sem janela). Janela sempre percorre o ledger inteiro (sem sort nativo por vencimento no Omie para contapagar), então empresas grandes podem levar dezenas de segundos. `groupBy` (categoria|fornecedor|empresa|mes, aceita lista para cross-tab) retorna um agregado estruturado (JSON) em vez do resumo em texto — use para rankear custos por categoria/fornecedor. `excluir` filtra tipos (intercompany|imposto|estorno|externo) do agregado, ex. excluir=['intercompany','imposto'] para gasto externo puro. `empresa` aceita um nome ou vários. Obs: NFS-e de serviço não têm DANFE/XML dentro do Omie.",
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
      .describe('Data inicial (ISO YYYY-MM-DD). Requer `ate` junto.'),
    ate: z
      .string()
      .regex(ISO_DATE, "use formato ISO YYYY-MM-DD")
      .optional()
      .describe('Data final (ISO YYYY-MM-DD). Requer `desde` junto.'),
    baseData: z
      .enum(["vencimento", "pagamento"])
      .optional()
      .describe(
        "Campo de data usado para a janela: 'vencimento' (padrão) ou 'pagamento' (data em que foi efetivamente pago).",
      ),
    groupBy: z
      .array(z.enum(GROUP_BY_VALUES as [GroupByKey, ...GroupByKey[]]))
      .optional()
      .describe(
        "Agrega o período por uma ou mais dimensões (categoria, fornecedor, empresa, mes) e retorna JSON estruturado em vez de texto. Requer desde/ate.",
      ),
    excluir: z
      .array(z.enum(TIPO_VALUES as [TipoFlag, ...TipoFlag[]]))
      .optional()
      .describe(
        "Só com groupBy: exclui lançamentos classificados como esses tipos (intercompany, imposto, estorno, externo) do agregado retornado.",
      ),
  },
  handler: contasAPagarHandler,
});
