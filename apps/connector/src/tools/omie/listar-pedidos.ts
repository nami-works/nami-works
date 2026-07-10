import { z } from "zod";
import {
  type B2BRegistryEntry,
  describeOmieCompanies,
  getB2BRegistry,
  getOmieCompanies,
  omieAmbiguousPrompt,
  resolveOmieCompanies,
  resolveRegistryEntry,
  type OmieClient,
  type OmieCompany,
} from "../../clients/omie.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

type ListarPedidosResponse = {
  pedido_venda_produto?: Array<{
    cabecalho: {
      codigo_pedido: number;
      numero_pedido: string;
      codigo_cliente: number;
      etapa: string;
      data_previsao: string | null;
    };
    informacoes_adicionais?: {
      codigo_categoria: string | null;
      codigo_conta_corrente: number | null;
      consumidor_final: string | null;
    };
    total_pedido?: {
      valor_total_pedido: number;
      valor_total_produtos: number;
      valor_descontos: number;
    };
    infoCadastro?: {
      dInc: string | null; // dd/mm/yyyy
      dAlt: string | null;
    };
  }>;
  total_de_paginas?: number;
  total_de_registros?: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function normName(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// The codigo_cliente_omie for a company from a registry entry (labels match
// case/accent-insensitively).
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

function isoToBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// dd/mm/yyyy → yyyy-mm-dd (for range comparison). "" if unparseable.
function brToYmd(br: string | null | undefined): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// Walk a company's sales orders for a client, CLIENT-SIDE filtering by creation
// date (dInc) within [desde, ate] — Omie's server-side date filter on this
// endpoint is unreliable (it leaks out-of-window orders), so we never trust it
// for the window. Paginated + capped; when scoped to a codigoCliente the result
// set is small so the sum is complete.
const MAX_PAGES = 20;

type PedidoResult = {
  count: number;
  total: number;
  lines: string[];
  fetchedPages: number;
  totalPages: number;
  capped: boolean;
};

async function fetchPedidosInWindow(
  client: OmieClient,
  desde: string,
  ate: string,
  codigoCliente: number | undefined,
): Promise<PedidoResult> {
  const inWindow: Array<{ line: string; total: number }> = [];
  let totalPages = 1;
  let page = 1;
  for (; page <= MAX_PAGES; page += 1) {
    const param: Record<string, unknown> = {
      pagina: page,
      registros_por_pagina: 50,
      apenas_importado_api: "N",
      // best-effort server hints (unreliable — we re-filter client-side)
      filtrar_por_data_de: isoToBr(desde),
      filtrar_por_data_ate: isoToBr(ate),
    };
    if (typeof codigoCliente === "number") {
      param.filtrar_por_cliente = codigoCliente;
    }
    const res = await client.call<typeof param, ListarPedidosResponse>({
      resource: "produtos/pedido",
      method: "ListarPedidos",
      param,
    });
    if (!res.ok) {
      if (/n[ãa]o existem registros/i.test(res.faultstring)) break;
      throw new Error(`Omie ListarPedidos failed: ${res.faultstring}`);
    }
    const pedidos = res.data.pedido_venda_produto ?? [];
    totalPages = res.data.total_de_paginas ?? 1;
    for (const p of pedidos) {
      const inc = brToYmd(p.infoCadastro?.dInc);
      if (!inc || inc < desde || inc > ate) continue; // enforce window client-side
      const total = p.total_pedido?.valor_total_pedido ?? 0;
      inWindow.push({
        line: `  #${p.cabecalho.numero_pedido} · cliente ${p.cabecalho.codigo_cliente} · etapa ${p.cabecalho.etapa} · R$ ${total.toFixed(2)} · criado ${p.infoCadastro?.dInc ?? "?"}`,
        total,
      });
    }
    if (pedidos.length === 0 || page >= totalPages) break;
  }
  const fetchedPages = Math.min(page, totalPages);
  return {
    count: inWindow.length,
    total: inWindow.reduce((s, o) => s + o.total, 0),
    lines: inWindow.map((o) => o.line),
    fetchedPages,
    totalPages,
    capped: totalPages > MAX_PAGES,
  };
}

export async function listarPedidosHandler(
  args: {
    desde: string;
    ate: string;
    empresa?: string | string[] | undefined;
    codigoCliente?: number | undefined;
    nome?: string | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ISO_DATE.test(args.desde) || !ISO_DATE.test(args.ate)) {
    return {
      content: [
        {
          type: "text",
          text: "desde and ate must be ISO dates in YYYY-MM-DD format.",
        },
      ],
      isError: true,
    };
  }

  // Resolve a customer name to per-company códigos via the registry (no Omie
  // call) so "pedidos da Amazon" works without the caller supplying a código.
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
    // Query the companies the customer actually has a código in.
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
  const clientNote = registryEntry
    ? ` (${registryEntry.nome})`
    : args.codigoCliente
      ? ` (cliente ${args.codigoCliente})`
      : "";

  const blocks: string[] = [];
  let any = false;
  let grandTotal = 0;
  let grandCount = 0;
  for (const co of selected) {
    const label = co.label ?? co.code;
    const codigo = registryEntry
      ? registryCodigoFor(registryEntry, co)
      : args.codigoCliente;
    if (registryEntry && typeof codigo !== "number") continue; // no código here

    const r = await fetchPedidosInWindow(co.client, args.desde, args.ate, codigo);
    if (r.count === 0) {
      if (multi) blocks.push(`— ${label} —\nSem pedidos no período.`);
      continue;
    }
    any = true;
    grandTotal += r.total;
    grandCount += r.count;
    const sample = r.lines.slice(0, 15);
    const more =
      r.lines.length > 15 ? `\n  (+${r.lines.length - 15} pedidos)` : "";
    const capNote = r.capped
      ? `\n  ⚠ empresa com muitas páginas (${r.totalPages}); a soma pode estar incompleta — filtre por cliente ou reduza o período.`
      : "";
    const head =
      (multi ? `— ${label} —\n` : "") +
      `Total: R$ ${r.total.toFixed(2)} · ${r.count} pedido(s)`;
    blocks.push(`${head}\n${sample.join("\n")}${more}${capNote}`);
  }

  if (!any) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum pedido entre ${args.desde} e ${args.ate}${clientNote}${multi ? " nas empresas selecionadas" : ""}.`,
        },
      ],
    };
  }

  const single = !multi ? ` · ${selected[0]!.label ?? selected[0]!.code}` : "";
  const grandLine = multi
    ? `\n\nTotal consolidado: R$ ${grandTotal.toFixed(2)} · ${grandCount} pedido(s)`
    : "";
  const header = `Pedidos Omie entre ${args.desde} e ${args.ate}${clientNote}${single} (data de criação):`;
  return {
    content: [
      { type: "text", text: `${header}\n\n${blocks.join("\n\n")}${grandLine}` },
    ],
  };
}

registerToolDefinition({
  name: "omie_listar_pedidos",
  description:
    "Soma e lista pedidos de venda no Omie numa faixa de datas (por DATA DE CRIAÇÃO, filtrada no cliente pois o filtro de data da Omie é não-confiável). Informe `nome` do cliente (ex: 'Amazon') — resolvido pelo registro B2B, sem chamar a Omie para achar o código — ou `codigoCliente`. Sem cliente, some cuidado: empresas grandes podem exceder o limite de páginas (avisa quando isso ocorre). Retorna total (R$) + contagem por empresa e consolidado.",
  inputSchema: {
    desde: z
      .string()
      .regex(ISO_DATE, "use formato ISO YYYY-MM-DD")
      .describe('Data inicial (ISO YYYY-MM-DD). Ex: "2025-10-01".'),
    ate: z
      .string()
      .regex(ISO_DATE, "use formato ISO YYYY-MM-DD")
      .describe('Data final (ISO YYYY-MM-DD). Ex: "2026-07-02".'),
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
        "Nome da empresa Omie (ex: 'Matriz') ou lista. Omita: com `nome`, usa as empresas onde o cliente existe; senão pergunta qual usar.",
      ),
    codigoCliente: z
      .number()
      .int()
      .optional()
      .describe(
        "codigo_cliente_omie (por empresa). Use se souber o código; senão prefira `nome`.",
      ),
  },
  handler: listarPedidosHandler,
});
