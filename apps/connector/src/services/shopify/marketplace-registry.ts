import type { AdminApiClient } from "@shopify/admin-api-client";
import { PRODUCTS } from "../../generated/catalog-data.js";

/**
 * Generates marketplace product-registration exports from GE Beauty's
 * canonical data (products.json, bundled into catalog-data.ts — see
 * apps/connector/scripts/bundle-catalog.mjs) + live Shopify enrichment
 * (images, descriptions, sourced on demand rather than raw-copied, per
 * the marketplace-registry-field-mapping.md decision #4).
 *
 * One client is implemented today: Sephora, porting the logic already
 * proven in gebeauty/b2b/sephora/sephora_mapper.py. Genuinely external
 * fields (B2B pricing, SAP English names, buyer-assigned codes) stay
 * [PENDENTE] with a named human owner — never guessed, never invented.
 * Adding a new client is a new entry in CLIENT_GENERATORS, following the
 * same shape.
 *
 * Known gap (flagged, not fixed here): the live Sephora template drifted
 * from this column list — it added "VOLUME TOTAL" and appears to have
 * dropped the two Anvisa columns. See marketplace-registry-field-mapping.md.
 * A "does the template still match?" check is a good follow-up, not built yet.
 */

export const GAP = "[PENDENTE]";

type Product = (typeof PRODUCTS)[number];

export type RegistryRow = Record<string, string>;

export type RegistryResult = {
  client: string;
  rows: RegistryRow[];
  columns: string[];
  gapsByColumn: Record<string, number>;
  criticalGaps: Array<{ sku: string; name: string; columns: string[] }>;
};

// ---------------------------------------------------------------------------
// Shopify enrichment — images + first-sentence descriptions, fetched live.
// ---------------------------------------------------------------------------

const ENRICHMENT_QUERY = /* GraphQL */ `
  query MarketplaceRegistryEnrichment($query: String!) {
    products(first: 100, query: $query) {
      nodes {
        title
        descriptionHtml
        featuredImage { url }
        variants(first: 1) {
          nodes { sku barcode }
        }
      }
    }
  }
`;

type EnrichmentResponse = {
  products: {
    nodes: Array<{
      title: string;
      descriptionHtml: string | null;
      featuredImage: { url: string } | null;
      variants: { nodes: Array<{ sku: string | null; barcode: string | null }> };
    }>;
  };
};

type Enrichment = { image: string | null; description: string | null };

function firstSentence(html: string | null): string | null {
  if (!html) return null;
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const match = /^[^.!?]+[.!?]/.exec(text);
  return (match ? match[0] : text).trim();
}

async function fetchEnrichment(
  client: AdminApiClient,
): Promise<{ bySku: Map<string, Enrichment>; byEan: Map<string, Enrichment> }> {
  const res = await client.request<EnrichmentResponse>(ENRICHMENT_QUERY, {
    variables: { query: "product_type:product OR product_type:acessorio" },
  });
  if (res.errors) {
    throw new Error(`Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`);
  }
  const bySku = new Map<string, Enrichment>();
  const byEan = new Map<string, Enrichment>();
  for (const node of res.data?.products.nodes ?? []) {
    const enrichment: Enrichment = {
      image: node.featuredImage?.url ?? null,
      description: firstSentence(node.descriptionHtml),
    };
    const variant = node.variants.nodes[0];
    if (variant?.sku) bySku.set(variant.sku.trim().toUpperCase(), enrichment);
    if (variant?.barcode) byEan.set(variant.barcode.replace(/^0+/, ""), enrichment);
  }
  return { bySku, byEan };
}

function lookupEnrichment(
  tables: { bySku: Map<string, Enrichment>; byEan: Map<string, Enrichment> },
  sku: string,
  ean: string | null,
): Enrichment {
  const bySku = tables.bySku.get(sku.replace(/\s+/g, "").toUpperCase());
  if (bySku) return bySku;
  const eanKey = (ean ?? "").replace(/^0+/, "");
  return tables.byEan.get(eanKey) ?? { image: null, description: null };
}

// ---------------------------------------------------------------------------
// Sephora
// ---------------------------------------------------------------------------

