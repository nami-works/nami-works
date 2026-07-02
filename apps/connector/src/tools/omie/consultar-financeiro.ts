import { z } from "zod";
import {
  describeOmieCompanies,
  getOmieCompanies,
  resolveOmieCompany,
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
  args: { empresa?: string | undefined; codigoCliente?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const companies = await getOmieCompanies({ ssmPrefix: ctx.tenant.ssmPrefix });
  const resolution = resolveOmieCompany(companies, args.empresa);
  if (resolution.kind === "ambiguous") {
    return {
      content: [
        {
          type: "text",
          text: `Esta conta tem mais de uma empresa no Omie. Diga qual usar no parâmetro \`empresa\`:\n${describeOmieCompanies(companies)}`,
        },
      ],
    };
  }
  if (resolution.kind === "notfound") {
    return {
      content: [
        {
          type: "text",
          text: `Empresa "${resolution.requested}" não encontrada. Opções:\n${describeOmieCompanies(companies)}`,
        },
      ],
      isError: true,
    };
  }
  const company = resolution.company;
  const multi = companies.length > 1;
  const companyLabel = multi ? ` · empresa ${company.code}` : "";
  const scopedToClient = typeof args.codigoCliente === "number";
  const scopeLabel = scopedToClient
    ? `cliente ${args.codigoCliente}`
    : "todos os clientes";

  const { items, totalRegistros } = await fetchArForClient(
    company.client,
    args.codigoCliente,
  );

  if (items.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum lançamento financeiro para ${scopeLabel}${companyLabel}.`,
        },
      ],
    };
  }

  let aReceber = 0;
  let vencido = 0;
  let recebido = 0;
  for (const item of items) {
    if (item.status_titulo === "RECEBIDO") recebido += item.valor_documento;
    else if (item.status_titulo === "VENCIDO") vencido += item.valor_documento;
    else aReceber += item.valor_documento;
  }

  const lines = items
    .slice()
    .sort((a, b) =>
      brToYmd(a.data_vencimento).localeCompare(brToYmd(b.data_vencimento)),
    )
    .slice(0, 25)
    .map((item) => {
      const num = item.numero_documento ?? `#${item.codigo_lancamento_omie}`;
      const cliente =
        !scopedToClient && item.codigo_cliente_fornecedor
          ? `cliente ${item.codigo_cliente_fornecedor} · `
          : "";
      return `  ${cliente}${num} · vence ${item.data_vencimento} · R$ ${item.valor_documento.toFixed(2)} · ${item.status_titulo}`;
    });

  const capped = !scopedToClient && totalRegistros > items.length;
  const truncated = capped
    ? `\n\n(mostrando 25 de ${items.length} carregados; ledger tem ${totalRegistros} — consulte um cliente específico para o detalhe completo)`
    : items.length > 25
      ? `\n\n(mostrando 25 de ${items.length})`
      : "";

  const summary = [
    `Contas a receber · ${scopeLabel}${companyLabel}`,
    `A receber: R$ ${aReceber.toFixed(2)}`,
    `Vencido:   R$ ${vencido.toFixed(2)}`,
    `Recebido:  R$ ${recebido.toFixed(2)}`,
    ``,
    `Lançamentos (mais antigos primeiro):`,
  ].join("\n");

  return {
    content: [
      { type: "text", text: `${summary}\n${lines.join("\n")}${truncated}` },
    ],
  };
}

registerToolDefinition({
  name: "omie_consultar_financeiro",
  description:
    "Contas a receber de uma empresa no Omie. Sem cliente informado, resume a carteira inteira; com codigoCliente, foca nesse cliente. Se o tenant tiver mais de uma empresa Omie e `empresa` não for informada, a tool pergunta qual usar.",
  inputSchema: {
    empresa: z
      .string()
      .optional()
      .describe(
        "Código da empresa Omie (ex: 000174). Omita para usar a única empresa; se houver várias, a tool lista as opções.",
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
