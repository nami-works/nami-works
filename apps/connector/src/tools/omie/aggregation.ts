// Shared aggregation engine for omie_contas_a_pagar / omie_consultar_financeiro's
// `groupBy` feature. Omie's list APIs have no server-side grouping/resumo call
// (confirmed against Omie's docs) — every aggregate here is computed from the
// full set of line items already fetched for the window, client-side.
//
// Correctness note: `codigo_cliente_fornecedor` is scoped PER OMIE COMPANY (each
// of the 6 companies is a distinct Omie account with its own numbering) — the
// same raw code can mean a different real-world supplier in a different
// company. Fornecedor grouping therefore never merges across companies by raw
// code; when a name is needed it's resolved per (empresa, codigo) pair and, if
// `empresa` isn't itself one of the requested dims, the company name is
// appended to the label so two "same code, different company" rows are never
// mistaken for one supplier.

import type { OmieClient } from "../../clients/omie.js";
import { resolveClienteName } from "../../clients/omie.js";

export type GroupByKey = "categoria" | "fornecedor" | "empresa" | "mes";
export type TipoFlag = "externo" | "intercompany" | "imposto" | "estorno";
export type NormalizedStatus = "pago" | "aberto" | "vencido";

export interface AggregatableItem {
  empresaCodigo: string;
  empresaLabel: string;
  empresaClient: OmieClient;
  categoriaDescricao: string;
  categoriaCodigoRaw: string | null;
  fornecedorCodigo: number | null;
  dataVencimento: string; // yyyy-mm-dd
  valor: number;
  status: NormalizedStatus;
}

export interface AggregateRow {
  chave: string;
  nome: string;
  tipo?: TipoFlag;
  valor_pago: number;
  valor_aberto: number;
  valor_vencido: number;
  contagem: number;
}

// Suppliers/customers are resolved one Omie call each (cached per company) —
// bounding this keeps a wide `groupBy: ["fornecedor"]` window from turning
// into hundreds of gated name lookups. Anything past the top-K value-ranked
// buckets is rolled into an "Outros" row so totals still reconcile — never
// silently dropped.
const FORNECEDOR_TOP_K = 40;

export function classifyTipo(
  categoriaCodigo: string | null,
  categoriaDescricao: string,
): TipoFlag {
  const desc = categoriaDescricao.toLowerCase();
  if (
    categoriaCodigo === "1.1.03.02.999" ||
    /transfer[êe]ncias?\s+entre\s+empresas/.test(desc)
  ) {
    return "intercompany";
  }
  if (
    /\bicms\b|\bdifal\b|\bpis\b|\bcofins\b|\biss\b|\bipva\b|\biptu\b|\biof\b|tarifa|tribut|imposto/.test(
      desc,
    )
  ) {
    return "imposto";
  }
  if (/devolu[çc]|estorno|reembolso/.test(desc)) return "estorno";
  return "externo";
}

