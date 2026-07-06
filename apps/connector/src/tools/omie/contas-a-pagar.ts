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

type ContaPagar = {
  codigo_lancamento_omie: number;
  codigo_cliente_fornecedor?: number;
  numero_documento: string | null;
  data_vencimento: string; // dd/mm/yyyy
  valor_documento: number;
  status_titulo: "PAGO" | "A_PAGAR" | "VENCIDO" | string;
  observacao: string | null;
};
type ListarContasPagarResponse = {
  conta_pagar_cadastro?: ContaPagar[];
  total_de_paginas?: number;
  total_de_registros?: number;
};

// Without a supplier filter we walk the whole payables ledger, capped.
const ALL_MAX_PAGES = 15;

function brToYmd(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : br;
}

async function fetchApForSupplier(
  client: OmieClient,
  filters: { codigo?: number; cnpj?: string },
): Promise<{ items: ContaPagar[]; totalRegistros: number }> {
  const scoped = filters.codigo !== undefined || filters.cnpj !== undefined;
  const maxPages = scoped ? 5 : ALL_MAX_PAGES;
  const items: ContaPagar[] = [];
  let totalRegistros = 0;

  for (let pagina = 1; pagina <= maxPages; pagina += 1) {
    const res = await client.call<
      Record<string, unknown>,
      ListarContasPagarResponse
    >({
      resource: "financas/contapagar",
      method: "ListarContasPagar",
      param: {
        pagina,
        registros_por_pagina: 200,
        apenas_importado_api: "N",
        ...(filters.codigo !== undefined
          ? { filtrar_cliente: filters.codigo }
          : {}),
        ...(filters.cnpj !== undefined
          ? { filtrar_por_cpf_cnpj: filters.cnpj }
          : {}),
      },
    });
    if (!res.ok) {
      if (/n[ãa]o existem registros/i.test(res.faultstring)) break;
      throw new Error(`Omie ListarContasPagar failed: ${res.faultstring}`);
    }
    const page = res.data.conta_pagar_cadastro ?? [];
    items.push(...page);
    totalRegistros = res.data.total_de_registros ?? totalRegistros;
    const totalPaginas = res.data.total_de_paginas;
    if (
      page.length === 0 ||
      page.length < 200 || // partial page = last page
      (totalPaginas !== undefined && pagina >= totalPaginas)
    ) {
      break;
    }
  }
  return { items, totalRegistros: totalRegistros || items.length };
}

export async function contasAPagarHandler(
  args: {
    empresa?: string | string[] | undefined;
    codigoFornecedor?: number | undefined;
    cnpjFornecedor?: string | undefined;
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
  const cnpj = args.cnpjFornecedor
    ? args.cnpjFornecedor.replace(/\D/g, "")
    : undefined;
  const scoped = args.codigoFornecedor !== undefined || cnpj !== undefined;
  const scopeLabel = cnpj
    ? `fornecedor CNPJ ${args.cnpjFornecedor}`
    : args.codigoFornecedor !== undefined
      ? `fornecedor ${args.codigoFornecedor}`
      : "todos os fornecedores";

  const blocks: string[] = [];
  let grandP = 0;
  let grandV = 0;
  let grandPago = 0;
  let anyItems = false;

  for (const co of selected) {
    const name = co.label ?? co.code;
    const { items, totalRegistros } = await fetchApForSupplier(co.client, {
      ...(args.codigoFornecedor !== undefined
        ? { codigo: args.codigoFornecedor }
        : {}),
      ...(cnpj !== undefined ? { cnpj } : {}),
    });
    const tag = multi ? `— ${name} —` : null;
    if (items.length === 0) {
      if (tag) blocks.push(`${tag}\nSem lançamentos.`);
      continue;
    }
    anyItems = true;

    let aPagar = 0;
    let vencido = 0;
    let pago = 0;
    for (const item of items) {
      if (item.status_titulo === "PAGO") pago += item.valor_documento;
      else if (/venc|atras/i.test(item.status_titulo))
        vencido += item.valor_documento;
      else aPagar += item.valor_documento;
    }
    grandP += aPagar;
    grandV += vencido;
    grandPago += pago;

    const lineCount = multi ? 10 : 25;
    const lines = items
      .slice()
      .sort((x, y) =>
        brToYmd(x.data_vencimento).localeCompare(brToYmd(y.data_vencimento)),
      )
      .slice(0, lineCount)
      .map((item) => {
        const num = item.numero_documento ?? `#${item.codigo_lancamento_omie}`;
        const forn =
          !scoped && item.codigo_cliente_fornecedor
            ? `fornecedor ${item.codigo_cliente_fornecedor} · `
            : "";
        return `  ${forn}${num} · vence ${item.data_vencimento} · R$ ${item.valor_documento.toFixed(2)} · ${item.status_titulo}`;
      });

    const capped = !scoped && totalRegistros > items.length;
    const more = capped
      ? ` (mostrando ${lineCount} de ${items.length} carregados; ledger tem ${totalRegistros})`
      : items.length > lineCount
        ? ` (mostrando ${lineCount} de ${items.length})`
        : "";
    const head = [
      tag,
      `A pagar: R$ ${aPagar.toFixed(2)} · Vencido: R$ ${vencido.toFixed(2)} · Pago: R$ ${pago.toFixed(2)}`,
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
          text: `Nenhum lançamento a pagar para ${scopeLabel}${multi ? " nas empresas selecionadas" : ""}.`,
        },
      ],
    };
  }

  const single = !multi ? ` · ${selected[0]!.label ?? selected[0]!.code}` : "";
  const grand = multi
    ? `\n\nTotal consolidado — A pagar: R$ ${grandP.toFixed(2)} · Vencido: R$ ${grandV.toFixed(2)} · Pago: R$ ${grandPago.toFixed(2)}`
    : "";

  return {
    content: [
      {
        type: "text",
        text: `Contas a pagar · ${scopeLabel}${single}\n\n${blocks.join("\n\n")}${grand}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "omie_contas_a_pagar",
  description:
    "Contas a pagar no Omie por empresa (fornecedores). Informe `cnpjFornecedor` (exato) ou `codigoFornecedor` para focar num fornecedor; sem filtro, resume a carteira de pagáveis. `empresa` aceita um nome ou vários. Retorna a pagar/vencido/pago por empresa + total consolidado. Obs: NFS-e de serviço não têm DANFE/XML dentro do Omie.",
  inputSchema: {
    cnpjFornecedor: z
      .string()
      .optional()
      .describe(
        "CNPJ/CPF do fornecedor (aceita máscara). Filtro exato — jeito preferido de focar num fornecedor.",
      ),
    codigoFornecedor: z
      .number()
      .int()
      .optional()
      .describe("codigo_cliente_omie do fornecedor (se você já tem o código)."),
    empresa: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "Nome da empresa Omie (ex: 'Matriz') ou lista. Omita para escolher via pergunta quando houver mais de uma.",
      ),
  },
  handler: contasAPagarHandler,
});
