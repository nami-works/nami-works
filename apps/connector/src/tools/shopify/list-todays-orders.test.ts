import { describe, expect, it } from "vitest";
import { todayInZone } from "./list-todays-orders.js";

describe("todayInZone", () => {
  it("returns YYYY-MM-DD in the requested timezone", () => {
    // 2026-04-21 01:30 UTC → 2026-04-20 22:30 America/Sao_Paulo (UTC-3)
    const instant = new Date("2026-04-21T01:30:00Z");
    expect(todayInZone("America/Sao_Paulo", instant)).toBe("2026-04-20");
    expect(todayInZone("UTC", instant)).toBe("2026-04-21");
  });

  it("handles the merchant's late-evening local edge correctly", () => {
    // 2026-04-21 02:59 UTC → 2026-04-20 23:59 BRT, still 'yesterday' for shop
    const instant = new Date("2026-04-21T02:59:00Z");
    expect(todayInZone("America/Sao_Paulo", instant)).toBe("2026-04-20");
  });

  it("zero-pads single-digit months and days", () => {
    const instant = new Date("2026-03-05T12:00:00Z");
    expect(todayInZone("UTC", instant)).toBe("2026-03-05");
  });
});
