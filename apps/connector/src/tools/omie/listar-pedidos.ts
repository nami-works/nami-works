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

type PedidoRow = { line: string; morePages: number };

async function listPedidosForCompany(
  client: OmieClient,
  desde: string,
  ate: string,
  codigoCliente: number | undefined,
): Promise<PedidoRow> {
  const param: Record<string, unknown> = {
    pagina: 1,
    registros_por_pagina: 50,
    apenas_importado_api: "N",
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
    if (/n[ãa]o existem registros/i.test(res.faultstring)) {
      return { line: "", morePages: 0 };
    }
    throw new Error(`Omie ListarPedidos failed: ${res.faultstring}`);
  }

  const pedidos = res.data.pedido_venda_produto ?? [];
  const lines = pedidos
    .map((p) => {
      const num = p.cabecalho.numero_pedido;
      const cliente = p.cabecalho.codigo_cliente;
      const etapa = p.cabecalho.etapa;
      const total = p.total_pedido?.valor_total_pedido ?? 0;
      const inc = p.infoCadastro?.dInc ?? "?";
      return `  #${num} · cliente ${cliente} · etapa ${etapa} · R$ ${total.toFixed(2)} · criado ${inc}`;
    })
    .join("\n");
  const totalPages = res.data.total_de_paginas ?? 1;
  return { line: lines, morePages: totalPages > 1 ? totalPages : 0 };
}

export async function listarPedidosHandler(
  args: {
    desde: string;
    ate: string;
    empresa?: string | string[] | undefined;
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
  const clientNote = args.codigoCliente ? ` (cliente ${args.codigoCliente})` : "";

  const blocks: string[] = [];
  let any = false;
  for (const co of selected) {
    const name = co.label ?? co.code;
    const { line, morePages } = await listPedidosForCompany(
      co.client,
      args.desde,
      args.ate,
      args.codigoCliente,
    );
    const tag = multi ? `— ${name} —\n` : "";
    if (!line) {
      if (multi) blocks.push(`${tag}Sem pedidos no período.`);
      continue;
    }
    any = true;
    const more =
      morePages > 1
        ? `\n  (página 1 de ${morePages} — refine a faixa de datas para ver mais)`
        : "";
    blocks.push(`${tag}${line}${more}`);
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
  const header = `Pedidos Omie entre ${args.desde} e ${args.ate}${clientNote}${single}:`;
  return {
    content: [{ type: "text", text: `${header}\n\n${blocks.join("\n\n")}` }],
  };
}

registerToolDefinition({
  name: "omie_listar_pedidos",
  description:
    "Lista pedidos de venda de uma empresa no Omie em uma faixa de datas, opcionalmente filtrado por codigo_cliente. Se o tenant tiver mais de uma empresa Omie e `empresa` não for informada, a tool pergunta qual usar. Retorna número do pedido, cliente, etapa, valor total e data de criação.",
  inputSchema: {
    desde: z
      .string()
      .regex(ISO_DATE, "use formato ISO YYYY-MM-DD")
      .describe('Data inicial (ISO YYYY-MM-DD). Ex: "2026-04-01".'),
    ate: z
      .string()
      .regex(ISO_DATE, "use formato ISO YYYY-MM-DD")
      .describe('Data final (ISO YYYY-MM-DD). Ex: "2026-04-30".'),
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
      .describe("codigo_cliente_omie para filtrar por cliente específico."),
  },
  handler: listarPedidosHandler,
});
