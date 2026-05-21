import { describe, expect, it } from "vitest";
import { __testing } from "./fetch.js";

const { extractArchivedRouteTags, archiveTagDateToIso, isoDateNDaysAgo } =
  __testing;

describe("extractArchivedRouteTags", () => {
  it("captures NN_YY.MM.DD style archived tags", () => {
    const result = extractArchivedRouteTags([
      "ld_rota-01_26.04.30",
      "ld_rota-12_25.12.31",
    ]);
    expect(result).toEqual([
      { routeNumber: 1, routeTag: "ld_rota-01_26.04.30", date: "2026-04-30" },
      { routeNumber: 12, routeTag: "ld_rota-12_25.12.31", date: "2025-12-31" },
    ]);
  });

  it("rejects active route tags (no date suffix)", () => {
    const result = extractArchivedRouteTags(["ld_rota-01", "ld_rota-12"]);
    expect(result).toEqual([]);
  });

  it("rejects unrelated tags", () => {
    const result = extractArchivedRouteTags([
      "ld_address_review",
      "VIP",
      "Shops Jardins",
    ]);
    expect(result).toEqual([]);
  });

  it("returns multiple entries when an order spans re-clustered routes", () => {
    const result = extractArchivedRouteTags([
      "ld_rota-01_26.04.30",
      "ld_rota-02_26.04.30",
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.routeNumber)).toEqual([1, 2]);
  });
});

describe("archiveTagDateToIso", () => {
  it("expands 2-digit year to 20YY", () => {
    expect(archiveTagDateToIso("26", "04", "30")).toBe("2026-04-30");
    expect(archiveTagDateToIso("00", "01", "01")).toBe("2000-01-01");
  });
});

describe("isoDateNDaysAgo", () => {
  it("subtracts days in UTC", () => {
    const now = new Date("2026-04-30T12:00:00Z");
    expect(isoDateNDaysAgo(now, 7)).toBe("2026-04-23");
    expect(isoDateNDaysAgo(now, 30)).toBe("2026-03-31");
    expect(isoDateNDaysAgo(now, 0)).toBe("2026-04-30");
  });
});
