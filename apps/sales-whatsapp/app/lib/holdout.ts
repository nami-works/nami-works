import { createHash } from "node:crypto";

// This app's holdout: a deliberately independent random split from any
// upstream issuance-arm holdout (confirmed with Lucas 2026-08-12 — two
// separate splits answering two separate questions, not a bug). Same
// mechanism as apps/connector's arm-hash (own salt, GID-hash, no shared
// state), so it's durable across restarts without a DB row.
//
// Deliberately NOT exported as a lookup table or DB-backed flag: the
// holdout customer must never enter any query at all, and a pure function
// with no persisted "is holdout" row is the simplest way to guarantee that
// — there's no table to accidentally join against or leak from.
const HOLDOUT_SALT = "|sales-whatsapp-nudge-holdout-2026-08";
const HOLDOUT_FRACTION = 0.05; // 5%, matching the per-step holdout convention used elsewhere in this program

export function isHoldout(customerGid: string): boolean {
  const digest = createHash("md5").update(customerGid + HOLDOUT_SALT).digest("hex");
  // First 8 hex chars as a uniform 0..1 float — enough entropy for a 5% cut,
  // doesn't need the full 128 bits.
  const n = parseInt(digest.slice(0, 8), 16) / 0xffffffff;
  return n < HOLDOUT_FRACTION;
}