export function filterByTipo(
  items: AggregatableItem[],
  excluir: TipoFlag[] | undefined,
): AggregatableItem[] {
  if (!excluir || excluir.length === 0) return items;
  const excludeSet = new Set(excluir);
  return items.filter(
    (item) =>
      !excludeSet.has(classifyTipo(item.categoriaCodigoRaw, item.categoriaDescricao)),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function rowTotal(r: {
  valor_pago: number;
  valor_aberto: number;
  valor_vencido: number;
}): number {
  return r.valor_pago + r.valor_aberto + r.valor_vencido;
}

type KeyPart = { key: string; label: string };

type Bucket = {
  parts: KeyPart[];
  valor_pago: number;
  valor_aberto: number;
  valor_vencido: number;
  contagem: number;
  tipo?: TipoFlag;
  repItem: AggregatableItem;
};

export interface AggregateResult {
  rows: AggregateRow[];
  fornecedorTruncated: boolean;
}

export async function aggregateItems(
  items: AggregatableItem[],
  dims: GroupByKey[],
): Promise<AggregateResult> {
  const includesCategoria = dims.includes("categoria");
  const includesFornecedor = dims.includes("fornecedor");
  const includesEmpresa = dims.includes("empresa");

  function rawKeyParts(item: AggregatableItem): KeyPart[] {
    return dims.map((d) => {
      if (d === "categoria") {
        return { key: item.categoriaDescricao, label: item.categoriaDescricao };
      }
      if (d === "empresa") {
        return { key: item.empresaCodigo, label: item.empresaLabel };
      }
      if (d === "mes") {
        const mes = item.dataVencimento.slice(0, 7);
        return { key: mes, label: mes };
      }
      // fornecedor — key is company-scoped (see module doc comment); label
      // starts as a placeholder and gets resolved to a real name below, only
      // for buckets that survive top-K trimming.
      const code = item.fornecedorCodigo;
      const key =
        code !== null ? `${item.empresaCodigo}#${code}` : `${item.empresaCodigo}#sem-fornecedor`;
      return { key, label: key };
    });
  }

  const buckets = new Map<string, Bucket>();
  for (const item of items) {
    const parts = rawKeyParts(item);
    const chave = parts.map((p) => p.key).join("|");
    let bucket = buckets.get(chave);
    if (!bucket) {
      bucket = {
        parts,
        valor_pago: 0,
        valor_aberto: 0,
        valor_vencido: 0,
        contagem: 0,
        repItem: item,
      };
      if (includesCategoria) {
        bucket.tipo = classifyTipo(item.categoriaCodigoRaw, item.categoriaDescricao);
      }
      buckets.set(chave, bucket);
    }
    if (item.status === "pago") bucket.valor_pago += item.valor;
    else if (item.status === "vencido") bucket.valor_vencido += item.valor;
    else bucket.valor_aberto += item.valor;
    bucket.contagem += 1;
  }

  let bucketList = Array.from(buckets.values());
  let fornecedorTruncated = false;

  if (includesFornecedor) {
    bucketList.sort((a, b) => rowTotal(b) - rowTotal(a));
    if (bucketList.length > FORNECEDOR_TOP_K) {
      fornecedorTruncated = true;
      const top = bucketList.slice(0, FORNECEDOR_TOP_K);
      const rest = bucketList.slice(FORNECEDOR_TOP_K);
      const outros: Bucket = {
        parts: [{ key: "outros", label: "Outros (cauda longa, agregado)" }],
        valor_pago: 0,
        valor_aberto: 0,
        valor_vencido: 0,
        contagem: 0,
        repItem: rest[0]!.repItem,
      };
      for (const b of rest) {
        outros.valor_pago += b.valor_pago;
        outros.valor_aberto += b.valor_aberto;
        outros.valor_vencido += b.valor_vencido;
        outros.contagem += b.contagem;
      }
      bucketList = [...top, outros];
    }

    const fornecedorIdx = dims.indexOf("fornecedor");
    const nomeCachesByEmpresa = new Map<string, Map<number, string>>();
    for (const bucket of bucketList) {
      const part = bucket.parts[fornecedorIdx]!;
      if (part.key === "outros" || part.key.endsWith("#sem-fornecedor")) continue;
      const code = bucket.repItem.fornecedorCodigo;
      if (code === null) continue;
      const empresaCodigo = bucket.repItem.empresaCodigo;
      let cache = nomeCachesByEmpresa.get(empresaCodigo);
      if (!cache) {
        cache = new Map<number, string>();
        nomeCachesByEmpresa.set(empresaCodigo, cache);
      }
      const nome = await resolveClienteName(bucket.repItem.empresaClient, code, cache);
      part.label = includesEmpresa ? nome : `${nome} (${bucket.repItem.empresaLabel})`;
    }
  }

  const rows: AggregateRow[] = bucketList
    .map((b) => ({
      chave: b.parts.map((p) => p.key).join("|"),
      nome: b.parts.map((p) => p.label).join(" · "),
      ...(b.tipo ? { tipo: b.tipo } : {}),
      valor_pago: round2(b.valor_pago),
      valor_aberto: round2(b.valor_aberto),
      valor_vencido: round2(b.valor_vencido),
      contagem: b.contagem,
    }))
    .sort((a, b) => rowTotal(b) - rowTotal(a));

  return { rows, fornecedorTruncated };
}

export const GROUP_BY_VALUES: GroupByKey[] = ["categoria", "fornecedor", "empresa", "mes"];
export const TIPO_VALUES: TipoFlag[] = ["externo", "intercompany", "imposto", "estorno"];
