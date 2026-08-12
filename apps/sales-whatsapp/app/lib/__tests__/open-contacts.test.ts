import { describe, expect, it } from "vitest";
import { isRowOpen, openCustomerGids } from "../open-contacts.js";

const now = new Date("2026-08-13T00:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

describe("isRowOpen", () => {
  it("is open (excluded from a fresh list) for a converted row, regardless of age", () => {
    expect(isRowOpen({ convertedAt: daysAgo(365), skippedAt: null, contactedAt: daysAgo(365) }, now)).toBe(true);
  });

  it("is open for a recently-skipped row — this is the bug the review caught: skip must actually suppress the row", () => {
    expect(isRowOpen({ convertedAt: null, skippedAt: daysAgo(1), contactedAt: daysAgo(1) }, now)).toBe(true);
  });

  it("is NOT open for a skipped row once its cooldown has expired", () => {
    expect(isRowOpen({ convertedAt: null, skippedAt: daysAgo(20), contactedAt: daysAgo(20) }, now)).toBe(false);
  });

  it("is open for a recent, unconverted, unskipped contact (within cooldown)", () => {
    expect(isRowOpen({ convertedAt: null, skippedAt: null, contactedAt: daysAgo(1) }, now)).toBe(true);
  });

  it("is NOT open for an old, unconverted, unskipped contact (cooldown expired)", () => {
    expect(isRowOpen({ convertedAt: null, skippedAt: null, contactedAt: daysAgo(20) }, now)).toBe(false);
  });
});

describe("openCustomerGids", () => {
  it("excludes skipped customers from a fresh worklist (regression test for the no-op skip bug)", () => {
    const rows = [
      { customerGid: "a", convertedAt: null, skippedAt: daysAgo(1), contactedAt: daysAgo(1) },
      { customerGid: "b", convertedAt: null, skippedAt: null, contactedAt: daysAgo(20) },
    ];
    const open = openCustomerGids(rows, now);
    expect(open.has("a")).toBe(true); // recently skipped -> still excluded
    expect(open.has("b")).toBe(false); // cooldown expired -> eligible again
  });
});
