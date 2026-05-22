import type { Logger } from "pino";
import type { PrismaClient } from "@prisma/client-fulfillment";
import { prisma as defaultPrisma } from "../db/prisma.js";
import { rootLogger } from "../lib/logger.js";
import { isExhausted, isReadyToAttempt, MAX_ATTEMPTS } from "./backoff.js";
import { fetchSsmSecret } from "./secret-fetch.js";
import { signWebhookPayload } from "./signer.js";

type WorkerPrisma = Pick<PrismaClient, "webhookDelivery" | "fulfillmentTenant">;

export type WorkerDeps = {
  prisma?: WorkerPrisma;
  logger?: Logger;
  fetch?: typeof fetch;
  fetchSecret?: (key: string) => Promise<string>;
  now?: () => Date;
};

export type WorkerHandle = {
  stop: () => void;
};

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 25;
const FETCH_TIMEOUT_MS = 15_000;

// Starts a setInterval-driven tick that scans for pending WebhookDelivery
// rows and posts them to their target URLs. In-process for v0; extract to a
// standalone worker once volume warrants. The handle's `stop()` is for tests
// and graceful shutdown.
export function startWebhookWorker(deps: WorkerDeps = {}): WorkerHandle {
  const log = deps.logger ?? rootLogger.child({ component: "webhook-worker" });
  let running = false;
  const timer: NodeJS.Timeout = setInterval(() => {
    if (running) return;
    running = true;
    tick(deps, log).finally(() => {
      running = false;
    });
  }, POLL_INTERVAL_MS);
  // Don't keep the event loop alive solely for the worker tick — the Fastify
  // server's listen() holds the loop open in production, and tests can stop()
  // explicitly.
  timer.unref();
  return {
    stop: () => clearInterval(timer),
  };
}

export async function tick(
  deps: WorkerDeps,
  log: Logger,
): Promise<{ processed: number }> {
  const db = deps.prisma ?? defaultPrisma;
  const httpFetch = deps.fetch ?? fetch;
  const fetchSecret = deps.fetchSecret ?? fetchSsmSecret;
  const now = deps.now ?? (() => new Date());

  // Pick the oldest pending rows. We rely on the (status, createdAt) index
  // (see prisma/fulfillment/schema.prisma WebhookDelivery indexes).
  const candidates = await db.webhookDelivery.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let processed = 0;
  for (const row of candidates) {
    if (
      !isReadyToAttempt({
        attempts: row.attempts,
        lastAttemptAt: row.lastAttemptAt,
        now: now(),
      })
    ) {
      continue;
    }
    await deliver({
      row,
      db,
      httpFetch,
      fetchSecret,
      now,
      log,
    });
    processed++;
  }
  return { processed };
}

type DeliveryRow = Awaited<
  ReturnType<WorkerPrisma["webhookDelivery"]["findMany"]>
>[number];

async function deliver(args: {
  row: DeliveryRow;
  db: WorkerPrisma;
  httpFetch: typeof fetch;
  fetchSecret: (key: string) => Promise<string>;
  now: () => Date;
  log: Logger;
}): Promise<void> {
  const { row, db, httpFetch, fetchSecret, now, log } = args;

  if (!row.tenantId) {
    await markFailed(db, row.id, "tenantId is null (tenant deleted?)");
    return;
  }

  const tenant = await db.fulfillmentTenant.findUnique({
    where: { id: row.tenantId },
    select: { webhookSecretSsmKey: true, slug: true },
  });
  if (!tenant?.webhookSecretSsmKey) {
    await markFailed(db, row.id, "tenant has no webhookSecretSsmKey configured");
    return;
  }

  let secret: string;
  try {
    secret = await fetchSecret(tenant.webhookSecretSsmKey);
  } catch (err) {
    await bumpAttempt(
      db,
      row,
      now(),
      `secret fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const body = JSON.stringify(row.payload);
  const headers = signWebhookPayload({
    secret,
    body,
    eventType: row.eventType,
    deliveryId: row.id,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response | null = null;
  let fetchErr: unknown = null;
  try {
    response = await httpFetch(row.targetUrl, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    fetchErr = err;
  } finally {
    clearTimeout(timeout);
  }

  if (response && response.ok) {
    await db.webhookDelivery.update({
      where: { id: row.id },
      data: {
        status: "delivered",
        attempts: row.attempts + 1,
        lastAttemptAt: now(),
        lastError: null,
      },
    });
    log.info(
      {
        deliveryId: row.id,
        tenant: tenant.slug,
        eventType: row.eventType,
        attempts: row.attempts + 1,
      },
      "webhook_delivered",
    );
    return;
  }

  const errMsg = fetchErr
    ? `fetch error: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
    : `HTTP ${response?.status ?? "?"}: ${
        response ? await safeReadBody(response) : "(no response)"
      }`;
  await bumpAttempt(db, row, now(), errMsg);
  log.warn(
    {
      deliveryId: row.id,
      tenant: tenant.slug,
      attempt: row.attempts + 1,
      maxAttempts: MAX_ATTEMPTS,
      err: errMsg,
    },
    "webhook_attempt_failed",
  );
}

async function bumpAttempt(
  db: WorkerPrisma,
  row: DeliveryRow,
  at: Date,
  errMsg: string,
): Promise<void> {
  const nextAttempts = row.attempts + 1;
  const exhausted = isExhausted(nextAttempts);
  await db.webhookDelivery.update({
    where: { id: row.id },
    data: {
      attempts: nextAttempts,
      lastAttemptAt: at,
      lastError: errMsg.slice(0, 10_000),
      status: exhausted ? "failed" : "pending",
    },
  });
}

async function markFailed(
  db: WorkerPrisma,
  id: string,
  reason: string,
): Promise<void> {
  await db.webhookDelivery.update({
    where: { id },
    data: { status: "failed", lastError: reason.slice(0, 10_000) },
  });
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "(unreadable body)";
  }
}
