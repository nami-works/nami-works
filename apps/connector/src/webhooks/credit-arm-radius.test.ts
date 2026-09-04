import { describe, expect, it } from "vitest";
import { resolveForcedArmReason } from "./credit-arm-radius.js";

describe("resolveForcedArmReason", () => {
  it("forces the arm when there's no shipping address (POS / pickup-in-store)", () => {
    expect(resolveForcedArmReason(null)).toBe("pickup_or_instore");
  });

  it("does not force when the address exists but wasn't geocoded", () => {
    expect(resolveForcedArmReason({ latitude: null, longitude: null })).toBeNull();
  });

  it("forces the arm for an address within 100km of a physical store", () => {
    // ~2km from Shops Jardins (São Paulo) — real coordinate from the
    // sales-whatsapp locations fixture.
    const reason = resolveForcedArmReason({ latitude: -23.55, longitude: -46.65 });
    expect(reason).toMatch(/^within_100km_/);
  });

  it("does not force for an address far from every store", () => {
    // Manaus — real order coordinate observed live, ~2700km+ from every
    // GE Beauty physical location.
    expect(resolveForcedArmReason({ latitude: -3.0847852, longitude: -59.9955498 })).toBeNull();
  });

  it("forces for an address exactly at a store's coordinates", () => {
    expect(resolveForcedArmReason({ latitude: -22.9569089, longitude: -43.1761858 })).toBe(
      "within_100km_riosul",
    );
  });
});
