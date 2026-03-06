import crypto from "crypto";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { applyLalamoveDeliveryState } from "../services/lalamove-sync.server";

const verifySignature = (rawBody: string, signatureHeader: string | null) => {
  const secret = process.env.LALAMOVE_WEBHOOK_SECRET?.trim();
  if (!secret) return true;
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader),
  );
};

/**
 * Priority ladder for Lalamove order statuses.
 * Used to detect out-of-order webhooks and avoid regression.
 * Terminal statuses (COMPLETED, CANCELED, REJECTED, EXPIRED) share the top priority
 * since they cannot transition into each other.
 */
const STATUS_PRIORITY: Record<string, number> = {
  ASSIGNING_DRIVER: 1,
  ON_GOING: 2,
  PICKED_UP: 3,
  COMPLETED: 10,
  CANCELED: 10,
  REJECTED: 10,
  EXPIRED: 10,
};

/**
 * Maps a raw Lalamove external status to the internal DeliveryState used by
 * applyLalamoveDeliveryState. Returns null for unknown statuses (logged, not synced).
 *
 * Mapping:
 *   ASSIGNING_DRIVER  → "assigning"        → Shopify CONFIRMED
 *   ON_GOING          → "heading_to_pickup" → Shopify IN_TRANSIT
 *   PICKED_UP         → "in_progress"       → Shopify OUT_FOR_DELIVERY
 *   COMPLETED         → "delivered"         → Shopify DELIVERED
 *   CANCELED          → "failed"            → Shopify FAILURE
 *   REJECTED          → "rejected"          → Shopify FAILURE + tag "Delivery rejected"
 *   EXPIRED           → "expired"           → Shopify FAILURE + tag "Delivery expired"
 */
const mapExternalStatus = (status: string) => {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ASSIGNING_DRIVER") return "assigning" as const;
  if (normalized === "ON_GOING") return "heading_to_pickup" as const;
  if (normalized === "PICKED_UP") return "in_progress" as const;
  if (normalized === "COMPLETED") return "delivered" as const;
  if (normalized === "CANCELED") return "failed" as const;
  if (normalized === "REJECTED") return "rejected" as const;
  if (normalized === "EXPIRED") return "expired" as const;
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const rawBody = await request.text();
  const signatureHeader =
    request.headers.get("X-Lalamove-Signature") ??
    request.headers.get("x-lalamove-signature");
  if (!verifySignature(rawBody, signatureHeader)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const data = payload?.data ?? payload;
  const lalamoveOrderId = String(data?.orderId ?? data?.id ?? "").trim();
  const externalStatus = String(data?.status ?? data?.orderStatus ?? "").trim();
  const metadata = data?.metadata ?? {};
  const shop = String(metadata?.shop ?? data?.shop ?? "").trim();
  const dispatchJobId = String(metadata?.dispatchJobId ?? "").trim() || null;
  const mapped = mapExternalStatus(externalStatus);
  const normalized = externalStatus.toUpperCase();

  if (!shop || !lalamoveOrderId || !externalStatus) {
    return new Response("Missing required fields", { status: 400 });
  }

  const prismaAny = prisma as any;

  // Always log every webhook event for audit trail
  await prismaAny.lalamoveDispatchEvent.create({
    data: {
      shop,
      dispatchJobId,
      lalamoveOrderId,
      eventType: "WEBHOOK_STATUS",
      externalStatus,
      payload: payload as object,
    },
  });

  const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
    where: { shop, lalamoveOrderId },
  });

  if (!mapped || orderMaps.length === 0) {
    // Unknown status or no tracked orders — logged, nothing to sync
    return new Response("OK");
  }

  // ── Out-of-order protection ────────────────────────────────────────────────
  // Skip if incoming status has lower priority than the highest current status.
  // E.g.: receiving ON_GOING after PICKED_UP is already stored → ignore.
  const newPriority = STATUS_PRIORITY[normalized] ?? 0;
  const maxCurrentPriority = Math.max(
    0,
    ...orderMaps.map((m: { currentStatus?: string | null }) =>
      STATUS_PRIORITY[String(m.currentStatus ?? "").toUpperCase()] ?? 0,
    ),
  );
  if (newPriority < maxCurrentPriority) {
    console.info("[lalamove-webhook] Out-of-order status dropped.", {
      shop,
      lalamoveOrderId,
      incoming: externalStatus,
      currentMax: maxCurrentPriority,
    });
    return new Response("OK");
  }

  // ── Deduplication ─────────────────────────────────────────────────────────
  // If all maps already carry this exact status, the Shopify state was already
  // applied — skip to avoid duplicate fulfillment events.
  const alreadySynced = orderMaps.every(
    (m: { currentStatus?: string | null }) => m.currentStatus === externalStatus,
  );
  if (alreadySynced) {
    console.info("[lalamove-webhook] Duplicate status webhook ignored.", {
      shop,
      lalamoveOrderId,
      externalStatus,
    });
    return new Response("OK");
  }

  // ── DB update ─────────────────────────────────────────────────────────────
  const isFailure = mapped === "failed" || mapped === "rejected" || mapped === "expired";
  await prismaAny.lalamoveDispatchOrderMap.updateMany({
    where: { shop, lalamoveOrderId },
    data: {
      currentStatus: externalStatus,
      ...(isFailure
        ? {
            failureReason:
              String(data?.failureReason ?? data?.cancelReason ?? "").trim() ||
              `Delivery ${mapped}`,
          }
        : {}),
    },
  });

  if (dispatchJobId) {
    await prismaAny.lalamoveDispatchJob.updateMany({
      where: { shop, id: dispatchJobId },
      data: { status: externalStatus, lalamoveOrderId },
    });
  }

  // ── Shopify sync ──────────────────────────────────────────────────────────
  try {
    const adminClient = await unauthenticated.admin(shop);
    const orderIds = orderMaps.map((item: { shopifyOrderId: string }) => item.shopifyOrderId);
    await applyLalamoveDeliveryState(adminClient.admin, {
      orderIds,
      state: mapped,
      reason: isFailure
        ? String(data?.failureReason ?? data?.cancelReason ?? "").trim() ||
          `Delivery ${mapped}`
        : undefined,
    });
  } catch (error) {
    console.error("Failed to sync Lalamove webhook state to Shopify", {
      shop,
      lalamoveOrderId,
      externalStatus,
      error,
    });
  }

  return new Response("OK");
};
