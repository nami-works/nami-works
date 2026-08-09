import { z } from "zod";
import {
  type B2BRegistryEntry,
  describeOmieCompanies,
  fetchCategoriaMap,
  getB2BRegistry,
  getOmieCompanies,
  omieAmbiguousPrompt,
  resolveClienteName,
  resolveOmieCompanies,
  resolveRegistryEntry,
  type OmieClient,
  type OmieCompany,
} from "../../clients/omie.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

type ContaReceber = {
  codigo_lancamento_omie: number;
  codigo_cliente_fornecedor?: number;
  codigo_categoria?: string | null;
  numero_documento: string | null;
  data_vencimento: string; // dd/mm/yyyy
  valor_documento: number;
  status_titulo: "RECEBIDO" | "A_RECEBER" | "VENCIDO" | string;
  observacao: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// When no client is specified we walk the whole receivables ledger, capped so a
// large company doesn't turn into dozens of throttled Omie calls. 15 pages ×
// 200 = 3000 entries; if there are more, the response says so.
const ALL_CLIENTS_MAX_PAGES = 15;
// Windowed fetch: ListarContasReceber DOES support ordenar_por=DATA_VENCIMENTO
// (verified against Omie's live docs — unlike ListarContasPagar, which only
// sorts by CODIGO). Descending due-date order means once a row's due date
// falls before `desde` we can stop immediately — every later row is older.
const WINDOW_MAX_PAGES = 30;

type ListarContasReceberResponse = {
  conta_receber_cadastro?: ContaReceber[];
  total_de_paginas?: number;
  total_de_registros?: number;
};

function brToYmd(br: string): string {
  // dd/mm/yyyy → yyyy-mm-dd. If parsing fails, returns the input unchanged.
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : br;
}

function normName(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function registryCodigoFor(
  entry: B2BRegistryEntry,
  co: OmieCompany,
): number | undefined {
  const target = [normName(co.label ?? co.code), normName(co.code)];
  const key = Object.keys(entry.codigos).find((k) =>
    target.includes(normName(k)),
  );
  return key ? entry.codigos[key] : undefined;
}

// Accounts-receivable for one Omie company. Single page when scoped to a client;
// paginated (capped) when walking the whole ledger. No date window.
async function fetchArForClient(
  client: OmieClient,
  codigoCliente: number | undefined,
): Promise<{ items: ContaReceber[]; totalRegistros: number; capped: boolean }> {
  const scoped = typeof codigoCliente === "number";
  const maxPages = scoped ? 1 : ALL_CLIENTS_MAX_PAGES;
  const items: ContaReceber[] = [];
  let totalRegistros = 0;

  for (let pagina = 1; pagina <= maxPages; pagina += 1) {
    const res = await client.call<
      Record<string, unknown>,
      ListarContasReceberResponse
    >({
      resource: "financas/contareceber",
      method: "ListarContasReceber",
      param: {
        pagina,
        registros_por_pagina: 200,
        apenas_importado_api: "N",
        // Omie's contareceber client filter is `filtrar_cliente` (NOT
        // `filtrar_por_cliente`, which is silently ignored).
        ...(scoped ? { filtrar_cliente: codigoCliente } : {}),
      },
    });
    if (!res.ok) {
      if (/n[ãa]o existem registros/i.test(res.faultstring)) break;
      throw new Error(`Omie ListarContasReceber failed: ${res.faultstring}`);
    }
    const page = res.data.conta_receber_cadastro ?? [];
    items.push(...page);
    totalRegistros = res.data.total_de_registros ?? totalRegistros;
    const totalPaginas = res.data.total_de_paginas;
    if (
      page.length === 0 ||
      (totalPaginas !== undefined && pagina >= totalPaginas)
    ) {
      break;
    }
  }
  return { items, totalRegistros: totalRegistros || items.length, capped: false };
}

// Windowed fetch: descending by DATA_VENCIMENTO (native sort). Skip rows
// due after `ate` (haven't reached the window yet), keep rows in [desde,
// ate], and stop the instant a row's due date falls before `desde` — sort
// order guarantees everything after it is older still.
async function fetchArWindow(
  client: OmieClient,
  codigoCliente: number | undefined,
  desde: string,
  ate: string,
): Promise<{ items: ContaReceber[]; capped: boolean }> {
  const scoped = typeof codigoCliente === "number";
  const items: ContaReceber[] = [];
  let pagina = 1;
  let pastWindow = false;
  for (; pagina <= WINDOW_MAX_PAGES; pagina += 1) {
    const res = await client.call<
      Record<string, unknown>,
      ListarContasReceberResponse
    >({
      resource: "financas/contareceber",
      method: "ListarContasReceber",
      param: {
        pagina,
        registros_por_pagina: 100,
        apenas_importado_api: "N",
        ordenar_por: "DATA_VENCIMENTO",
        ordem_descrescente: "S",
        ...(scoped ? { filtrar_cliente: codigoCliente } : {}),
      },
    });
    if (!res.ok) {
      if (/n[ãa]o existem registros/i.test(res.faultstring)) break;
      throw new Error(`Omie ListarContasReceber failed: ${res.faultstring}`);
    }
    const page = res.data.conta_receber_cadastro ?? [];
    if (page.length === 0) break;

    for (const row of page) {
      const ymd = brToYmd(row.data_vencimento);
      if (ymd > ate) continue; // still ahead of the window, keep going
      if (ymd < desde) {
        pastWindow = true;
        break; // descending order — everything from here is older still
      }
      items.push(row);
    }
    if (pastWindow) {
      pagina += 1;
      break;
    }
    const totalPaginas = res.data.total_de_paginas;
    if (page.length < 100 || (totalPaginas !== undefined && pagina >= totalPaginas)) {
      pagina += 1;
      break;
    }
  }
  return { items, capped: !pastWindow && pagina > WINDOW_MAX_PAGES };
}

export async function consultarFinanceiroHandler(
  args: {
    empresa?: string | string[] | undefined;
    codigoCliente?: number | undefined;
    nome?: string | undefined;
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

  // Resolve a customer name to per-company códigos via the registry (no Omie call).
  const nome = args.nome?.trim();
  let registryEntry: B2BRegistryEntry | null = null;
  if (nome && typeof args.codigoCliente !== "number") {
    const registry = await getB2BRegistry({ ssmPrefix: ctx.tenant.ssmPrefix });
    registryEntry = resolveRegistryEntry(registry, nome);
    if (!registryEntry) {
      return {
        content: [
          {
            type: "text",
            text: `Não encontrei "${nome}" no registro B2B. Use omie_consultar_cliente(nome="${nome}") para localizar o cliente, ou passe codigoCliente.`,
          },
        ],
      };
    }
  }

  const companies = await getOmieCompanies({ ssmPrefix: ctx.tenant.ssmPrefix });
  let selected: OmieCompany[];
  if (registryEntry && args.empresa == null) {
    const keys = new Set(Object.keys(registryEntry.codigos).map(normName));
    selected = companies.filter(
      (c) => keys.has(normName(c.label ?? c.code)) || keys.has(normName(c.code)),
    );
    if (selected.length === 0) selected = companies;
  } else {
    const resolution = resolveOmieCompanies(companies, args.empresa);
    if (resolution.kind === "ambiguous") {
      return {
        content: [{ type: "text", text: omieAmbiguousPrompt(companies) }],
      };
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
    selected = resolution.companies;
  }
  const multi = selected.length > 1;
  const scopedToClient =
    registryEntry != null || typeof args.codigoCliente === "number";
  const scopeLabel = registryEntry
    ? `cliente ${registryEntry.nome}`
    : typeof args.codigoCliente === "number"
      ? `cliente ${args.codigoCliente}`
      : "todos os clientes";
  const windowLabel = hasWindow ? ` · ${args.desde} a ${args.ate}` : "";

  const blocks: string[] = [];
  let grandA = 0;
  let grandV = 0;
  let grandR = 0;
  let anyItems = false;
  let anyCapped = false;

  for (const co of selected) {
    const name = co.label ?? co.code;
    const codigo = registryEntry
      ? registryCodigoFor(registryEntry, co)
      : args.codigoCliente;
    if (registryEntry && typeof codigo !== "number") {
      if (multi) blocks.push(`— ${name} —\nSem cadastro nesta empresa.`);
      continue;
    }
    const { items, totalRegistros, capped } = hasWindow
      ? { ...(await fetchArWindow(co.client, codigo, args.desde!, args.ate!)), totalRegistros: undefined }
      : await fetchArForClient(co.client, codigo);
    if (capped) anyCapped = true;

    const tag = multi ? `— ${name} —` : null;
    if (items.length === 0) {
      if (tag) blocks.push(`${tag}\nSem lançamentos${windowLabel ? " no período" : ""}.`);
      continue;
    }
    anyItems = true;

    const categoriaMap = await fetchCategoriaMap(co.client);
    const nomeCache = new Map<number, string>();

    let a = 0;
    let v = 0;
    let r = 0;
    for (const item of items) {
      if (item.status_titulo === "RECEBIDO") r += item.valor_documento;
      else if (item.status_titulo === "VENCIDO") v += item.valor_documento;
      else a += item.valor_documento;
    }
    grandA += a;
    grandV += v;
    grandR += r;

    const lineCount = multi ? 10 : 25;
    const sorted = items
      .slice()
      .sort((x, y) => brToYmd(x.data_vencimento).localeCompare(brToYmd(y.data_vencimento)));
    const lines: string[] = [];
    for (const item of sorted.slice(0, lineCount)) {
      const num = item.numero_documento ?? `#${item.codigo_lancamento_omie}`;
      const cliente =
        !scopedToClient && item.codigo_cliente_fornecedor
          ? `${await resolveClienteName(co.client, item.codigo_cliente_fornecedor, nomeCache)} · `
          : "";
      const categoria = item.codigo_categoria
        ? ` · ${categoriaMap.get(item.codigo_categoria) ?? item.codigo_categoria}`
        : "";
      lines.push(
        `  ${cliente}${num} · vence ${item.data_vencimento} · R$ ${item.valor_documento.toFixed(2)} · ${item.status_titulo}${categoria}`,
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
      `A receber${totalsLabel}: R$ ${a.toFixed(2)} · Vencido: R$ ${v.toFixed(2)} · Recebido: R$ ${r.toFixed(2)}`,
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
          text: `Nenhum lançamento financeiro para ${scopeLabel}${windowLabel}${multi ? " nas empresas selecionadas" : ""}.`,
        },
      ],
    };
  }

  const single = !multi ? ` · ${selected[0]!.label ?? selected[0]!.code}` : "";
  const grandLabel = hasWindow ? " no período" : "";
  const grand = multi
    ? `\n\nTotal consolidado${grandLabel} — A receber: R$ ${grandA.toFixed(2)} · Vencido: R$ ${grandV.toFixed(2)} · Recebido: R$ ${grandR.toFixed(2)}`
    : "";
  const cappedWarning = anyCapped
    ? "\n\n⚠ Uma ou mais empresas atingiram o limite de páginas antes de esgotar o período — total pode estar incompleto."
    : "";

  return {
    content: [
      {
        type: "text",
        text: `Contas a receber · ${scopeLabel}${windowLabel}${single}\n\n${blocks.join("\n\n")}${grand}${cappedWarning}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "omie_consultar_financeiro",
  description:
    "Contas a receber no Omie por empresa. Informe `nome` do cliente (ex: 'Amazon') — resolvido pelo registro B2B, sem chamar a Omie para achar o código — ou `codigoCliente`; sem cliente, resume a carteira inteira. Informe `desde`/`ate` (ISO YYYY-MM-DD) para escopar por DATA DE VENCIMENTO — sem eles, mantém o comportamento antigo (carteira inteira, sem janela). `empresa` aceita um nome ou vários; com `nome`, usa as empresas onde o cliente existe. Cada lançamento retorna nome do cliente e categoria (não só códigos). Mostra a receber/vencido/recebido por empresa + total consolidado.",
  inputSchema: {
    nome: z
      .string()
      .optional()
      .describe(
        "Nome do cliente (ex: 'Amazon', 'UAU BOX'). Resolvido pelo registro B2B → código por empresa, sem chamar a Omie. Preferível a codigoCliente.",
      ),
    empresa: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Nome da empresa Omie (ex: 'Matriz') ou lista de nomes para consolidar várias. Omita para escolher via pergunta quando houver mais de uma.",
      ),
    codigoCliente: z
      .number()
      .int()
      .optional()
      .describe(
        "codigo_cliente_omie do cliente. Omita para ver as contas a receber de todos os clientes.",
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
  handler: consultarFinanceiroHandler,
});
