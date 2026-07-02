import { describe, expect, it } from "vitest";
import { canUseTool, computeEffectiveAccess } from "./access.js";
import type { ToolCatalogEntry } from "./tool-catalog.js";

describe("computeEffectiveAccess", () => {
  it("returns no access for a principal with no roles", () => {
    expect(computeEffectiveAccess([])).toEqual({ isOwner: false, systems: {} });
  });

  it("flags owner when any role isOwner", () => {
    const a = computeEffectiveAccess([{ isOwner: true, grants: {} }]);
    expect(a.isOwner).toBe(true);
  });

  it("maps a role's grants to systems", () => {
    const a = computeEffectiveAccess([
      { isOwner: false, grants: { shopify_orders: "read", omie: "readwrite" } },
    ]);
    expect(a.isOwner).toBe(false);
    expect(a.systems.shopify_orders).toBe("read");
    expect(a.systems.omie).toBe("readwrite");
  });

  it("unions multiple roles, keeping the highest level per system", () => {
    const a = computeEffectiveAccess([
      { isOwner: false, grants: { shopify_orders: "read", shopify_products: "read" } },
      { isOwner: false, grants: { shopify_orders: "readwrite", omie: "read" } },
    ]);
    expect(a.systems.shopify_orders).toBe("readwrite"); // read ∪ readwrite → readwrite
    expect(a.systems.shopify_products).toBe("read");
    expect(a.systems.omie).toBe("read");
  });

  it("ignores invalid / 'none' grant values and non-object grants", () => {
    const a = computeEffectiveAccess([
      { isOwner: false, grants: { shopify_orders: "none", shopify_products: "bogus" } },
      { isOwner: false, grants: null },
    ]);
    expect(a.systems).toEqual({});
  });
});

describe("canUseTool", () => {
  const read = (system: string): ToolCatalogEntry => ({ system: system as never, write: false });
  const write = (system: string): ToolCatalogEntry => ({ system: system as never, write: true });

  it("always allows alwaysAvailable tools", () => {
    const entry: ToolCatalogEntry = { system: "brand", write: false, alwaysAvailable: true };
    expect(canUseTool({ isOwner: false, systems: {} }, entry)).toBe(true);
  });

  it("owner may use anything", () => {
    expect(canUseTool({ isOwner: true, systems: {} }, write("shopify_discounts"))).toBe(true);
  });

  it("read tool needs read or readwrite on its system", () => {
    expect(canUseTool({ isOwner: false, systems: { shopify_orders: "read" } }, read("shopify_orders"))).toBe(true);
    expect(canUseTool({ isOwner: false, systems: { shopify_orders: "readwrite" } }, read("shopify_orders"))).toBe(true);
    expect(canUseTool({ isOwner: false, systems: {} }, read("shopify_orders"))).toBe(false);
  });

  it("write tool needs readwrite; read access is not enough", () => {
    expect(canUseTool({ isOwner: false, systems: { shopify_orders: "read" } }, write("shopify_orders"))).toBe(false);
    expect(canUseTool({ isOwner: false, systems: { shopify_orders: "readwrite" } }, write("shopify_orders"))).toBe(true);
  });

  it("denies a tool whose system the principal has no grant for", () => {
    expect(canUseTool({ isOwner: false, systems: { omie: "readwrite" } }, read("shopify_orders"))).toBe(false);
  });
});
