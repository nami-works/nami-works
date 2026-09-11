// PAW ("Personal Attention Window") timing-arm logic — H-TIMING-01, revived
// per Lucas's explicit call (2026-09-11) despite the August kill reason
// being undocumented. Design is exactly
// gebeauty/growth/retention-machine/learning/hypotheses.md's spec, not a
// reinterpretation: each customer's modal 30-min purchase-time slot (needs
// 3+ orders), PAW arm = exactly half of the in-window (9h-21h BRT) pool,
// control = the other half + everyone out-of-window, fixed 13h-14h BRT send.
import { createHash } from "node:crypto";

const MIN_ORDERS_FOR_PAW = 3;
const WINDOW_START_HOUR = 9;
const WINDOW_END_HOUR = 21; // exclusive upper bound on the slot's hour
const CONTROL_BLOCK_START_HOUR = 13;
const CONTROL_BLOCK_END_HOUR = 14; // exclusive

export type Slot = { hour: number; minute: 0 | 30 };

function slotOf(hour: number, minute: number): Slot {
  return { hour, minute: minute < 30 ? 0 : 30 };
}

function slotKey(s: Slot): string {
  return `${s.hour}:${s.minute}`;
}

// Modal (most frequent) 30-min slot across a customer's own order timestamps
// (already converted to BRT by the caller — a wall-clock shift applied to a
// UTC instant, so the BRT hour/minute must be read back via the UTC getters,
// not the local ones: local getters depend on the runtime's own TZ, which
// would silently give the wrong slot on anything but a UTC-configured host).
// Null if fewer than 3 orders, or if there's a tie for the mode
// (dual_arm_split.py's own precedent: "no clear mode -> control").
export function computeModalSlot(orderTimestampsBrt: Date[]): Slot | null {
  if (orderTimestampsBrt.length < MIN_ORDERS_FOR_PAW) return null;

  const counts = new Map<string, { slot: Slot; count: number }>();
  for (const d of orderTimestampsBrt) {
    const s = slotOf(d.getUTCHours(), d.getUTCMinutes());
    const key = slotKey(s);
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { slot: s, count: 1 });
  }

  const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
  const top = sorted[0]!;
  const tied = sorted.filter((c) => c.count === top.count);
  if (tied.length > 1) return null; // tie -> no clear mode -> control

  return top.slot;
}

export function isInWindow(slot: Slot): boolean {
  return slot.hour >= WINDOW_START_HOUR && slot.hour < WINDOW_END_HOUR;
}

export type TimingArm = "PAW" | "control";

// Deterministic hash used to rank (not coin-flip) the in-window pool —
// "PAW arm = exactly N/2" is a count constraint, not a per-customer
// independent draw, so assignment has to happen batch-wise across the pool.
function rankHash(customerGid: string): bigint {
  const digest = createHash("md5").update(`${customerGid}|paw-timing-arm-2026-09`).digest("hex");
  return BigInt(`0x${digest}`);
}

// Splits the in-window pool exactly in half by rank (odd N: the extra
// customer lands in control, since PAW is the treatment arm — conservative
// default, not specified either way by the design doc). Out-of-window
// customers are the caller's problem to route straight to control; this
// function only ever sees the in-window pool.
export function splitPawControl(inWindowGids: string[]): { pawGids: Set<string>; controlGids: Set<string> } {
  const ranked = [...inWindowGids].sort((a, b) => {
    const ha = rankHash(a);
    const hb = rankHash(b);
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
  const pawCount = Math.floor(ranked.length / 2);
  return {
    pawGids: new Set(ranked.slice(0, pawCount)),
    controlGids: new Set(ranked.slice(pawCount)),
  };
}

export type ArmAssignment = { arm: TimingArm; slot: Slot | null; inWindow: boolean };

// Full per-customer assignment given the pool-level PAW/control split
// already computed via splitPawControl for the in-window subset.
export function assignArm(customerGid: string, slot: Slot | null, pawGids: Set<string>): ArmAssignment {
  const inWindow = slot !== null && isInWindow(slot);
  if (!inWindow) return { arm: "control", slot, inWindow: false };
  return { arm: pawGids.has(customerGid) ? "PAW" : "control", slot, inWindow: true };
}

// Is `nowBrt` inside this customer's actual send window right now?
// - control: anywhere in the fixed 13h-14h BRT block.
// - PAW: a tolerance band around "15 min before the slot" wide enough that
//   a poll tick every few minutes can't straddle and miss it entirely.
const PAW_LEAD_MIN = 15;
const PAW_FIRE_TOLERANCE_MIN = 6; // +-6 min around the T-15 mark

// `nowBrt` follows the same convention as computeModalSlot's input: a UTC
// instant already shifted by the BRT offset, read back via UTC getters —
// host-timezone-independent, see the comment on computeModalSlot.
export function isDueNow(assignment: ArmAssignment, nowBrt: Date): boolean {
  const nowMin = nowBrt.getUTCHours() * 60 + nowBrt.getUTCMinutes();

  if (assignment.arm === "control") {
    return nowMin >= CONTROL_BLOCK_START_HOUR * 60 && nowMin < CONTROL_BLOCK_END_HOUR * 60;
  }

  // PAW arm always has a slot (assignArm only assigns PAW when in-window).
  const slotMin = assignment.slot!.hour * 60 + assignment.slot!.minute;
  const targetMin = slotMin - PAW_LEAD_MIN;
  return Math.abs(nowMin - targetMin) <= PAW_FIRE_TOLERANCE_MIN;
}
