import { describe, expect, it } from "vitest";
import { daysUntil, rankByExpiryAndValue } from "../ranking.js";

describe("rankByExpiryAndValue", () => {
  const now = new Date("2026-08-12T00:00:00Z");

  it("ranks soonest-expiring first", () => {
    const ranked = rankByExpiryAndValue(
      [
        { customerGid: "a", creditBalance: 50, creditExpiresAt: "2026-08-20T00:00:00Z" },
        { customerGid: "b", creditBalance: 50, creditExpiresAt: "2026-08-14T00:00:00Z" },
      ],
      now,
    );
    expect(ranked[0]!.customerGid).toBe("b");
    expect(ranked[0]!.rank).toBe(1);
  });

  it("breaks a tie in expiry by higher balance first", () => {
    const ranked = rankByExpiryAndValue(
      [
        { customerGid: "a", creditBalance: 30, creditExpiresAt: "2026-08-20T00:00:00Z" },
        { customerGid: "b", creditBalance: 90, creditExpiresAt: "2026-08-20T00:00:00Z" },
      ],
      now,
    );
    expect(ranked[0]!.customerGid).toBe("b");
  });
});

describe("daysUntil", () => {
  it("never returns negative days for an already-past date", () => {
    expect(daysUntil("2020-01-01T00:00:00Z", new Date("2026-08-12T00:00:00Z"))).toBe(0);
  });
});
