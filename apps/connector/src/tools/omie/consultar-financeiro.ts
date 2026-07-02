import { z } from "zod";
import { getOmieClient } from "../../clients/omie.js";
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

export async function consultarFinanceiroHandler(
  args: { codigoCliente?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const omie = await getOmieClient({ ssmPrefix: ctx.tenant.ssmPrefix });
  const scopedToClient = typeof args.codigoCliente === "number";
  const scopeLabel = scopedToClient
    ? `cliente ${args.codigoCliente}`
    : "todos os clientes";

  const items: ContaReceber[] = [];
  const maxPages = scopedToClient ? 1 : ALL_CLIENTS_MAX_PAGES;
  let totalRegistros: number | undefined;
  let totalPaginas: number | undefined;

  for (let pagina = 1; pagina <= maxPages; pagina += 1) {
    const res = await omie.call<
      Record<string, unknown>,
      ListarContasReceberResponse
    >({
      resource: "financas/contareceber",
      method: "ListarContasReceber",
      param: {
        pagina,
        registros_por_pagina: 200,
        apenas_importado_api: "N",
        ...(scopedToClient ? { filtrar_por_cliente: args.codigoCliente } : {}),
      },
    });
    if (!res.ok) {
      if (/n[ãa]o existem registros/i.test(res.faultstring)) break;
      throw new Error(`Omie ListarContasReceber failed: ${res.faultstring}`);
    }
    const page = res.data.conta_receber_cadastro ?? [];
    items.push(...page);
    totalRegistros = res.data.total_de_registros;
    totalPaginas = res.data.total_de_paginas;
    if (page.length === 0 || (totalPaginas !== undefined && pagina >= totalPaginas)) {
      break;
    }
  }

  if (items.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum lançamento financeiro encontrado para ${scopeLabel}.`,
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
    .sort((a, b) => brToYmd(a.data_vencimento).localeCompare(brToYmd(b.data_vencimento)))
    .slice(0, 25)
    .map((item) => {
      const num = item.numero_documento ?? `#${item.codigo_lancamento_omie}`;
      const cliente =
        !scopedToClient && item.codigo_cliente_fornecedor
          ? `cliente ${item.codigo_cliente_fornecedor} · `
          : "";
      return `  ${cliente}${num} · vence ${item.data_vencimento} · R$ ${item.valor_documento.toFixed(2)} · ${item.status_titulo}`;
    });

  // For the all-clients scope, note when the ledger is larger than what we walked.
  const walked = totalRegistros ?? items.length;
  const capped = !scopedToClient && walked > items.length;
  const truncated = capped
    ? `\n\n(mostrando 25 de ${items.length} carregados; ledger tem ${walked} lançamentos — consulte um cliente específico para o detalhe completo)`
    : items.length > 25
      ? `\n\n(mostrando 25 de ${items.length})`
      : "";

  const summary = [
    `Contas a receber · ${scopeLabel}`,
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
    "Contas a receber no Omie. Sem cliente informado, resume a carteira inteira (todos os clientes); com codigoCliente, foca em um cliente. Retorna total a receber, vencido, recebido e os 25 lançamentos mais antigos.",
  inputSchema: {
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
