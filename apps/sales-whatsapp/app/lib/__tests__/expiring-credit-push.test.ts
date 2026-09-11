import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client-sales-whatsapp";
import { computeArmsForCohort, sendDueExpiringCreditPushes } from "../expiring-credit-push.js";
import type { ExpiringTranche } from "../expiring-credit-cohort.js";

function tranche(overrides: Partial<ExpiringTranche> = {}): ExpiringTranche {
  return {
    customerGid: "gid://shopify/Customer/1",
    firstName: "Ana",
    phone: "+5581999998888",
    trancheCreatedAt: "2026-08-01T12:00:00Z",
    expiresAt: "2026-09-12T23:59:59Z",
    amount: 36.1,
    orderCreatedAtIso: [],
    ...overrides,
  };
}

describe("computeArmsForCohort", () => {
  it("assigns one arm per customer, not per tranche", () => {
    const orders = ["2026-05-01T14:00:00Z", "2026-06-02T14:05:00Z", "2026-07-03T14:10:00Z", "2026-08-04T14:00:00Z"];
    const t1 = tranche({ customerGid: "gidA", orderCreatedAtIso: orders });
    const t2 = tranche({ customerGid: "gidA", trancheCreatedAt: "2026-08-05T00:00:00Z", orderCreatedAtIso: orders });
    const arms = computeArmsForCohort([t1, t2]);
    expect(arms.size).toBe(1);
    expect(arms.has("gidA")).toBe(true);
  });

  it("falls back everyone to control when nobody has 3+ orders", () => {
    const arms = computeArmsForCohort([tranche({ customerGid: "gidA" }), tranche({ customerGid: "gidB" })]);
    expect(arms.get("gidA")).toMatchObject({ arm: "control" });
    expect(arms.get("gidB")).toMatchObject({ arm: "control" });
  });
});

describe("sendDueExpiringCreditPushes", () => {
  function fakeDb() {
    const rows = new Map<string, unknown>();
    let nextId = 1;
    return {
      rows,
      expiringCreditPush: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const key = `${data.shop}|${data.customerGid}|${(data.trancheCreatedAt as Date).toISOString()}`;
          if (rows.has(key)) {
            throw new Prisma.PrismaClientKnownRequestError("unique constraint", { code: "P2002", clientVersion: "test" });
          }
          const row = { id: String(nextId++), ...data };
          rows.set(key, row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const row of rows.values()) {
            const r = row as { id: string };
            if (r.id === where.id) Object.assign(r, data);
          }
        }),
      },
    };
  }

  it("sends to a due customer and marks the ledger row sent", async () => {
    const db = fakeDb();
    const t = tranche();
    const arms = new Map([[t.customerGid, { arm: "control" as const, slot: null, inWindow: false }]]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "msg1" }) }),
    );

    const outcomes = await sendDueExpiringCreditPushes({
      db: db as never,
      shop: "ge-beauty-cosmeticos.myshopify.com",
      zokoApiKey: "key",
      tranches: [t],
      arms,
      nowBrt: new Date(Date.UTC(2026, 0, 1, 13, 30)),
    });

    expect(outcomes).toEqual([{ customerGid: t.customerGid, trancheCreatedAt: t.trancheCreatedAt, outcome: "sent" }]);
    expect(db.expiringCreditPush.create).toHaveBeenCalledTimes(1);
    expect(db.expiringCreditPush.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "sent" }) }),
    );
    vi.unstubAllGlobals();
  });

  it("skips a customer not due yet", async () => {
    const db = fakeDb();
    const t = tranche();
    const arms = new Map([[t.customerGid, { arm: "control" as const, slot: null, inWindow: false }]]);

    const outcomes = await sendDueExpiringCreditPushes({
      db: db as never,
      shop: "ge-beauty-cosmeticos.myshopify.com",
      zokoApiKey: "key",
      tranches: [t],
      arms,
      nowBrt: new Date(Date.UTC(2026, 0, 1, 9, 0)), // outside the 13h-14h control block
    });

    expect(outcomes).toEqual([]);
    expect(db.expiringCreditPush.create).not.toHaveBeenCalled();
  });

  it("treats a P2002 ledger conflict as already_handled, not a duplicate send", async () => {
    const db = fakeDb();
    const t = tranche();
    const arms = new Map([[t.customerGid, { arm: "control" as const, slot: null, inWindow: false }]]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));

    const nowBrt = new Date(Date.UTC(2026, 0, 1, 13, 30));
    await sendDueExpiringCreditPushes({ db: db as never, shop: "s", zokoApiKey: "k", tranches: [t], arms, nowBrt });
    const outcomes = await sendDueExpiringCreditPushes({ db: db as never, shop: "s", zokoApiKey: "k", tranches: [t], arms, nowBrt });

    expect(outcomes).toEqual([{ customerGid: t.customerGid, trancheCreatedAt: t.trancheCreatedAt, outcome: "already_handled" }]);
    expect(db.expiringCreditPush.create).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("marks the row failed on a Zoko http error, without throwing", async () => {
    const db = fakeDb();
    const t = tranche();
    const arms = new Map([[t.customerGid, { arm: "control" as const, slot: null, inWindow: false }]]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: "bad template" }) }),
    );

    const outcomes = await sendDueExpiringCreditPushes({
      db: db as never,
      shop: "s",
      zokoApiKey: "k",
      tranches: [t],
      arms,
      nowBrt: new Date(Date.UTC(2026, 0, 1, 13, 30)),
    });

    expect(outcomes).toEqual([{ customerGid: t.customerGid, trancheCreatedAt: t.trancheCreatedAt, outcome: "failed" }]);
    vi.unstubAllGlobals();
  });
});
