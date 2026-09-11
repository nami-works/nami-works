import { describe, expect, it } from "vitest";
import { assignArm, computeModalSlot, isDueNow, isInWindow, splitPawControl } from "../paw.js";

// paw.ts's Date convention throughout: a "BRT-wall-clock Date" is a UTC
// instant read back via UTC getters, never local ones — host-timezone-
// independent. These tests build such Dates with Date.UTC directly (the
// UTC fields ARE the intended BRT wall-clock reading) rather than the local
// constructor, whose meaning would otherwise depend on the machine running
// the tests.
function brt(hour: number, minute: number, day = 1): Date {
  return new Date(Date.UTC(2026, 0, day, hour, minute));
}

describe("computeModalSlot", () => {
  it("returns null with fewer than 3 orders", () => {
    expect(computeModalSlot([brt(10, 5, 1), brt(10, 10, 2)])).toBeNull();
  });

  it("returns the most frequent 30-min slot", () => {
    const slot = computeModalSlot([
      brt(14, 5, 1), // 14:00
      brt(14, 20, 2), // 14:00
      brt(9, 40, 3), // 9:30
    ]);
    expect(slot).toEqual({ hour: 14, minute: 0 });
  });

  it("returns null on a tie (no clear mode -> control)", () => {
    const slot = computeModalSlot([brt(14, 5, 1), brt(9, 5, 2), brt(20, 5, 3)]);
    expect(slot).toBeNull();
  });
});

describe("isInWindow", () => {
  it("is true for 9h-20:59", () => {
    expect(isInWindow({ hour: 9, minute: 0 })).toBe(true);
    expect(isInWindow({ hour: 20, minute: 30 })).toBe(true);
  });

  it("is false outside 9h-21h", () => {
    expect(isInWindow({ hour: 8, minute: 30 })).toBe(false);
    expect(isInWindow({ hour: 21, minute: 0 })).toBe(false);
  });
});

describe("splitPawControl", () => {
  it("splits an in-window pool exactly in half, deterministically", () => {
    const gids = Array.from({ length: 10 }, (_, i) => `gid://shopify/Customer/${i}`);
    const { pawGids, controlGids } = splitPawControl(gids);
    expect(pawGids.size).toBe(5);
    expect(controlGids.size).toBe(5);
    // deterministic: re-running with the same input gives the same split
    const again = splitPawControl(gids);
    expect([...again.pawGids].sort()).toEqual([...pawGids].sort());
  });

  it("puts the odd-one-out in control for an odd-sized pool", () => {
    const gids = Array.from({ length: 7 }, (_, i) => `gid://shopify/Customer/${i}`);
    const { pawGids, controlGids } = splitPawControl(gids);
    expect(pawGids.size).toBe(3);
    expect(controlGids.size).toBe(4);
  });
});

describe("assignArm", () => {
  it("assigns control to an out-of-window customer regardless of the PAW set", () => {
    const assignment = assignArm("gid1", { hour: 7, minute: 0 }, new Set(["gid1"]));
    expect(assignment).toEqual({ arm: "control", slot: { hour: 7, minute: 0 }, inWindow: false });
  });

  it("assigns control to a null-slot customer", () => {
    expect(assignArm("gid1", null, new Set(["gid1"]))).toEqual({ arm: "control", slot: null, inWindow: false });
  });

  it("assigns PAW only to in-window customers in the PAW set", () => {
    const slot = { hour: 14, minute: 0 } as const;
    expect(assignArm("gid1", slot, new Set(["gid1"]))).toEqual({ arm: "PAW", slot, inWindow: true });
    expect(assignArm("gid2", slot, new Set(["gid1"]))).toEqual({ arm: "control", slot, inWindow: true });
  });
});

describe("isDueNow", () => {
  it("control arm is due anywhere in the 13h-14h BRT block", () => {
    const assignment = { arm: "control" as const, slot: null, inWindow: false };
    expect(isDueNow(assignment, brt(13, 0))).toBe(true);
    expect(isDueNow(assignment, brt(13, 59))).toBe(true);
    expect(isDueNow(assignment, brt(14, 0))).toBe(false);
    expect(isDueNow(assignment, brt(12, 59))).toBe(false);
  });

  it("PAW arm is due in a tolerance band around 15 minutes before the slot", () => {
    const assignment = { arm: "PAW" as const, slot: { hour: 14, minute: 0 } as const, inWindow: true };
    expect(isDueNow(assignment, brt(13, 45))).toBe(true); // exact T-15
    expect(isDueNow(assignment, brt(13, 39))).toBe(true); // T-15-6
    expect(isDueNow(assignment, brt(13, 51))).toBe(true); // T-15+6
    expect(isDueNow(assignment, brt(13, 38))).toBe(false);
    expect(isDueNow(assignment, brt(13, 52))).toBe(false);
  });
});
