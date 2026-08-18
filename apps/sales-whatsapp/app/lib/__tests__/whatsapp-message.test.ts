import { describe, expect, it } from "vitest";
import { buildMessage, buildWaMeLink } from "../whatsapp-message.js";

describe("buildMessage", () => {
  it("uses idiomatic PT-BR — vencimento, cashback, no calques", () => {
    const msg = buildMessage({
      firstName: "Mariana",
      creditBalance: 46.2,
      creditExpiresAt: "2026-08-14T00:00:00Z",
      repor: "shampoo sem sulfato",
      descobrir: "melon mood mist",
    });
    expect(msg).toContain("Mariana");
    expect(msg).toContain("R$ 46,20");
    expect(msg).toContain("cashback");
    expect(msg).not.toMatch(/expira/i);
    expect(msg).toContain("shampoo sem sulfato");
    expect(msg).toContain("melon mood mist");
  });

  it("falls back to a generic opener with no first name", () => {
    const msg = buildMessage({
      firstName: null,
      creditBalance: 20,
      creditExpiresAt: "2026-08-14T00:00:00Z",
      repor: null,
      descobrir: null,
    });
    expect(msg).toContain("tudo bem");
  });
});

describe("buildWaMeLink", () => {
  it("normalizes a Brazilian phone number and adds the country code", () => {
    const link = buildWaMeLink("(21) 98765-4321", "Oi!");
    expect(link).toBe("https://wa.me/5521987654321?text=Oi!");
  });

  it("does not double the country code if already present", () => {
    const link = buildWaMeLink("5521987654321", "Oi!");
    expect(link).toBe("https://wa.me/5521987654321?text=Oi!");
  });

  it("returns null for a missing/empty phone", () => {
    expect(buildWaMeLink("", "Oi!")).toBeNull();
  });
});
