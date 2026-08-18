import { describe, expect, it } from "vitest";
import { resolveChannel } from "../delivery-channel.js";

function order(overrides: Partial<Parameters<typeof resolveChannel>[0]> = {}) {
  return {
    sourceName: "web",
    appGid: null,
    customAttributes: [],
    shippingLineTitle: "Correios",
    ...overrides,
  };
}

describe("resolveChannel", () => {
  it("treats a missing shipping line as sold in-store", () => {
    const result = resolveChannel(order({ shippingLineTitle: null }));
    expect(result.type).toBe("instore");
    expect(result.label).toBe("Em loja");
  });

  it("recognizes a local-delivery shipping line by its literal 'Entrega local' prefix", () => {
    const result = resolveChannel(order({ shippingLineTitle: "Entrega local - Shops Jardins" }));
    expect(result.type).toBe("local");
    expect(result.specific).toBe("Lalamove");
  });

  it.each(["Retirada em loja", "Pickup Extrema", "pick-up"])(
    "recognizes a pickup-titled shipping line: %s",
    (title) => {
      const result = resolveChannel(order({ shippingLineTitle: title }));
      expect(result.type).toBe("pickup");
    },
  );

  it("falls back to 'standard' for any other shipping-line title", () => {
    const result = resolveChannel(order({ shippingLineTitle: "Total Express MG" }));
    expect(result.type).toBe("standard");
    expect(result.label).toBe("Entrega padrão");
    expect(result.specific).toBe("Total Express MG");
  });

  // The known IGLU/Hexagon methodType-unreliability finding — same strong
  // signal as gebeauty/scripts/_verify_hexagon_methodtype_48h.py. Still
  // applies even without fulfillmentOrders: the custom attribute overrides
  // the shipping-line-based guess.
  it("overrides the shipping-line guess with the custom attribute for IGLU/Hexagon orders", () => {
    const result = resolveChannel(
      order({
        sourceName: "hexagon",
        shippingLineTitle: null, // would otherwise read as "instore"
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
        shippingLineTitle: null,
        customAttributes: [{ key: "shipping_additional_delivery_method_type", value: "PICKUP" }],
      }),
    );
    expect(result.type).toBe("pickup");
  });

  it("falls back to the shipping-line guess for IGLU/Hexagon orders when the custom attribute is missing/unrecognized", () => {
    const result = resolveChannel(order({ sourceName: "hexagon", shippingLineTitle: null, customAttributes: [] }));
    expect(result.type).toBe("instore");
  });
});
