import { describe, expect, it } from "vitest";
import { resolveChannel } from "../delivery-channel.js";

function order(overrides: Partial<Parameters<typeof resolveChannel>[0]> = {}) {
  return {
    sourceName: "web",
    appGid: null,
    methodType: null,
    customAttributes: [],
    shippingLineTitle: null,
    locationName: null,
    ...overrides,
  };
}

describe("resolveChannel", () => {
  it.each([
    ["SHIPPING", "standard", "Entrega padrão"],
    ["LOCAL", "local", "Entrega local"],
    ["PICK_UP", "pickup", "Retirada em loja"],
    ["RETAIL", "instore", "Em loja"],
  ] as const)("maps methodType=%s to %s", (methodType, type, label) => {
    const result = resolveChannel(order({ methodType }));
    expect(result.type).toBe(type);
    expect(result.label).toBe(label);
  });

  it("falls back to 'Delivery' when methodType is null/unrecognized", () => {
    const result = resolveChannel(order({ methodType: null }));
    expect(result.type).toBe("fallback");
    expect(result.label).toBe("Delivery");
  });

  it("uses the location name as the specific label for in-store orders", () => {
    const result = resolveChannel(order({ methodType: "RETAIL", locationName: "Shops Jardins" }));
    expect(result.specific).toBe("Shops Jardins");
  });

  it("uses 'Lalamove' as the specific label for local-delivery orders", () => {
    const result = resolveChannel(order({ methodType: "LOCAL" }));
    expect(result.specific).toBe("Lalamove");
  });

  it("uses the shipping-line title as the specific label for standard shipping", () => {
    const result = resolveChannel(order({ methodType: "SHIPPING", shippingLineTitle: "Total Express MG" }));
    expect(result.specific).toBe("Total Express MG");
  });

  // The known IGLU/Hexagon methodType-unreliability finding — same strong
  // signal as gebeauty/scripts/_verify_hexagon_methodtype_48h.py.
  it("overrides methodType with the custom attribute for IGLU/Hexagon orders", () => {
    const result = resolveChannel(
      order({
        sourceName: "hexagon",
        methodType: "RETAIL", // wrong, per the known issue
        customAttributes: [{ key: "shipping_additional_delivery_method_type", value: "LOCAL" }],
      }),
    );
    expect(result.type).toBe("local");
  });

  it("detects the IGLU/Hexagon app via app id even when sourceName doesn't say 'hexagon'", () => {
    const result = resolveChannel(
      order({
        sourceName: "pos",
        appGid: "gid://shopify/App/316281618433",
        methodType: "RETAIL",
        customAttributes: [{ key: "shipping_additional_delivery_method_type", value: "PICKUP" }],
      }),
    );
    expect(result.type).toBe("pickup");
  });

  it("falls back to methodType for IGLU/Hexagon orders when the custom attribute is missing/unrecognized", () => {
    const result = resolveChannel(order({ sourceName: "hexagon", methodType: "RETAIL", customAttributes: [] }));
    expect(result.type).toBe("instore");
  });
});