// Sell-in prices — GE Beauty_Cadastro de produtos B2B.xlsx (Drive, Aug 2025).
// Margem 35%: sell_in = sellout × 0.65. Treat as initial reference only —
// Sephora terms are TBD. Owner: Lucas (pricing).
const SEPHORA_B2B_PRICES: Record<string, [number, number]> = {
  "GEB 001": [61.75, 95.0],
  "GEB 002": [61.75, 95.0],
  "GEB 003": [64.35, 99.0],
  "GEB 008": [64.35, 99.0],
  "GEB 010": [26.0, 40.0],
  "GEB 011": [30.55, 47.0],
  "GEB 013": [26.0, 40.0],
  "GEB 019": [48.75, 75.0],
  "GEB 020": [44.85, 69.0],
  "GEB 021": [44.85, 69.0],
  "GEB 022": [51.35, 79.0],
  "GEB 023": [48.75, 75.0],
  "GEB 101": [96.85, 149.0],
  "GEB 102": [90.35, 139.0],
  "GEB 120": [96.85, 149.0],
};

// Proposed English SAP names (max 40 chars). Review with buyer before submitting.
const SEPHORA_SAP_NAMES_EN: Record<string, string> = {
  "GEB 001": "SULFATE-FREE SHAMPOO 250ML",
  "GEB 002": "CONDITIONING MASK 200ML",
  "GEB 003": "THERMAL PROTECTION LEAVE-IN 150ML",
  "GEB 008": "DRY SHAMPOO 150ML",
  "GEB 010": "CONDITIONING MASK 50ML",
  "GEB 011": "THERMAL PROTECTION LEAVE-IN 50ML",
  "GEB 013": "SULFATE-FREE SHAMPOO 60ML",
  "GEB 019": "STRENGTHENING BOOSTER 15ML",
  "GEB 020": "MOISTURIZING BOOSTER 15ML",
  "GEB 021": "DEFINITION BOOSTER 15ML",
  "GEB 022": "ANTI-FRIZZ BOOSTER 15ML",
  "GEB 023": "ANTIOXIDANT BOOSTER 15ML",
  "GEB 024": "MELON MOOD BODY HAIR MIST 200ML",
  "GEB 031": "SANTAL SKIN BODY HAIR MIST 200ML",
  "GEB 032": "ROSE RITUAL BODY HAIR MIST 200ML",
  "GEB 033": "PEAR FRESH BODY HAIR MIST 200ML",
  "GEB 029": "MELON MOOD MINI BODY HAIR MIST",
  "GEB 101": "CURL DEFINING PRIMER 250ML",
  "GEB 102": "STRAIGHT HAIR PRIMER 150ML",
  "GEB 120": "PLUMA LEAVE-IN 200ML",
  "GEB 121": "MAYDAY RECONSTRUCTIVE MASK 200ML",
  "GEB 122": "MAYDAY RECONSTRUCTIVE SHAMPOO",
  "GEB 123": "MAYDAY RECONSTRUCTIVE CONDITIONER",
  "GEB 124": "MAYDAY RECONSTRUCTIVE LEAVE-IN",
  "GEB 126": "MAYDAY OVERNIGHT REPAIR SERUM",
};

const SEPHORA_ACCESSORIES = [
  {
    sku: "7671",
    name_pt: "Escova Oval GE Beauty",
    ean: "7896025537286",
    ncm: "9603.29.00",
    dimensions_mm: { l: 215, w: 20, h: 70 },
    sell_in: 25.35,
    sellout: 39.0,
    sap_en: "OVAL HAIR BRUSH",
  },
  {
    sku: "7685GE",
    name_pt: "Escova Polvo GE Beauty",
    ean: "7896025540705",
    ncm: "9603.29.00",
    dimensions_mm: { l: 45, w: 65, h: 240 },
    sell_in: 31.85,
    sellout: 49.0,
    sap_en: "OCTOPUS DETANGLING BRUSH",
  },
];

