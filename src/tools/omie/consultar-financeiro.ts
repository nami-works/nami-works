import { z } from "zod";
import { getOmieClient } from "../../clients/omie.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

type ContaReceber = {
  codigo_lancamento_omie: number;
  numero_documento: string | null;
  data_vencimento: string; // dd/mm/yyyy
  valor_documento: number;
  status_titulo: "RECEBIDO" | "A_RECEBER" | "VENCIDO" | string;
  observacao: string | null;
};

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
  args: { codigoCliente: number },
  ctx: ToolContext,
): Promise<ToolResult> {
  const omie = await getOmieClient({ ssmPrefix: ctx.tenant.ssmPrefix });

  const res = await omie.call<
    Record<string, unknown>,
    ListarContasReceberResponse
  >({
    resource: "financas/contareceber",
    method: "ListarContasReceber",
    param: {
      pagina: 1,
      registros_por_pagina: 200,
      apenas_importado_api: "N",
      filtrar_por_cliente: args.codigoCliente,
    },
  });
  if (!res.ok) {
    if (/n[ãa]o existem registros/i.test(res.faultstring)) {
      return {
        content: [
          {
            type: "text",
            text: `Nenhum lançamento financeiro encontrado para o cliente ${args.codigoCliente}.`,
          },
        ],
      };
    }
    throw new Error(`Omie ListarContasReceber failed: ${res.faultstring}`);
  }

  const items = res.data.conta_receber_cadastro ?? [];
  if (items.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum lançamento financeiro para o cliente ${args.codigoCliente}.`,
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
      return `  ${num} · vence ${item.data_vencimento} · R$ ${item.valor_documento.toFixed(2)} · ${item.status_titulo}`;
    });

  const truncated =
    items.length > 25 ? `\n\n(mostrando 25 de ${items.length})` : "";

  const summary = [
    `Resumo financeiro · cliente ${args.codigoCliente}`,
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
    "Resumo financeiro (contas a receber) de um cliente no Omie. Retorna total a receber, vencido, recebido e os 25 lançamentos mais antigos.",
  inputSchema: {
    codigoCliente: z
      .number()
      .int()
      .describe("codigo_cliente_omie do cliente."),
  },
  handler: consultarFinanceiroHandler,
});
