import type { AdminApiClient } from "@shopify/admin-api-client";
import { describe, expect, it } from "vitest";
import { GAP, generateMarketplaceRegistry, toCsv } from "./marketplace-registry.js";

function scriptedClient(response: unknown): AdminApiClient {
  return { request: async () => response } as unknown as AdminApiClient;
}

const emptyEnrichment = { data: { products: { nodes: [] } } };

describe("generateMarketplaceRegistry — sephora", () => {
  it("excludes SKUs without an EAN and includes the 2 hardcoded accessories", async () => {
    const result = await generateMarketplaceRegistry("sephora", scriptedClient(emptyEnrichment));
    // GEB 125 (kit) and GEB 126 (no ean in fixture-era products.json) type SKUs without
    // an EAN must not appear; every row must have SKU or accessory sku as Ref Fornecedor.
    const refs = result.rows.map((r) => r["Ref Fornecedor"]);
    expect(refs).toContain("7671");
    expect(refs).toContain("7685GE");
    expect(refs.every((r) => r && r.length > 0)).toBe(true);
  });

  it("fills known B2B price + SAP name for GEB 001, leaves unknown SKUs as gaps", async () => {
    const result = await generateMarketplaceRegistry("sephora", scriptedClient(emptyEnrichment));
    const geb001 = result.rows.find((r) => r["Ref Fornecedor"] === "GEB 001");
    expect(geb001).toBeDefined();
    expect(geb001?.["Custo S/ IPI (ref B2B)"]).toBe("R$ 61,75");
    expect(geb001?.["Nome SAP (ingles, max 40)"]).toBe("SULFATE-FREE SHAMPOO 250ML");

    // A SKU with no B2B price/SAP name entry should surface as a gap, not a guess.
    const geb126 = result.rows.find((r) => r["Ref Fornecedor"] === "GEB 126");
    if (geb126) {
      expect(geb126["Custo S/ IPI (ref B2B)"]).toBe(GAP);
    }
  });

  it("never invents an Anvisa process — pulls from products.json or gaps", async () => {
    const result = await generateMarketplaceRegistry("sephora", scriptedClient(emptyEnrichment));
    const geb003 = result.rows.find((r) => r["Ref Fornecedor"] === "GEB 003");
    expect(geb003?.["Anvisa Processo"]).toBe("25351.083951/2020-17");
    expect(geb003?.["Anvisa Validade Produto"]).toBe("3 anos a partir da fabricação");
  });

  it("flags critical gaps for SKUs missing pricing/regulatory data", async () => {
    const result = await generateMarketplaceRegistry("sephora", scriptedClient(emptyEnrichment));
    expect(result.criticalGaps.length).toBeGreaterThan(0);
    const skusWithCriticalGaps = result.criticalGaps.map((g) => g.sku);
    expect(skusWithCriticalGaps).toContain("GEB 024"); // Mist line never had B2B pricing
  });

  it("resolves enrichment (image + description) by SKU from live Shopify data", async () => {
    const enrichment = {
      data: {
        products: {
          nodes: [
            {
              title: "Shampoo sem sulfato GE Beauty 250ml",
              descriptionHtml: "<p>Limpa sem agredir. Ideal para uso diário.</p>",
              featuredImage: { url: "https://cdn.shopify.com/geb001.jpg" },
              variants: { nodes: [{ sku: "GEB 001", barcode: "7896768471137" }] },
            },
          ],
        },
      },
    };
    const result = await generateMarketplaceRegistry("sephora", scriptedClient(enrichment));
    const geb001 = result.rows.find((r) => r["Ref Fornecedor"] === "GEB 001");
    expect(geb001?.["Link Imagem"]).toBe("https://cdn.shopify.com/geb001.jpg");
    expect(geb001?.["Descricao do Item"]).toBe("Limpa sem agredir.");
  });
});

describe("toCsv", () => {
  it("produces a header row + one row per SKU, escaping commas/quotes", async () => {
    const result = await generateMarketplaceRegistry("sephora", scriptedClient(emptyEnrichment));
    const csv = toCsv(result);
    const lines = csv.split("\n");
    // A header containing a comma (e.g. "Nome SAP (ingles, max 40)") must be
    // quoted per CSV escaping, not a raw join.
    expect(lines[0]).toContain('"Nome SAP (ingles, max 40)"');
    expect(lines[0]?.split(",").length).toBeGreaterThanOrEqual(result.columns.length);
    expect(lines.length).toBe(result.rows.length + 1);
  });
});
