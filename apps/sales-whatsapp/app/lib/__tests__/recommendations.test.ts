import { describe, expect, it } from "vitest";
import { canon, recommendFor } from "../recommendations.js";

describe("canon", () => {
  it("maps known product titles to canonical names", () => {
    expect(canon("Shampoo Sem Sulfato")).toBe("shampoo sem sulfato");
    expect(canon("Melon Mood | Body & Hair Mist")).toBe("melon mood mist");
    expect(canon("Travel Size | Máscara Condicionadora")).toBe("máscara condicionadora");
    expect(canon("Leave-in com Proteção Térmica")).toBe("leave-in proteção térmica");
  });

  it("returns null for non-core products (kits, accessories)", () => {
    expect(canon("Kit Presente")).toBeNull();
    expect(canon("Nécessaire")).toBeNull();
    expect(canon(null)).toBeNull();
  });
});

describe("recommendFor", () => {
  it("recommends the most recent core product as repor", () => {
    const rec = recommendFor([
      { createdAt: "2026-08-01T10:00:00Z", lineItemTitles: ["Shampoo Sem Sulfato"] },
      { createdAt: "2026-05-01T10:00:00Z", lineItemTitles: ["Melon Mood Mist"] },
    ]);
    expect(rec.repor).toBe("shampoo sem sulfato");
    expect(rec.lastOrderDate).toBe("2026-08-01");
  });

  it("recommends the first REC_PREF product not already owned as descobrir", () => {
    const rec = recommendFor([{ createdAt: "2026-08-01T10:00:00Z", lineItemTitles: ["Melon Mood Mist"] }]);
    // owns melon mood mist -> first REC_PREF not owned is "leave-in pluma"
    expect(rec.descobrir).toBe("leave-in pluma");
  });

  it("notYetBought lists every REC_PREF entry not owned, not just the first", () => {
    const rec = recommendFor([{ createdAt: "2026-08-01T10:00:00Z", lineItemTitles: ["Melon Mood Mist"] }]);
    expect(rec.notYetBought).toEqual(["leave-in pluma", "booster antifrizz", "máscara condicionadora"]);
    expect(rec.notYetBought[0]).toBe(rec.descobrir);
  });

  it("returns nulls for a customer with no core-product order history", () => {
    const rec = recommendFor([]);
    expect(rec.repor).toBeNull();
    expect(rec.lastOrderDate).toBeNull();
    expect(rec.descobrir).toBe("melon mood mist");
  });

  it("does NOT fall back to an earlier core-product order when the most recent order is non-core — documents the ported (not redesigned) behavior flagged in the 2026-08-13 review", () => {
    const rec = recommendFor([
      { createdAt: "2026-08-01T10:00:00Z", lineItemTitles: ["Kit Presente"] }, // non-core, most recent
      { createdAt: "2026-05-01T10:00:00Z", lineItemTitles: ["Shampoo Sem Sulfato"] }, // core, but older
    ]);
    expect(rec.repor).toBeNull(); // NOT "shampoo sem sulfato" — same as the Python source's behavior
    expect(rec.lastOrderDate).toBe("2026-08-01");
    // owned still accumulates across all orders (unaffected by the repor limitation)
    expect(rec.descobrir).not.toBe("shampoo sem sulfato");
  });
});
