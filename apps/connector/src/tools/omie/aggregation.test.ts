import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OmieClient } from "../../clients/omie.js";

vi.mock("../../clients/omie.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../clients/omie.js")>();
  return { ...actual, resolveClienteName: vi.fn() };
});

import { resolveClienteName } from "../../clients/omie.js";
import {
  aggregateItems,
  classifyTipo,
  filterByTipo,
  type AggregatableItem,
} from "./aggregation.js";

function item(overrides: Partial<AggregatableItem>): AggregatableItem {
  return {
    empresaCodigo: "matriz",
    empresaLabel: "Matriz",
    empresaClient: {} as OmieClient,
    categoriaDescricao: "Fretes sobre Vendas",
    categoriaCodigoRaw: "4.1.03.01.006",
    fornecedorCodigo: 1,
    dataVencimento: "2026-06-01",
    valor: 100,
    status: "pago",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(resolveClienteName).mockReset();
});

describe("classifyTipo", () => {
  it("flags the intercompany transfer category", () => {
    expect(classifyTipo("1.1.03.02.999", "Transferências entre Empresas")).toBe("intercompany");
  });
  it("flags bank tariffs and ICMS DIFAL as imposto", () => {
    expect(classifyTipo("4.4.01.02.004", "Tarifas Bancárias e Cartões")).toBe("imposto");
    expect(classifyTipo("x", "ICMS DIFAL a recolher")).toBe("imposto");
  });
  it("flags devolução/estorno", () => {
    expect(classifyTipo("x", "Devoluções de Vendas de Mercadoria")).toBe("estorno");
  });
  it("defaults to externo", () => {
    expect(classifyTipo("4.1.03.01.006", "Fretes sobre Vendas")).toBe("externo");
  });
});

describe("filterByTipo", () => {
  it("excludes items whose category classifies as one of the excluded tipos", () => {
    const items = [
      item({ categoriaCodigoRaw: "1.1.03.02.999", categoriaDescricao: "Transferências entre Empresas" }),
      item({ categoriaCodigoRaw: "4.1.03.01.006", categoriaDescricao: "Fretes sobre Vendas" }),
    ];
    const result = filterByTipo(items, ["intercompany"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.categoriaDescricao).toBe("Fretes sobre Vendas");
  });
  it("returns all items unchanged when excluir is undefined", () => {
    const items = [item({})];
    expect(filterByTipo(items, undefined)).toBe(items);
  });
});

describe("aggregateItems", () => {
  it("groups by categoria, sums by status, and tags tipo", async () => {
    const items = [
      item({ valor: 500, status: "pago" }),
      item({ valor: 300, status: "vencido" }),
      item({ categoriaDescricao: "Aluguel", categoriaCodigoRaw: "4.2.02.05.002", valor: 900, status: "pago" }),
    ];
    const { rows } = await aggregateItems(items, ["categoria"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.nome).toBe("Aluguel"); // ranked first — higher total
    expect(rows[0]?.valor_pago).toBe(900);
    expect(rows[1]?.nome).toBe("Fretes sobre Vendas");
    expect(rows[1]?.valor_pago).toBe(500);
    expect(rows[1]?.valor_vencido).toBe(300);
    expect(rows[1]?.tipo).toBe("externo");
  });

  it("never merges the same raw fornecedor code across two different companies", async () => {
    vi.mocked(resolveClienteName).mockImplementation(async (_client, codigo) =>
      codigo === 1 ? "Vendor From Matriz" : "unexpected",
    );
    const items = [
      item({ empresaCodigo: "matriz", empresaLabel: "Matriz", fornecedorCodigo: 1, valor: 100 }),
      item({ empresaCodigo: "extrema", empresaLabel: "Extrema", fornecedorCodigo: 1, valor: 200 }),
    ];
    // Extrema's resolveClienteName call should resolve to a distinct name, not "Vendor From Matriz".
    vi.mocked(resolveClienteName).mockImplementation(async (_client, codigo, cache) => {
      const name = codigo === 1 ? "SAME CODE DIFFERENT VENDOR" : "unexpected";
      cache.set(codigo, name);
      return name;
    });
    const { rows } = await aggregateItems(items, ["fornecedor"]);
    expect(rows).toHaveLength(2); // one row per (empresa, codigo) pair, never merged
    expect(rows.every((r) => r.nome.includes("(Matriz)") || r.nome.includes("(Extrema)"))).toBe(true);
  });

  it("rolls the long tail into an Outros bucket past the top-K, preserving total value", async () => {
    vi.mocked(resolveClienteName).mockImplementation(async (_client, codigo, cache) => {
      const name = `Fornecedor ${codigo}`;
      cache.set(codigo, name);
      return name;
    });
    const items = Array.from({ length: 45 }, (_, i) =>
      item({ fornecedorCodigo: i + 1, valor: 100 - i, status: "pago" }),
    );
    const { rows, fornecedorTruncated } = await aggregateItems(items, ["fornecedor"]);
    expect(fornecedorTruncated).toBe(true);
    expect(rows).toHaveLength(41); // top 40 + 1 "Outros" row
    const outros = rows.find((r) => r.nome.includes("Outros"));
    expect(outros).toBeDefined();
    const grandTotal = rows.reduce((sum, r) => sum + r.valor_pago, 0);
    const expectedTotal = items.reduce((sum, i) => sum + i.valor, 0);
    expect(grandTotal).toBeCloseTo(expectedTotal, 2);
  });

  it("supports cross-tab groupBy (empresa + categoria)", async () => {
    const items = [
      item({ empresaCodigo: "matriz", empresaLabel: "Matriz", categoriaDescricao: "Aluguel", valor: 500, status: "pago" }),
      item({ empresaCodigo: "extrema", empresaLabel: "Extrema", categoriaDescricao: "Aluguel", valor: 300, status: "pago" }),
    ];
    const { rows } = await aggregateItems(items, ["empresa", "categoria"]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.nome).sort()).toEqual(["Extrema · Aluguel", "Matriz · Aluguel"]);
  });
});
