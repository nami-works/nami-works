import { describe, expect, it } from "vitest";
import { resolveJustBoughtExpiry } from "../credit-expiry.js";

describe("resolveJustBoughtExpiry", () => {
  it("identifies a 30-day-arm transaction by its expiry interval", () => {
    const expiresAt = resolveJustBoughtExpiry([
      { createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-08-31T00:00:00Z", remainingAmount: 19 },
    ]);
    expect(expiresAt).toBe("2026-08-31T00:00:00Z");
  });

  it("identifies a 45-day-arm transaction", () => {
    const expiresAt = resolveJustBoughtExpiry([
      { createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-09-15T00:00:00Z", remainingAmount: 19 },
    ]);
    expect(expiresAt).toBe("2026-09-15T00:00:00Z");
  });

  it("identifies a 60-day-arm transaction", () => {
    const expiresAt = resolveJustBoughtExpiry([
      { createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-09-30T00:00:00Z", remainingAmount: 19 },
    ]);
    expect(expiresAt).toBe("2026-09-30T00:00:00Z");
  });

  it("ignores a 90-day CD Extrema credit and a 7-day reactivation-wave credit", () => {
    const expiresAt = resolveJustBoughtExpiry([
      { createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-10-30T00:00:00Z", remainingAmount: 30 }, // 90d
      { createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-08-08T00:00:00Z", remainingAmount: 10 }, // 7d
    ]);
    expect(expiresAt).toBeNull();
  });

  it("ignores a matching-interval transaction that's already fully spent", () => {
    const expiresAt = resolveJustBoughtExpiry([
      { createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-08-31T00:00:00Z", remainingAmount: 0 },
    ]);
    expect(expiresAt).toBeNull();
  });

  it("ignores a transaction with no expiry at all", () => {
    const expiresAt = resolveJustBoughtExpiry([
      { createdAt: "2026-08-01T00:00:00Z", expiresAt: null, remainingAmount: 50 },
    ]);
    expect(expiresAt).toBeNull();
  });

  it("picks the soonest-expiring match when a customer has multiple just-bought-arm credits", () => {
    const expiresAt = resolveJustBoughtExpiry([
      // 60d arm from Jul 1 expires Aug 30 — sooner than the 30d arm below
      // despite being the OLDER/longer-arm credit, because it was issued earlier.
      { createdAt: "2026-07-01T00:00:00Z", expiresAt: "2026-08-30T00:00:00Z", remainingAmount: 19 },
      { createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-08-31T00:00:00Z", remainingAmount: 19 },
    ]);
    expect(expiresAt).toBe("2026-08-30T00:00:00Z");
  });

  it("tolerates a few hours of processing jitter around the exact day boundary", () => {
    const expiresAt = resolveJustBoughtExpiry([
      { createdAt: "2026-08-01T00:00:00Z", expiresAt: "2026-08-31T02:00:00Z", remainingAmount: 19 },
    ]);
    expect(expiresAt).toBe("2026-08-31T02:00:00Z");
  });

  it("returns null for a customer with no store-credit transactions at all", () => {
    expect(resolveJustBoughtExpiry([])).toBeNull();
  });
});
