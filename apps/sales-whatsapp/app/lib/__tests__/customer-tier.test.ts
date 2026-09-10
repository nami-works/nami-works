import { describe, expect, it } from "vitest";
import { tierFor, urgencyFor } from "../customer-tier.js";

describe("tierFor", () => {
  it.each([
    [0, "nova"],
    [1, "nova"],
    [2, "recorrente"],
    [3, "recorrente"],
    [4, "fiel"],
    [10, "fiel"],
  ] as const)("numberOfOrders=%d -> %s", (orders, expected) => {
    expect(tierFor(orders)).toBe(expected);
  });
});

describe("urgencyFor", () => {
  it.each([
    [1, "critical"],
    [6, "critical"],
    [7, "warning"],
    [15, "warning"],
    [16, "neutral"],
    [30, "neutral"],
  ] as const)("daysUntilExpiry=%d -> %s", (days, expected) => {
    expect(urgencyFor(days)).toBe(expected);
  });
});