const SEPHORA_COLS = [
  "STATUS", "Tipo", "Categoria", "Canal", "Nro Lojas", "Marca", "Vendor",
  "Fornecedor", "Nome Produto (Site)", "Submarca", "Descricao do Item",
  "Nome SAP (ingles, max 40)", "Qtd Chars SAP", "Volumetria (max 5)",
  "Ref Fornecedor", "Profundidade MM", "Largura MM", "Altura MM",
  "Codigo ONU", "Ponto Inflamacao", "Pais Origem", "Codigo HS / NCM",
  "Faturado em Pack", "Qtd Unidades Pack", "EAN Pack", "EAN Unitario",
  "SAP Code (Sephora)", "Status Compra", "Custo S/ IPI (ref B2B)",
  "Custo C/ IPI", "Custo Total", "Markup", "Preco Venda Sugerido",
  "Aliq IPI %", "Aliq ICMS %", "ICMS-ST", "NCM", "NCM ok",
  "Codigo Excecao", "CST Item", "Origem Tributacao", "Nome Etiqueta",
  "Shade/Volumetria", "Status (ONE SHOT / ATIVO)", "Data Lancamento Retail",
  "Data Lancamento Dotcom", "Link Imagem", "Item Exclusivo",
  "Foco Ativacao", "Anvisa Processo", "Anvisa Validade Produto",
];

const SEPHORA_CRITICAL = [
  "EAN Unitario", "Profundidade MM", "Largura MM", "Altura MM",
  "Anvisa Processo", "Custo S/ IPI (ref B2B)",
];

