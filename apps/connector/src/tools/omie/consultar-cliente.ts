import { z } from "zod";
import {
  describeOmieCompanies,
  getB2BRegistry,
  getOmieCompanies,
  isOmieThrottleFault,
  OMIE_THROTTLE_MESSAGE,
  omieAmbiguousPrompt,
  resolveOmieCompanies,
  type OmieClient,
} from "../../clients/omie.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

// ListarClientes returns the code as `codigo_cliente_omie` on the full
// `clientes_cadastro` records, and as `codigo_cliente` on the lighter
// `clientes_cadastro_resumido` records. Read whichever is present.
type ClienteRecord = {
  codigo_cliente_omie?: number;
  codigo_cliente?: number;
  razao_social?: string | null;
  nome_fantasia?: string | null;
  cnpj_cpf?: string | null;
  inativo?: string | null;
};
type ListarClientesResponse = {
  clientes_cadastro_resumido?: ClienteRecord[];
  clientes_cadastro?: ClienteRecord[];
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

function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Name search in ONE company: ListarClientes with a razao_social LIKE filter.
// Returns a compact list of matches (may be several). "não existem registros"
// → empty (clean miss).
async function searchByNameInCompany(
  client: OmieClient,
  nome: string,
  incluirPessoaFisica: boolean,
): Promise<Array<{ codigo?: number; label: string }>> {
  const res = await client.call<Record<string, unknown>, ListarClientesResponse>({
    resource: "geral/clientes",
    method: "ListarClientes",
    param: {
      pagina: 1,
      registros_por_pagina: 50,
      apenas_importado_api: "N",
      clientesFiltro: { razao_social: nome },
    },
  });
  if (!res.ok) {
    if (/n[ãa]o existem registros/i.test(res.faultstring)) return [];
    throw new Error(`Omie ListarClientes failed: ${res.faultstring}`);
  }
  let records = res.data.clientes_cadastro ?? res.data.clientes_cadastro_resumido ?? [];
  // B2B focus: keep only CNPJs (contain "/"), dropping individual CPFs — cuts
  // out end-customer noise. Opt back in with incluirPessoaFisica.
  if (!incluirPessoaFisica) {
    records = records.filter((r) => (r.cnpj_cpf ?? "").includes("/"));
  }
  return records.map((r) => {
    const codigo = r.codigo_cliente_omie ?? r.codigo_cliente;
    const status = r.inativo === "S" ? " · INATIVO" : "";
    const razao = r.razao_social ?? r.nome_fantasia ?? "(sem razão)";
    return {
      ...(typeof codigo === "number" ? { codigo } : {}),
      label: `#${codigo ?? "?"} · ${razao} · ${r.cnpj_cpf ?? "(sem CNPJ)"}${status}`,
    };
  });
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
      // Not in this company → treat as a clean miss, not an error (matters when
      // looking a CNPJ up across several companies where only one carries it).
      if (/n[ãa]o existem registros/i.test(listing.faultstring)) {
        return { found: false, reason: "no-cnpj-match" };
      }
      throw new Error(`Omie ListarClientes failed: ${listing.faultstring}`);
    }
    const records =
      listing.data.clientes_cadastro ??
      listing.data.clientes_cadastro_resumido ??
      [];
    const rec = records[0];
    if (!rec) return { found: false, reason: "no-cnpj-match" };
    codigo = rec.codigo_cliente_omie ?? rec.codigo_cliente;
    if (typeof codigo !== "number") {
      throw new Error("Omie returned a record with no codigo_cliente_omie.");
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

type ConsultarClienteArgs = {
  cnpj?: string | undefined;
  codigo?: number | undefined;
  nome?: string | undefined;
  incluirPessoaFisica?: boolean | undefined;
  empresa?: string | string[] | undefined;
};

// Surface Omie throttle/duplicate-query faults as a friendly retry message
// instead of a hard "tool invocation failed".
export async function consultarClienteHandler(
  args: ConsultarClienteArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    return await consultarClienteImpl(args, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isOmieThrottleFault(msg)) {
      return { content: [{ type: "text", text: OMIE_THROTTLE_MESSAGE }] };
    }
    throw err;
  }
}

async function consultarClienteImpl(
  args: ConsultarClienteArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const nome = args.nome?.trim();
  const byName = !!nome && !args.cnpj && typeof args.codigo !== "number";
  if (!args.cnpj && typeof args.codigo !== "number" && !nome) {
    return {
      content: [
        {
          type: "text",
          text: "Informe nome (razão social), cnpj (CNPJ/CPF) ou codigo (codigo_cliente_omie).",
        },
      ],
      isError: true,
    };
  }
  if (
    !byName &&
    typeof args.codigo !== "number" &&
    digitsOnly(args.cnpj ?? "").length === 0
  ) {
    return {
      content: [{ type: "text", text: "cnpj is empty after normalization." }],
      isError: true,
    };
  }

  // Registry-first for name lookups: resolve against the canonical B2B registry
  // (SSM) with zero Omie calls — this is what keeps name searches off the
  // throttled ListarClientes. Only a registry miss falls through to a live Omie
  // search below.
  if (byName && nome) {
    const registry = await getB2BRegistry({ ssmPrefix: ctx.tenant.ssmPrefix });
    const q = normName(nome);
    const hits = registry.filter((e) => {
      const names = [e.nome, ...(e.aliases ?? [])].map(normName);
      return names.some((n) => n.includes(q) || q.includes(n));
    });
    if (hits.length > 0) {
      const empresaFilter =
        args.empresa != null
          ? new Set(
              (Array.isArray(args.empresa) ? args.empresa : [args.empresa]).map(
                normName,
              ),
            )
          : null;
      const blocks = hits.map((h) => {
        const codeLines = Object.entries(h.codigos)
          .filter(([co]) => !empresaFilter || empresaFilter.has(normName(co)))
          .map(([co, cod]) => `  ${co}: ${cod}`);
        return [
          `${h.nome}${h.cnpj ? ` · CNPJ ${h.cnpj}` : ""}`,
          ...(codeLines.length > 0
            ? codeLines
            : ["  (nenhuma das empresas selecionadas)"]),
        ].join("\n");
      });
      return {
        content: [
          {
            type: "text",
            text: `Clientes B2B para "${nome}" (codigo_cliente_omie por empresa):\n\n${blocks.join("\n\n")}\n\nUse o código com omie_consultar_financeiro / omie_listar_pedidos (na empresa correspondente).`,
          },
        ],
      };
    }
    // registry miss → live Omie search (company resolution below)
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

  // Name search: list matching clients (código + razão + CNPJ) so the caller can
  // pick a código and drill in with cnpj/codigo. May return several per company.
  if (byName && nome) {
    const nameBlocks: string[] = [];
    for (const co of selected) {
      const matches = await searchByNameInCompany(
        co.client,
        nome,
        args.incluirPessoaFisica ?? false,
      );
      if (matches.length === 0) continue;
      const lines = matches.slice(0, 25).map((m) => `  ${m.label}`);
      const extra =
        matches.length > 25 ? `\n  (+${matches.length - 25} outros)` : "";
      nameBlocks.push(
        (multi ? `— ${co.label ?? co.code} —\n` : "") + lines.join("\n") + extra,
      );
    }
    if (nameBlocks.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `Nenhum cliente encontrado para "${nome}"${multi ? " nas empresas selecionadas" : ""}.`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `Clientes que correspondem a "${nome}":\n\n${nameBlocks.join("\n\n")}\n\nUse o codigo com omie_consultar_cliente / omie_consultar_financeiro / omie_listar_pedidos.`,
        },
      ],
    };
  }

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
    "Consulta um cliente no Omie por NOME (razão social, busca parcial), CNPJ/CPF ou codigo_cliente_omie. Com `nome`, lista os clientes que correspondem (código + razão + CNPJ) para você escolher; com cnpj/codigo, retorna o cadastro completo. `empresa` aceita um nome ou vários (seleção múltipla) — se houver mais de uma empresa e nada for informado, a tool pede para escolher.",
  inputSchema: {
    nome: z
      .string()
      .optional()
      .describe(
        "Nome / razão social do cliente (busca parcial, ex: 'UAU BOX', 'B4A'). Retorna a lista de correspondências com o codigo_cliente_omie de cada uma. Por padrão mostra só empresas (CNPJ).",
      ),
    incluirPessoaFisica: z
      .boolean()
      .optional()
      .describe(
        "Na busca por nome, inclui pessoas físicas (CPF). Padrão false — só CNPJ (foco B2B).",
      ),
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
