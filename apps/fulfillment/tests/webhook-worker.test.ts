import { describe, expect, it, vi } from "vitest";
import { tick } from "../src/webhooks/worker.js";
import { rootLogger } from "../src/lib/logger.js";
import { verifyWebhookSignature } from "../src/webhooks/signer.js";

type Row = {
  id: string;
  tenantId: string | null;
  eventId: string;
  eventType: string;
  payload: unknown;
  targetUrl: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
};

function makeMockPrisma(rows: Row[], tenant: {
  webhookSecretSsmKey: string | null;
  slug: string;
} | null) {
  return {
    webhookDelivery: {
      findMany: vi.fn(async () =>
        rows.filter((r) => r.status === "pending"),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
    fulfillmentTenant: {
      findUnique: vi.fn(async () => tenant),
    },
  } as never;
}

describe("webhook worker tick", () => {
  it("delivers a pending row, marks it delivered, signs HMAC correctly", async () => {
    const rows: Row[] = [
      {
        id: "dlv_1",
        tenantId: "tnt_gebeauty",
        eventId: "evt_1",
        eventType: "order.received",
        payload: { id: "evt_1", type: "order.received", data: { chaveAcesso: "x" } },
        targetUrl: "https://merchant.example.com/webhook",
        status: "pending",
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        createdAt: new Date(),
      },
    ];
    const prisma = makeMockPrisma(rows, {
      webhookSecretSsmKey: "/dummy/key",
      slug: "gebeauty",
    });
    let capturedBody = "";
    let capturedSig = "";
    let capturedTs = "";
    const httpFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      const headers = init?.headers as Record<string, string>;
      capturedSig = headers["X-Rota-Local-Signature"]!;
      capturedTs = headers["X-Rota-Local-Timestamp"]!;
      return new Response("ok", { status: 200 });
    });
    const fetchSecret = vi.fn(async () => "whsec_test_secret");

    const result = await tick(
      { prisma, fetch: httpFetch as unknown as typeof fetch, fetchSecret },
      rootLogger,
    );

    expect(result.processed).toBe(1);
    expect(rows[0]!.status).toBe("delivered");
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.lastError).toBeNull();
    // Verify the signature using the same secret merchants would.
    expect(
      verifyWebhookSignature({
        secret: "whsec_test_secret",
        body: capturedBody,
        timestamp: capturedTs,
        signature: capturedSig,
      }),
    ).toBe(true);
  });

  it("on HTTP failure, bumps attempts and keeps status pending until exhausted", async () => {
    const rows: Row[] = [
      {
        id: "dlv_2",
        tenantId: "tnt_x",
        eventId: "evt_2",
        eventType: "order.picked",
        payload: { id: "evt_2", type: "order.picked", data: {} },
        targetUrl: "https://broken.example.com/hook",
        status: "pending",
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        createdAt: new Date(),
      },
    ];
    const prisma = makeMockPrisma(rows, {
      webhookSecretSsmKey: "/k",
      slug: "x",
    });
    const httpFetch = vi.fn(
      async () => new Response("oops", { status: 500 }),
    );

    await tick(
      {
        prisma,
        fetch: httpFetch as unknown as typeof fetch,
        fetchSecret: async () => "s",
      },
      rootLogger,
    );

    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.lastError).toMatch(/HTTP 500/);
  });

  it("on tenant deleted (tenantId null), marks the delivery failed", async () => {
    const rows: Row[] = [
      {
        id: "dlv_3",
        tenantId: null,
        eventId: "evt_3",
        eventType: "order.received",
        payload: {},
        targetUrl: "https://x.example.com",
        status: "pending",
        attempts: 0,
        lastAttemptAt: null,
        lastError: null,
        createdAt: new Date(),
      },
    ];
    const prisma = makeMockPrisma(rows, null);

    await tick(
      {
        prisma,
        fetch: vi.fn() as unknown as typeof fetch,
        fetchSecret: async () => "s",
      },
      rootLogger,
    );

    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.lastError).toMatch(/tenantId is null/);
  });
});