function brl(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

function volFromName(namePt: string): string {
  const n = namePt.toLowerCase().replace(" ml", "ml");
  for (const v of ["250ml", "200ml", "150ml", "100ml", "60ml", "50ml", "15ml"]) {
    if (n.includes(v)) return v.toUpperCase();
  }
  return GAP;
}

function sephoraMapProduct(p: Product, enrichment: Enrichment): RegistryRow {
  const sku = p.sku;
  const dim = p.dimensions_mm ?? { l: null, w: null, h: null };
  const prices = SEPHORA_B2B_PRICES[sku];
  const anvisa = p.anvisa_process ?? GAP;
  const anvisaExpiry = p.anvisa_expiry ?? (anvisa !== GAP ? "3 anos a partir da fabricação" : GAP);
  const sapEn = SEPHORA_SAP_NAMES_EN[sku] ?? GAP;
  const vol = volFromName(p.name_pt);
  const isAerosol = p.name_pt.toLowerCase().includes("seco");
  const desc = enrichment.description ?? p.description_short_pt ?? GAP;
  const img = enrichment.image ?? GAP;

  return {
    STATUS: "NOK",
    Tipo: "PRODUTO",
    Categoria: "CABELO",
    Canal: GAP,
    "Nro Lojas": GAP,
    Marca: "GE Beauty",
    Vendor: GAP,
    Fornecedor: "GE COSMETICOS LTDA",
    "Nome Produto (Site)": p.name_pt,
    Submarca: "",
    "Descricao do Item": desc,
    "Nome SAP (ingles, max 40)": sapEn,
    "Qtd Chars SAP": sapEn !== GAP ? String(sapEn.length) : GAP,
    "Volumetria (max 5)": vol,
    "Ref Fornecedor": sku,
    "Profundidade MM": dim.l != null ? String(dim.l) : GAP,
    "Largura MM": dim.w != null ? String(dim.w) : GAP,
    "Altura MM": dim.h != null ? String(dim.h) : GAP,
    "Codigo ONU": isAerosol ? "1950" : "0",
    "Ponto Inflamacao": isAerosol ? GAP : "N/A",
    "Pais Origem": "BRA",
    "Codigo HS / NCM": p.ncm ?? GAP,
    "Faturado em Pack": "NAO",
    "Qtd Unidades Pack": "1",
    "EAN Pack": "",
    "EAN Unitario": p.ean ?? GAP,
    "SAP Code (Sephora)": GAP,
    "Status Compra": GAP,
    "Custo S/ IPI (ref B2B)": prices ? brl(prices[0]) : GAP,
    "Custo C/ IPI": GAP,
    "Custo Total": GAP,
    Markup: GAP,
    "Preco Venda Sugerido": prices ? brl(prices[1]) : GAP,
    "Aliq IPI %": "0",
    "Aliq ICMS %": GAP,
    "ICMS-ST": "SIM",
    NCM: p.ncm ?? GAP,
    "NCM ok": "",
    "Codigo Excecao": "",
    "CST Item": "60",
    "Origem Tributacao": "0",
    "Nome Etiqueta": p.name_pt,
    "Shade/Volumetria": vol,
    "Status (ONE SHOT / ATIVO)": "ATIVO",
    "Data Lancamento Retail": GAP,
    "Data Lancamento Dotcom": GAP,
    "Link Imagem": img,
    "Item Exclusivo": "NAO",
    "Foco Ativacao": GAP,
    "Anvisa Processo": anvisa,
    "Anvisa Validade Produto": anvisaExpiry,
  };
}

function sephoraMapAccessory(a: (typeof SEPHORA_ACCESSORIES)[number]): RegistryRow {
  return {
    STATUS: "NOK",
    Tipo: "PRODUTO",
    Categoria: "ACESSORIO",
    Canal: GAP,
    "Nro Lojas": GAP,
    Marca: "GE Beauty",
    Vendor: GAP,
    Fornecedor: "GE COSMETICOS LTDA",
    "Nome Produto (Site)": a.name_pt,
    Submarca: "",
    "Descricao do Item": GAP,
    "Nome SAP (ingles, max 40)": a.sap_en,
    "Qtd Chars SAP": String(a.sap_en.length),
    "Volumetria (max 5)": GAP,
    "Ref Fornecedor": a.sku,
    "Profundidade MM": String(a.dimensions_mm.l),
    "Largura MM": String(a.dimensions_mm.w),
    "Altura MM": String(a.dimensions_mm.h),
    "Codigo ONU": "0",
    "Ponto Inflamacao": "0",
    "Pais Origem": "BRA",
    "Codigo HS / NCM": a.ncm,
    "Faturado em Pack": "NAO",
    "Qtd Unidades Pack": "1",
    "EAN Pack": "",
    "EAN Unitario": a.ean,
    "SAP Code (Sephora)": GAP,
    "Status Compra": GAP,
    "Custo S/ IPI (ref B2B)": brl(a.sell_in),
    "Custo C/ IPI": GAP,
    "Custo Total": GAP,
    Markup: GAP,
    "Preco Venda Sugerido": brl(a.sellout),
    "Aliq IPI %": "0",
    "Aliq ICMS %": GAP,
    "ICMS-ST": "NAO",
    NCM: a.ncm,
    "NCM ok": "",
    "Codigo Excecao": "",
    "CST Item": "10",
    "Origem Tributacao": "0",
    "Nome Etiqueta": a.name_pt,
    "Shade/Volumetria": GAP,
    "Status (ONE SHOT / ATIVO)": "ATIVO",
    "Data Lancamento Retail": GAP,
    "Data Lancamento Dotcom": GAP,
    "Link Imagem": GAP,
    "Item Exclusivo": "NAO",
    "Foco Ativacao": GAP,
    "Anvisa Processo": "N/A",
    "Anvisa Validade Produto": "N/A",
  };
}

async function generateSephoraRegistry(client: AdminApiClient): Promise<RegistryResult> {
  const enrichmentTables = await fetchEnrichment(client);
  const registrable = PRODUCTS.filter((p) => p.ean);

  const rows: RegistryRow[] = [
    ...registrable.map((p) =>
      sephoraMapProduct(p, lookupEnrichment(enrichmentTables, p.sku, p.ean)),
    ),
    ...SEPHORA_ACCESSORIES.map(sephoraMapAccessory),
  ];

  const gapsByColumn: Record<string, number> = {};
  const criticalGaps: RegistryResult["criticalGaps"] = [];
  for (const row of rows) {
    const gaps = SEPHORA_COLS.filter((c) => row[c] === GAP);
    for (const c of gaps) gapsByColumn[c] = (gapsByColumn[c] ?? 0) + 1;
    const critical = gaps.filter((c) => SEPHORA_CRITICAL.includes(c));
    if (critical.length > 0) {
      criticalGaps.push({
        sku: row["Ref Fornecedor"] ?? "?",
        name: row["Nome Produto (Site)"] ?? "?",
        columns: critical,
      });
    }
  }

  return { client: "sephora", rows, columns: SEPHORA_COLS, gapsByColumn, criticalGaps };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export const SUPPORTED_CLIENTS = ["sephora"] as const;
export type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];

export async function generateMarketplaceRegistry(
  clientName: SupportedClient,
  shopifyClient: AdminApiClient,
): Promise<RegistryResult> {
  switch (clientName) {
    case "sephora":
      return generateSephoraRegistry(shopifyClient);
    default: {
      const exhaustive: never = clientName;
      throw new Error(`Unsupported client: ${String(exhaustive)}`);
    }
  }
}

export function toCsv(result: RegistryResult): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [result.columns.map(escape).join(",")];
  for (const row of result.rows) {
    lines.push(result.columns.map((c) => escape(row[c] ?? "")).join(","));
  }
  return lines.join("\n");
}
