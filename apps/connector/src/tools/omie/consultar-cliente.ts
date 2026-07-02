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

type ClienteLookup =
  | { found: true; text: string }
  | { found: false; reason: "no-cnpj-match" | "nao-cadastrado"; codigo?: number };

// Look a client up in ONE Omie company (resolve codigo by CNPJ if needed, then
// ConsultarCliente). Returns a formatted block or a not-found reason.
async function lookupClienteInCompany(
  client: OmieClient,
  cnpj: string | undefined,
  codigoArg: number | undefined,
): Promise<ClienteLookup> {
  let codigo = codigoArg;
  if (typeof codigo !== "number") {
    const cnpjDigits = digitsOnly(cnpj ?? "");
    const listing = await client.call<
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
    if (records.length === 0) return { found: false, reason: "no-cnpj-match" };
    codigo = records[0]?.codigo_cliente;
    if (typeof codigo !== "number") {
      throw new Error("Omie returned a record with no codigo_cliente.");
    }
  }

  const detail = await client.call<
    { codigo_cliente_omie: number },
    ConsultarClienteResponse
  >({
    resource: "geral/clientes",
    method: "ConsultarCliente",
    param: { codigo_cliente_omie: codigo },
  });
  if (!detail.ok) {
    if (/não cadastrado/i.test(detail.faultstring)) {
      return { found: false, reason: "nao-cadastrado", codigo };
    }
    throw new Error(`Omie ConsultarCliente failed: ${detail.faultstring}`);
  }

  const c = detail.data;
  const tags =
    Array.isArray(c.tags) && c.tags.length > 0
      ? c.tags.map((t) => t.tag).join(", ")
      : "(nenhuma)";
  const endereco =
    [c.endereco, c.endereco_numero, c.bairro, c.cidade, c.estado, c.cep]
      .filter(Boolean)
      .join(", ") || "(sem endereço)";
  const status =
    c.inativo === "S" ? "INATIVO" : c.bloqueado === "S" ? "BLOQUEADO" : "ativo";
  const text = [
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
  return { found: true, text };
}

export async function consultarClienteHandler(
  args: {
    cnpj?: string | undefined;
    codigo?: number | undefined;
    empresa?: string | string[] | undefined;
  },
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
  if (typeof args.codigo !== "number" && digitsOnly(args.cnpj ?? "").length === 0) {
    return {
      content: [{ type: "text", text: "cnpj is empty after normalization." }],
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

  const blocks: string[] = [];
  let lastReason: "no-cnpj-match" | "nao-cadastrado" | null = null;
  let lastCodigo: number | undefined;
  for (const co of selected) {
    const r = await lookupClienteInCompany(co.client, args.cnpj, args.codigo);
    if (r.found) {
      blocks.push(multi ? `— ${co.label ?? co.code} —\n${r.text}` : r.text);
    } else {
      lastReason = r.reason;
      lastCodigo = r.codigo;
    }
  }

  if (blocks.length === 0) {
    if (multi) {
      return {
        content: [
          {
            type: "text",
            text: `Nenhum cliente encontrado nas empresas selecionadas${args.cnpj ? ` para CNPJ/CPF "${args.cnpj}"` : ""}.`,
          },
        ],
      };
    }
    if (lastReason === "nao-cadastrado") {
      return {
        content: [
          {
            type: "text",
            text: `Cliente não cadastrado no Omie (codigo=${lastCodigo}).`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Nenhum cliente encontrado para CNPJ/CPF "${args.cnpj}".`,
        },
      ],
    };
  }

  return { content: [{ type: "text", text: blocks.join("\n\n") }] };
}

registerToolDefinition({
  name: "omie_consultar_cliente",
  description:
    "Consulta um cliente no Omie por CNPJ/CPF ou pelo codigo_cliente_omie. `empresa` aceita um nome ou vários (seleção múltipla) — se houver mais de uma empresa e nada for informado, a tool pede para o usuário escolher. Retorna razão social, contatos, endereço, tags e status (ativo/inativo/bloqueado), por empresa.",
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
    empresa: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Nome da empresa Omie (ex: 'Matriz') ou lista de nomes. Omita para escolher via pergunta quando houver mais de uma.",
      ),
  },
  handler: consultarClienteHandler,
});
