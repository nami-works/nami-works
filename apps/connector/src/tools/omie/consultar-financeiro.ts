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
import {
  aggregateItems,
  filterByTipo,
  GROUP_BY_VALUES,
  TIPO_VALUES,
  type AggregatableItem,
  type GroupByKey,
  type TipoFlag,
} from "./aggregation.js";

type ContaReceber = {
  codigo_lancamento_omie: number;
  codigo_cliente_fornecedor?: number;
  codigo_categoria?: string | null;
  numero_documento: string | null;
  data_vencimento: string; // dd/mm/yyyy
  data_pagamento?: string | null; // dd/mm/yyyy, only set once RECEBIDO
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
// No arbitrary page cap needed; SAFETY_MAX_PAGES is a pure runaway guard.
const WINDOW_PAGE_SIZE = 200;
const SAFETY_MAX_PAGES = 2000;

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

// Windowed fetch: descending by DATA_VENCIMENTO (native sort) when baseData is
// vencimento. Stops the instant a row falls before `desde` — sort order
// guarantees everything after it is older still, so the window is always
// fully exhausted, never capped by an arbitrary page limit. When baseData is
// pagamento there's no native sort to exploit (Omie doesn't support ordering
// by data_pagamento), so it falls back to a full ledger walk like contapagar.
async function fetchArWindow(
  client: OmieClient,
  codigoCliente: number | undefined,
  desde: string,
  ate: string,
  baseData: "vencimento" | "pagamento",
): Promise<{ items: ContaReceber[]; capped: boolean }> {
  const scoped = typeof codigoCliente === "number";
  const items: ContaReceber[] = [];
  let pagina = 1;
  let pastWindow = false;
  const sortByVencimento = baseData === "vencimento";
  for (; pagina <= SAFETY_MAX_PAGES; pagina += 1) {
    const res = await client.call<
      Record<string, unknown>,
      ListarContasReceberResponse
    >({
      resource: "financas/contareceber",
      method: "ListarContasReceber",
      param: {
        pagina,
        registros_por_pagina: WINDOW_PAGE_SIZE,
        apenas_importado_api: "N",
        ...(sortByVencimento
          ? { ordenar_por: "DATA_VENCIMENTO", ordem_descrescente: "S" }
          : {}),
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
      const dateField = baseData === "pagamento" ? row.data_pagamento : row.data_vencimento;
      if (!dateField) continue;
      const ymd = brToYmd(dateField);
      if (sortByVencimento) {
        if (ymd > ate) continue; // still ahead of the window, keep going
        if (ymd < desde) {
          pastWindow = true;
          break; // descending order — everything from here is older still
        }
        items.push(row);
      } else {
        if (ymd >= desde && ymd <= ate) items.push(row);
      }
    }
    if (pastWindow) {
      pagina += 1;
      break;
    }
    const totalPaginas = res.data.total_de_paginas;
    if (page.length < WINDOW_PAGE_SIZE || (totalPaginas !== undefined && pagina >= totalPaginas)) {
      pagina += 1;
      break;
    }
  }
  return { items, capped: !pastWindow && pagina > SAFETY_MAX_PAGES };
}

export async function consultarFinanceiroHandler(
  args: {
    empresa?: string | string[] | undefined;
    codigoCliente?: number | undefined;
    nome?: string | undefined;
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

  // Each company is a SEPARATE Omie account (own app_key/app_secret, own rate
  // limit) — nothing requires processing them one after another.
  type CompanyResult = {
    block: string | null;
    a: number;
    v: number;
    r: number;
    hasItems: boolean;
    capped: boolean;
    aggItems: AggregatableItem[];
  };

  async function processCompany(co: OmieCompany): Promise<CompanyResult> {
    const name = co.label ?? co.code;
    const codigo = registryEntry
      ? registryCodigoFor(registryEntry, co)
      : args.codigoCliente;
    if (registryEntry && typeof codigo !== "number") {
      return {
        block: multi ? `— ${name} —\nSem cadastro nesta empresa.` : null,
        a: 0,
        v: 0,
        r: 0,
        hasItems: false,
        capped: false,
        aggItems: [],
      };
    }
    const { items, totalRegistros, capped } = hasWindow
      ? { ...(await fetchArWindow(co.client, codigo, args.desde!, args.ate!, baseData)), totalRegistros: undefined }
      : await fetchArForClient(co.client, codigo);

    const tag = multi ? `— ${name} —` : null;
    if (items.length === 0) {
      return {
        block: tag ? `${tag}\nSem lançamentos${windowLabel ? " no período" : ""}.` : null,
        a: 0,
        v: 0,
        r: 0,
        hasItems: false,
        capped,
        aggItems: [],
      };
    }

    const categoriaMap = await fetchCategoriaMap(co.client);
    const nomeCache = new Map<number, string>();

    let a = 0;
    let v = 0;
    let r = 0;
    const aggItems: AggregatableItem[] = [];
    for (const item of items) {
      const status = item.status_titulo === "RECEBIDO"
        ? "pago"
        : item.status_titulo === "VENCIDO"
          ? "vencido"
          : "aberto";
      if (status === "pago") r += item.valor_documento;
      else if (status === "vencido") v += item.valor_documento;
      else a += item.valor_documento;

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
      .sort((x, y) =>
        brToYmd(x.data_vencimento).localeCompare(brToYmd(y.data_vencimento)),
      );
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
      `A receber${totalsLabel}: R$ ${a.toFixed(2)} · Vencido: R$ ${v.toFixed(2)} · Recebido: R$ ${r.toFixed(2)}`,
      `Lançamentos (por vencimento)${loadedNote}${cappedNote}:`,
    ]
      .filter((s): s is string => s !== null)
      .join("\n");
    return { block: `${head}\n${lines.join("\n")}`, a, v, r, hasItems: true, capped, aggItems };
  }

  const perCompany = await Promise.all(selected.map(processCompany));

  const blocks: string[] = [];
  let grandA = 0;
  let grandV = 0;
  let grandR = 0;
  let anyItems = false;
  let anyCapped = false;
  const allAggItems: AggregatableItem[] = [];
  for (const result of perCompany) {
    if (result.block) blocks.push(result.block);
    grandA += result.a;
    grandV += result.v;
    grandR += result.r;
    if (result.hasItems) anyItems = true;
    if (result.capped) anyCapped = true;
    allAggItems.push(...result.aggItems);
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

  if (groupBy) {
    const filtered = filterByTipo(allAggItems, args.excluir);
    const { rows: consolidated, fornecedorTruncated } = await aggregateItems(filtered, groupBy);

    let porEmpresa: Record<string, Awaited<ReturnType<typeof aggregateItems>>["rows"]> | undefined;
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
          ? ["groupBy inclui fornecedor com mais de 40 fornecedores no período — cauda longa agregada em \"Outros\" (valor preservado, nomes não)."]
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
    ? `\n\nTotal consolidado${grandLabel} — A receber: R$ ${grandA.toFixed(2)} · Vencido: R$ ${grandV.toFixed(2)} · Recebido: R$ ${grandR.toFixed(2)}`
    : "";
  const cappedWarning = anyCapped
    ? "\n\n⚠ Uma ou mais empresas atingiram o limite de segurança de páginas — total pode estar incompleto (isso não deveria acontecer em uso normal; avise o time)."
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
    "Contas a receber no Omie por empresa. Informe `nome` do cliente (ex: 'Amazon') — resolvido pelo registro B2B, sem chamar a Omie para achar o código — ou `codigoCliente`; sem cliente, resume a carteira inteira. Informe `desde`/`ate` (ISO YYYY-MM-DD) para escopar por data — sem eles, mantém o comportamento antigo (carteira inteira, sem janela). `empresa` aceita um nome ou vários; com `nome`, usa as empresas onde o cliente existe. `groupBy` (categoria|fornecedor|empresa|mes, aceita lista para cross-tab) retorna um agregado estruturado (JSON) em vez do resumo em texto. `excluir` filtra tipos (intercompany|imposto|estorno|externo) do agregado. Mostra a receber/vencido/recebido por empresa + total consolidado.",
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
        "Campo de data usado para a janela: 'vencimento' (padrão) ou 'pagamento' (data em que foi efetivamente recebido).",
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
  handler: consultarFinanceiroHandler,
});
