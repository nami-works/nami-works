// Orchestrates the scheduled "credit expiring soon" WhatsApp push
// (docs/handoff-beautyback-credit-automation.md §7): combines the cohort
// (expiring-credit-cohort.ts), the PAW-vs-control timing split (paw.ts),
// append-only-ledger idempotency, and the actual Zoko send. Called by
// worker/scheduler.ts's recurring poller — this module has no timer of its
// own, it just answers "who's due right now" and sends to them once.
import { Prisma, type PrismaClient } from "@prisma/client-sales-whatsapp";
import { brl } from "./whatsapp-message.js";
import { zokoSendTemplate } from "./zoko-client.js";
import { computeModalSlot, splitPawControl, assignArm, isDueNow, type ArmAssignment } from "./paw.js";
import type { ExpiringTranche } from "./expiring-credit-cohort.js";

const ZOKO_TEMPLATE_ID = "cashback_expiring_soon";
const BASE_URL = "https://www.gebeauty.com.br";
const BUTTON_URL = `${BASE_URL}?utm_source=whatsapp&utm_medium=zoko&utm_campaign=cashback-expiring-today`;

function toBrt(iso: string): Date {
  return new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
}

// One PAW/control assignment per customer (not per tranche) — a customer
// holding two same-day tranches gets sent at one timing, not two.
export function computeArmsForCohort(tranches: ExpiringTranche[]): Map<string, ArmAssignment> {
  const byCustomer = new Map<string, ExpiringTranche>();
  for (const t of tranches) if (!byCustomer.has(t.customerGid)) byCustomer.set(t.customerGid, t);

  const slots = new Map<string, ReturnType<typeof computeModalSlot>>();
  const inWindowGids: string[] = [];
  for (const [gid, t] of byCustomer) {
    const slot = computeModalSlot(t.orderCreatedAtIso.map(toBrt));
    slots.set(gid, slot);
    if (slot && slot.hour >= 9 && slot.hour < 21) inWindowGids.push(gid);
  }

  const { pawGids } = splitPawControl(inWindowGids);

  const arms = new Map<string, ArmAssignment>();
  for (const gid of byCustomer.keys()) arms.set(gid, assignArm(gid, slots.get(gid) ?? null, pawGids));
  return arms;
}

export type SendOutcome = { customerGid: string; trancheCreatedAt: string; outcome: "sent" | "failed" | "already_handled" };

// Attempts every tranche whose assigned arm is due at `nowBrt`. Ledger-first:
// the insert (unique on shop+customerGid+trancheCreatedAt) is the
// idempotency gate, not a pre-check-then-write race — a P2002 violation
// means this exact tranche was already claimed by a prior tick (or a
// crashed-and-restarted run) and is skipped as a no-op, per handoff §3.
export async function sendDueExpiringCreditPushes(params: {
  db: PrismaClient;
  shop: string;
  zokoApiKey: string;
  tranches: ExpiringTranche[];
  arms: Map<string, ArmAssignment>;
  nowBrt: Date;
}): Promise<SendOutcome[]> {
  const { db, shop, zokoApiKey, tranches, arms, nowBrt } = params;
  const outcomes: SendOutcome[] = [];

  for (const t of tranches) {
    const assignment = arms.get(t.customerGid);
    if (!assignment || !isDueNow(assignment, nowBrt)) continue;

    let row;
    try {
      row = await db.expiringCreditPush.create({
        data: {
          shop,
          customerGid: t.customerGid,
          trancheCreatedAt: new Date(t.trancheCreatedAt),
          expiresAt: new Date(t.expiresAt),
          timingArm: assignment.arm,
          pawSlot: assignment.slot ? `${String(assignment.slot.hour).padStart(2, "0")}:${String(assignment.slot.minute).padStart(2, "0")}` : null,
          status: "pending",
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        outcomes.push({ customerGid: t.customerGid, trancheCreatedAt: t.trancheCreatedAt, outcome: "already_handled" });
        continue;
      }
      throw err;
    }

    const result = await zokoSendTemplate({
      apiKey: zokoApiKey,
      recipient: t.phone,
      templateId: ZOKO_TEMPLATE_ID,
      templateArgs: [brl(t.amount), t.firstName ?? "", t.firstName ?? "", BUTTON_URL],
    });

    if (result.ok) {
      await db.expiringCreditPush.update({ where: { id: row.id }, data: { status: "sent", sentAt: new Date() } });
      outcomes.push({ customerGid: t.customerGid, trancheCreatedAt: t.trancheCreatedAt, outcome: "sent" });
    } else {
      // Network errors and real Zoko errors both land the row as "failed"
      // here (no automatic retry loop in v1) — but the ledger already
      // distinguishes them via `error`, so a human re-run can tell which
      // failures are worth retrying vs. a genuine template/recipient issue.
      const error = result.kind === "network_error" ? `network_error: ${result.error}` : `http_error ${result.status}: ${JSON.stringify(result.body)}`;
      await db.expiringCreditPush.update({ where: { id: row.id }, data: { status: "failed", error } });
      outcomes.push({ customerGid: t.customerGid, trancheCreatedAt: t.trancheCreatedAt, outcome: "failed" });
    }
  }

  return outcomes;
}
