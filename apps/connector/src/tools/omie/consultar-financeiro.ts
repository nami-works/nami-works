import { z } from "zod";
import {
  describeOmieCompanies,
  getOmieCompanies,
  omieAmbiguousPrompt,
  resolveOmieCompanies,
  type OmieClient,
} from "../../clients/omie.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

type ContaReceber = {
  codigo_lancamento_omie: number;
  codigo_cliente_fornecedor?: number;
  numero_documento: string | null;
  data_vencimento: string; // dd/mm/yyyy
  valor_documento: number;
  status_titulo: "RECEBIDO" | "A_RECEBER" | "VENCIDO" | string;
  observacao: string | null;
};

// When no client is specified we walk the whole receivables ledger, capped so a
// large company doesn't turn into dozens of throttled Omie calls. 15 pages ×
// 200 = 3000 entries; if there are more, the response says so.
const ALL_CLIENTS_MAX_PAGES = 15;

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

// Accounts-receivable for one Omie company. Single page when scoped to a client;
// paginated (capped) when walking the whole ledger.
async function fetchArForClient(
  client: OmieClient,
  codigoCliente: number | undefined,
): Promise<{ items: ContaReceber[]; totalRegistros: number }> {
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
        ...(scoped ? { filtrar_por_cliente: codigoCliente } : {}),
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
  return { items, totalRegistros: totalRegistros || items.length };
}

export async function consultarFinanceiroHandler(
  args: {
    empresa?: string | string[] | undefined;
    codigoCliente?: number | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
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
  const scopedToClient = typeof args.codigoCliente === "number";
  const scopeLabel = scopedToClient
    ? `cliente ${args.codigoCliente}`
    : "todos os clientes";

  const blocks: string[] = [];
  let grandA = 0;
  let grandV = 0;
  let grandR = 0;
  let anyItems = false;

  for (const co of selected) {
    const name = co.label ?? co.code;
    const { items, totalRegistros } = await fetchArForClient(
      co.client,
      args.codigoCliente,
    );
    const tag = multi ? `— ${name} —` : null;
    if (items.length === 0) {
      if (tag) blocks.push(`${tag}\nSem lançamentos.`);
      continue;
    }
    anyItems = true;

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
    const lines = items
      .slice()
      .sort((x, y) =>
        brToYmd(x.data_vencimento).localeCompare(brToYmd(y.data_vencimento)),
      )
      .slice(0, lineCount)
      .map((item) => {
        const num = item.numero_documento ?? `#${item.codigo_lancamento_omie}`;
        const cliente =
          !scopedToClient && item.codigo_cliente_fornecedor
            ? `cliente ${item.codigo_cliente_fornecedor} · `
            : "";
        return `  ${cliente}${num} · vence ${item.data_vencimento} · R$ ${item.valor_documento.toFixed(2)} · ${item.status_titulo}`;
      });

    const capped = !scopedToClient && totalRegistros > items.length;
    const more = capped
      ? ` (mostrando ${lineCount} de ${items.length} carregados; ledger tem ${totalRegistros})`
      : items.length > lineCount
        ? ` (mostrando ${lineCount} de ${items.length})`
        : "";

    const head = [
      tag,
      `A receber: R$ ${a.toFixed(2)} · Vencido: R$ ${v.toFixed(2)} · Recebido: R$ ${r.toFixed(2)}`,
      `Lançamentos (mais antigos primeiro)${more}:`,
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
          text: `Nenhum lançamento financeiro para ${scopeLabel}${multi ? " nas empresas selecionadas" : ""}.`,
        },
      ],
    };
  }

  const single = !multi ? ` · ${selected[0]!.label ?? selected[0]!.code}` : "";
  const grand = multi
    ? `\n\nTotal consolidado — A receber: R$ ${grandA.toFixed(2)} · Vencido: R$ ${grandV.toFixed(2)} · Recebido: R$ ${grandR.toFixed(2)}`
    : "";

  return {
    content: [
      {
        type: "text",
        text: `Contas a receber · ${scopeLabel}${single}\n\n${blocks.join("\n\n")}${grand}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "omie_consultar_financeiro",
  description:
    "Contas a receber no Omie por empresa. Sem cliente informado, resume a carteira inteira; com codigoCliente, foca nesse cliente. `empresa` aceita um nome ou vários (seleção múltipla) — se houver mais de uma empresa e nada for informado, a tool pede para o usuário escolher. Com várias, mostra por empresa + total consolidado.",
  inputSchema: {
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
  },
  handler: consultarFinanceiroHandler,
});
