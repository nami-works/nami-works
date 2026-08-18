import { describe, expect, it } from "vitest";
import { isHoldout } from "../holdout.js";

describe("isHoldout", () => {
  it("is deterministic for the same customer GID", () => {
    const gid = "gid://shopify/Customer/1234567890";
    expect(isHoldout(gid)).toBe(isHoldout(gid));
  });

  it("splits roughly 5% holdout across a large sample", () => {
    let holdoutCount = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      if (isHoldout(`gid://shopify/Customer/${i}`)) holdoutCount++;
    }
    const fraction = holdoutCount / n;
    expect(fraction).toBeGreaterThan(0.03);
    expect(fraction).toBeLessThan(0.07);
  });
});
