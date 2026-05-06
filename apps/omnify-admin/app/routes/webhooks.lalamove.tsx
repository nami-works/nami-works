import crypto from "crypto";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { applyLalamoveDeliveryState, renameRouteTagsToArchive } from "../services/lalamove-sync.server";
import { syncLalamoveStatusToShopify } from "../services/lalamove-shopify-sync.server";

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
  console.info(`[local-delivery:webhook] received shop=${shop} orderId=${lalamoveOrderId} status=${externalStatus}`);

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

  if (!mapped) {
    // Unknown status — logged, nothing to sync
    return new Response("OK");
  }

  // ── Return pickup fallback ──────────────────────────────────────────────────
  // If no delivery order maps match, check if this Lalamove order belongs to a
  // return pickup request. Return pickups don't create LalamoveDispatchOrderMap
  // records — they store the lalamoveOrderId directly on ReturnPickupRequest.
  if (orderMaps.length === 0) {
    const returnRequests = await prisma.returnPickupRequest.findMany({
      where: { shop, lalamoveOrderId },
    });
    if (returnRequests.length === 0) {
      return new Response("OK");
    }

    // Map return pickup status → priority for out-of-order protection
    const RETURN_STATUS_PRIORITY: Record<string, number> = {
      pending: 0, quoted: 0, dispatched: 1,
      in_progress: 2, picked_up: 3,
      completed: 10, cancelled: 10,
    };
    const mapLalamoveToReturnStatus = (s: string): string | null => {
      const n = s.trim().toUpperCase();
      if (n === "ASSIGNING_DRIVER") return "dispatched";
      if (n === "ON_GOING") return "in_progress";
      if (n === "PICKED_UP") return "picked_up";
      if (n === "COMPLETED") return "completed";
      if (n === "CANCELED" || n === "REJECTED" || n === "EXPIRED") return "cancelled";
      return null;
    };

    const newReturnStatus = mapLalamoveToReturnStatus(externalStatus);
    if (!newReturnStatus) {
      return new Response("OK");
    }

    const newPriorityReturn = RETURN_STATUS_PRIORITY[newReturnStatus] ?? 0;
    const maxCurrentReturn = Math.max(
      0,
      ...returnRequests.map((r) => RETURN_STATUS_PRIORITY[r.status] ?? 0),
    );
    if (newPriorityReturn < maxCurrentReturn) {
      console.info(`[local-delivery:webhook] return-pickup out-of-order dropped shop=${shop} orderId=${lalamoveOrderId} incoming=${newReturnStatus} current=${returnRequests[0]?.status}`);
      return new Response("OK");
    }

    const alreadyAtStatus = returnRequests.every((r) => r.status === newReturnStatus);
    if (alreadyAtStatus) {
      console.info(`[local-delivery:webhook] return-pickup duplicate ignored shop=${shop} orderId=${lalamoveOrderId} status=${newReturnStatus}`);
      return new Response("OK");
    }

    await prisma.returnPickupRequest.updateMany({
      where: { shop, lalamoveOrderId },
      data: { status: newReturnStatus },
    });

    console.info(`[local-delivery:webhook] return-pickup synced shop=${shop} orderId=${lalamoveOrderId} ${externalStatus} → ${newReturnStatus}`);
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
    console.info(`[local-delivery:webhook] out-of-order status dropped shop=${shop} orderId=${lalamoveOrderId} incoming=${externalStatus} currentMax=${maxCurrentPriority}`);
    return new Response("OK");
  }

  // ── Deduplication ─────────────────────────────────────────────────────────
  // If all maps already carry this exact status, the Shopify state was already
  // applied — skip to avoid duplicate fulfillment events.
  const alreadySynced = orderMaps.every(
    (m: { currentStatus?: string | null }) => m.currentStatus === externalStatus,
  );
  if (alreadySynced) {
    console.info(`[local-delivery:webhook] duplicate status ignored shop=${shop} orderId=${lalamoveOrderId} status=${externalStatus}`);
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

  // Resolve dispatchJobId: prefer metadata, fall back to orderMap record
  const effectiveDispatchJobId =
    dispatchJobId ?? (orderMaps[0]?.dispatchJobId as string | undefined) ?? null;

  if (effectiveDispatchJobId) {
    await prismaAny.lalamoveDispatchJob.updateMany({
      where: { shop, id: effectiveDispatchJobId },
      data: { status: externalStatus, lalamoveOrderId },
    });
  }

  // ── Auto-retry on terminal failure ─────────────────────────────────────────

  if (isFailure && effectiveDispatchJobId) {
    try {
      const jobForRetry = await prismaAny.lalamoveDispatchJob.findUnique({
        where: { id: effectiveDispatchJobId },
      });
      if (jobForRetry && (jobForRetry.retryCount ?? 0) < 2) {
        console.info(
          `[local-delivery:webhook] auto-retry START shop=${shop} job=${effectiveDispatchJobId} status=${externalStatus} retryCount=${jobForRetry.retryCount ?? 0}`,
        );
        const adminClient = await unauthenticated.admin(shop);
        const { autoRetryDispatchJob } = await import(
          "../services/lalamove-escalation.server"
        );
        const retryResult = await autoRetryDispatchJob(
          jobForRetry,
          shop,
          adminClient.admin,
        );
        console.info(
          `[local-delivery:webhook] auto-retry ${retryResult.success ? "OK" : "FAILED"} shop=${shop} job=${effectiveDispatchJobId} error=${retryResult.error ?? "none"}`,
        );
        if (retryResult.success) {
          // Skip normal failure sync — new order is active
          return new Response("OK");
        }
      }
    } catch (retryErr) {
      console.error(
        `[local-delivery:webhook] auto-retry ERROR shop=${shop} job=${effectiveDispatchJobId}`,
        retryErr,
      );
      // Fall through to normal failure handling
    }
  }

  // ── Tag operations (no Shopify fulfillment mutations) ─────────────────────

  // Resolved failure reason (used by both tag application and Shopify metafield mirror)
  const resolvedFailureReason = isFailure
    ? String(data?.failureReason ?? data?.cancelReason ?? "").trim() || `Delivery ${mapped}`
    : null;

  // Mirror status into the Shopify order's custom.lalamove_delivery_status metafield
  // (and append a [Lalamove] note line on terminal-failure events). Best-effort —
  // never block the webhook 200 if Shopify is unreachable or returns user errors.
  const mirrorStatusToShopify = async (adminClient: { admin: import("@shopify/shopify-app-react-router/server").AdminApiContext }) => {
    const orderIds = orderMaps.map((item: { shopifyOrderId: string }) => item.shopifyOrderId);
    await Promise.all(
      orderIds.map(async (id: string) => {
        try {
          await syncLalamoveStatusToShopify({
            admin: adminClient.admin,
            shopifyOrderId: id,
            lalamoveStatus: normalized,
            failureReason: resolvedFailureReason,
            shop,
          });
        } catch (mirrorErr) {
          console.error(
            `[local-delivery:webhook] metafield mirror ERROR shop=${shop} orderId=${lalamoveOrderId} shopifyOrderId=${id}`,
            mirrorErr,
          );
        }
      }),
    );
  };

  // On COMPLETED: rename route tags to archived format (ld_rota-## → ld_rota-##_YY.MM.DD)
  if (mapped === "delivered") {
    try {
      const adminClient = await unauthenticated.admin(shop);
      const orderIds = orderMaps.map((item: { shopifyOrderId: string }) => item.shopifyOrderId);
      const now = new Date();
      const dateStr = `${String(now.getFullYear()).slice(-2)}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
      await Promise.all(orderIds.map((id: string) => renameRouteTagsToArchive(adminClient.admin, id, dateStr)));
      // Mark dispatch job as FULFILLED so it's excluded from future loads
      if (effectiveDispatchJobId) {
        await prismaAny.lalamoveDispatchJob.updateMany({
          where: { shop, id: effectiveDispatchJobId },
          data: { status: "FULFILLED" },
        });
      }
      console.info(`[local-delivery:webhook] COMPLETED — tags archived shop=${shop} orderId=${lalamoveOrderId} date=${dateStr}`);
      await mirrorStatusToShopify(adminClient);
    } catch (error) {
      console.error(`[local-delivery:webhook] tag rename FAILED shop=${shop} orderId=${lalamoveOrderId}`, error);
    }
    return new Response("OK");
  }

  // On failure: add failure tags (no fulfillment mutations)
  if (isFailure) {
    try {
      const adminClient = await unauthenticated.admin(shop);
      const orderIds = orderMaps.map((item: { shopifyOrderId: string }) => item.shopifyOrderId);
      await applyLalamoveDeliveryState(adminClient.admin, {
        orderIds,
        state: mapped,
        reason: resolvedFailureReason ?? `Delivery ${mapped}`,
      });
      await mirrorStatusToShopify(adminClient);
    } catch (error) {
      console.error(`[local-delivery:webhook] failure tags FAILED shop=${shop} orderId=${lalamoveOrderId} status=${externalStatus}`, error);
    }
  } else {
    // Non-terminal mapped status (assigning / heading_to_pickup / in_progress):
    // mirror the status to Shopify so downstream consumers see the live state.
    try {
      const adminClient = await unauthenticated.admin(shop);
      await mirrorStatusToShopify(adminClient);
    } catch (error) {
      console.error(`[local-delivery:webhook] metafield mirror FAILED shop=${shop} orderId=${lalamoveOrderId} status=${externalStatus}`, error);
    }
  }

  console.info(`[local-delivery:webhook] synced shop=${shop} orderId=${lalamoveOrderId} ${externalStatus} → ${mapped}`);
  return new Response("OK");
};
