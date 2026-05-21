import { z } from "zod";
import { getOmieClient } from "../../clients/omie.js";
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

function isoToBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function listarPedidosHandler(
  args: {
    desde: string;
    ate: string;
    codigoCliente?: number | undefined;
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

  const omie = await getOmieClient({ ssmPrefix: ctx.tenant.ssmPrefix });

  const param: Record<string, unknown> = {
    pagina: 1,
    registros_por_pagina: 50,
    apenas_importado_api: "N",
    filtrar_por_data_de: isoToBr(args.desde),
    filtrar_por_data_ate: isoToBr(args.ate),
  };
  if (typeof args.codigoCliente === "number") {
    param.filtrar_por_cliente = args.codigoCliente;
  }

  const res = await omie.call<typeof param, ListarPedidosResponse>({
    resource: "produtos/pedido",
    method: "ListarPedidos",
    param,
  });
  if (!res.ok) {
    if (/n[ãa]o existem registros/i.test(res.faultstring)) {
      return {
        content: [
          {
            type: "text",
            text: `Nenhum pedido encontrado entre ${args.desde} e ${args.ate}${args.codigoCliente ? ` para o cliente ${args.codigoCliente}` : ""}.`,
          },
        ],
      };
    }
    throw new Error(`Omie ListarPedidos failed: ${res.faultstring}`);
  }

  const pedidos = res.data.pedido_venda_produto ?? [];
  if (pedidos.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhum pedido entre ${args.desde} e ${args.ate}.`,
        },
      ],
    };
  }

  const lines = pedidos.map((p) => {
    const num = p.cabecalho.numero_pedido;
    const cliente = p.cabecalho.codigo_cliente;
    const etapa = p.cabecalho.etapa;
    const total = p.total_pedido?.valor_total_pedido ?? 0;
    const inc = p.infoCadastro?.dInc ?? "?";
    return `  #${num} · cliente ${cliente} · etapa ${etapa} · R$ ${total.toFixed(2)} · criado ${inc}`;
  });

  const totalPages = res.data.total_de_paginas ?? 1;
  const truncated = totalPages > 1
    ? `\n\n(página 1 de ${totalPages} — refine a faixa de datas para ver mais)`
    : "";

  const header = `Pedidos Omie entre ${args.desde} e ${args.ate}${args.codigoCliente ? ` (cliente ${args.codigoCliente})` : ""} — ${pedidos.length} resultado(s):`;

  return {
    content: [
      {
        type: "text",
        text: `${header}\n\n${lines.join("\n")}${truncated}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "omie_listar_pedidos",
  description:
    "Lista pedidos de venda no Omie em uma faixa de datas, opcionalmente filtrado por codigo_cliente. Retorna número do pedido, cliente, etapa, valor total e data de criação.",
  inputSchema: {
    desde: z
      .string()
      .regex(ISO_DATE, "use formato ISO YYYY-MM-DD")
      .describe('Data inicial (ISO YYYY-MM-DD). Ex: "2026-04-01".'),
    ate: z
      .string()
      .regex(ISO_DATE, "use formato ISO YYYY-MM-DD")
      .describe('Data final (ISO YYYY-MM-DD). Ex: "2026-04-30".'),
    codigoCliente: z
      .number()
      .int()
      .optional()
      .describe("codigo_cliente_omie para filtrar por cliente específico."),
  },
  handler: listarPedidosHandler,
});
