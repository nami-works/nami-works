import { z } from "zod";
import { getOmieClient } from "../../clients/omie.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

type ListarClientesResponse = {
  clientes_cadastro_resumido?: Array<{
    codigo_cliente: number;
    razao_social: string | null;
    nome_fantasia: string | null;
    cnpj_cpf: string | null;
  }>;
  clientes_cadastro?: Array<{
    codigo_cliente: number;
    razao_social: string | null;
  }>;
  total_de_paginas?: number;
};

type ConsultarClienteResponse = {
  codigo_cliente_omie: number;
  codigo_cliente_integracao: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj_cpf: string | null;
  inscricao_estadual: string | null;
  endereco: string | null;
  endereco_numero: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  cep: string | null;
  inativo: string | null;
  bloqueado: string | null;
  tags?: Array<{ tag: string }>;
};

function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}

export async function consultarClienteHandler(
  args: { cnpj?: string | undefined; codigo?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!args.cnpj && typeof args.codigo !== "number") {
    return {
      content: [
        {
          type: "text",
          text: "Provide either cnpj (CNPJ ou CPF) or codigo (codigo_cliente_omie).",
        },
      ],
      isError: true,
    };
  }

  const omie = await getOmieClient({ ssmPrefix: ctx.tenant.ssmPrefix });

  let codigo = args.codigo;
  if (typeof codigo !== "number") {
    const cnpjDigits = digitsOnly(args.cnpj ?? "");
    if (cnpjDigits.length === 0) {
      return {
        content: [
          { type: "text", text: "cnpj is empty after normalization." },
        ],
        isError: true,
      };
    }
    const listing = await omie.call<
      Record<string, unknown>,
      ListarClientesResponse
    >({
      resource: "geral/clientes",
      method: "ListarClientes",
      param: {
        pagina: 1,
        registros_por_pagina: 50,
        apenas_importado_api: "N",
        clientesFiltro: { cnpj_cpf: cnpjDigits },
      },
    });
    if (!listing.ok) {
      throw new Error(`Omie ListarClientes failed: ${listing.faultstring}`);
    }
    const records =
      listing.data.clientes_cadastro_resumido ??
      listing.data.clientes_cadastro ??
      [];
    if (records.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Nenhum cliente encontrado para CNPJ/CPF "${args.cnpj}".`,
          },
        ],
      };
    }
    codigo = records[0]?.codigo_cliente;
    if (typeof codigo !== "number") {
      throw new Error("Omie returned a record with no codigo_cliente.");
    }
  }

  const detail = await omie.call<
    { codigo_cliente_omie: number },
    ConsultarClienteResponse
  >({
    resource: "geral/clientes",
    method: "ConsultarCliente",
    param: { codigo_cliente_omie: codigo },
  });
  if (!detail.ok) {
    if (/não cadastrado/i.test(detail.faultstring)) {
      return {
        content: [
          {
            type: "text",
            text: `Cliente não cadastrado no Omie (codigo=${codigo}).`,
          },
        ],
      };
    }
    throw new Error(`Omie ConsultarCliente failed: ${detail.faultstring}`);
  }

  const c = detail.data;
  const tags =
    Array.isArray(c.tags) && c.tags.length > 0
      ? c.tags.map((t) => t.tag).join(", ")
      : "(nenhuma)";
  const endereco = [
    c.endereco,
    c.endereco_numero,
    c.bairro,
    c.cidade,
    c.estado,
    c.cep,
  ]
    .filter(Boolean)
    .join(", ") || "(sem endereço)";
  const status =
    c.inativo === "S"
      ? "INATIVO"
      : c.bloqueado === "S"
        ? "BLOQUEADO"
        : "ativo";

  const body = [
    `Cliente Omie #${c.codigo_cliente_omie} · ${status}`,
    `Razão social: ${c.razao_social ?? "(sem razão)"}`,
    c.nome_fantasia ? `Nome fantasia: ${c.nome_fantasia}` : null,
    `CNPJ/CPF: ${c.cnpj_cpf ?? "(sem CNPJ)"}`,
    c.inscricao_estadual ? `Inscrição estadual: ${c.inscricao_estadual}` : null,
    `Endereço: ${endereco}`,
    `Tags: ${tags}`,
    c.codigo_cliente_integracao
      ? `Código de integração: ${c.codigo_cliente_integracao}`
      : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "omie_consultar_cliente",
  description:
    "Consulta um cliente no Omie por CNPJ/CPF ou pelo codigo_cliente_omie. Retorna razão social, contatos, endereço, tags e status (ativo/inativo/bloqueado).",
  inputSchema: {
    cnpj: z
      .string()
      .optional()
      .describe(
        "CNPJ ou CPF do cliente. Aceita máscara (12.345.678/0001-90); a tool normaliza para apenas dígitos.",
      ),
    codigo: z
      .number()
      .int()
      .optional()
      .describe("codigo_cliente_omie. Use quando você já tem o ID."),
  },
  handler: consultarClienteHandler,
});
