/**
 * lalamove-escalation.server.ts
 *
 * Handles automatic priority-fee escalation and cancel+re-request logic for
 * Lalamove dispatch jobs that are stuck in ASSIGNING_DRIVER status.
 *
 * Escalation schedule (minutes since requestedAt):
 *   10 min → add 10% priority fee (level 0 → 1)
 *   20 min → add 15% priority fee (level 1 → 2)
 *   30 min → add 20% priority fee (level 2 → 3)
 *   40 min → cancel order + re-request from scratch (level resets to 0)
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  addLalamovePriorityFee,
  buildLalamoveRecipientRemarks,
  cancelLalamoveOrder,
  createLalamoveQuotation,
  getLalamoveOrderDetails,
  normalizePhoneForMarket,
  placeLalamoveOrder,
} from "./lalamove.server";
import { getRuntimeCredentialsForShop } from "./lalamove-credentials.server";
import { applyLalamoveDeliveryState } from "./lalamove-sync.server";
import { resolveConfiguredSpecialRequests } from "./lalamove-special-requests.server";


// ── Escalation thresholds (minutes) ─────────────────────────────────────────

const LEVEL_1_MINUTES = 10;
const LEVEL_2_MINUTES = 20;
const LEVEL_3_MINUTES = 30;
const REORDER_MINUTES = 40;
/**
 * Hard cap on escalation reorders per job. Above this count the job flips
 * to status="NEEDS_REVIEW" instead of cancelling+re-requesting again.
 *
 * Background (2026-05-18 incident): the escalation engine had no upper
 * bound, only the 40-min cadence. When a delivery sat without a driver
 * for many hours, the watchdog would send a new driver-invitation push
 * every 40 minutes indefinitely — 13 invitations on one Shops Jardins
 * dispatch and 15 on a Recife dispatch across ~9 hours each. Each
 * invitation is a real "new gig at this store" push to nearby drivers,
 * and any driver who started moving before Lalamove auto-cancelled their
 * slot drove to the GE Beauty store expecting a pickup. Multiple
 * "unexpected drivers" reports from the POS team traced back to this.
 *
 * 3 attempts = roughly 2h of trying; if Lalamove can't match a driver
 * in that window, operator intervention is warranted.
 */
const MAX_REORDER_ATTEMPTS = 3;

// ── Priority fee calculation ─────────────────────────────────────────────────

const MIN_FEE_AMOUNT = "4.00"; // Lalamove BR rejects anything below ~R$4; keep as a flat floor.

const FEE_PERCENTAGES: Record<number, number> = {
  1: 0.10, // 10%
  2: 0.15, // +15%
  3: 0.20, // +20%
};

function computeFeeAmount(quotationTotal: string | null, level: 1 | 2 | 3): string {
  const total = parseFloat(quotationTotal ?? "0");
  if (!total || isNaN(total)) return MIN_FEE_AMOUNT;
  const percentage = FEE_PERCENTAGES[level] ?? 0.10;
  const fee = (total * percentage).toFixed(2);
  return parseFloat(fee) >= parseFloat(MIN_FEE_AMOUNT)
    ? fee
    : MIN_FEE_AMOUNT;
}

// ── Priority fee helper ──────────────────────────────────────────────────

/**
 * Try to apply a priority fee via the Lalamove API. If the API call fails with
 * a transient error, still advance the DB level so the next cron tick moves
 * forward instead of retrying the same level indefinitely.
 */
async function applyPriorityFeeWithFallback(
  job: { id: string; market: string; lalamoveOrderId: string },
  targetLevel: 1 | 2 | 3,
  feeAmount: string,
  credentials: { apiKey: string; apiSecret: string },
  prismaAny: any,
): Promise<void> {
  try {
    await addLalamovePriorityFee(job.market, job.lalamoveOrderId, feeAmount, credentials);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Terminal errors (order already moved past ASSIGNING_DRIVER) must propagate
    // so the caller's catch block can mark the job stale.
    const isTerminal =
      (message.includes("422:") && message.includes("beyond allowable order status")) ||
      message.startsWith("404:");
    if (isTerminal) throw err;

    // Transient failure — log but still advance the level so we don't get stuck
    console.warn(`[escalation] priority fee API failed (advancing level anyway) job=${job.id} level=${targetLevel} error=${message}`);
  }
  await prismaAny.lalamoveDispatchJob.update({
    where: { id: job.id },
    data: { priorityFeeLevel: targetLevel },
  });
}

// ── Public types ─────────────────────────────────────────────────────────────

export type EscalationActionType =
  | { type: "priority_fee"; level: 1 | 2 | 3 }
  | { type: "reorder" };

export type EscalationResult = {
  jobId: string;
  routeId: string;
  action: EscalationActionType;
  success: boolean;
  error?: string;
};

// ── Terminal error handler (status-driven branching) ────────────────────────

const TERMINAL_ORDER_STATUS_HINT = "beyond allowable order status";
const MIN_FEE_ERROR_HINT = "amount you attempted to add does not reach the minimum";

type LalamoveLiveStatus =
  | "ASSIGNING_DRIVER"
  | "ON_GOING"
  | "PICKED_UP"
  | "COMPLETED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED";

const mapStatusToDeliveryState = (
  status: string,
):
  | "assigning"
  | "heading_to_pickup"
  | "in_progress"
  | "delivered"
  | "failed"
  | "rejected"
  | "expired"
  | null => {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ASSIGNING_DRIVER") return "assigning";
  if (normalized === "ON_GOING") return "heading_to_pickup";
  if (normalized === "PICKED_UP") return "in_progress";
  if (normalized === "COMPLETED") return "delivered";
  if (normalized === "CANCELED") return "failed";
  if (normalized === "REJECTED") return "rejected";
  if (normalized === "EXPIRED") return "expired";
  return null;
};

/**
 * When escalation hits a "beyond allowable order status" 422 (or 404), the
 * Lalamove-side state has advanced past ASSIGNING_DRIVER. We don't know what
 * it became — it could be a happy-path progression (driver picked up while we
 * were mid-escalation) OR a failure (cancelled by Lalamove). Fetch the live
 * status and branch:
 *
 *   ON_GOING / PICKED_UP / COMPLETED → sync our DB + Shopify tags; stop escalating.
 *   CANCELED / REJECTED / EXPIRED    → invoke autoRetryDispatchJob to re-request.
 *   ASSIGNING_DRIVER (rare)          → leave job alone, let next tick try again.
 *   Unknown status                   → log and leave alone.
 *
 * Never writes `status: "COMPLETED"` unless that is actually the live Lalamove
 * state. This replaces the old "mark stale and forget" behaviour that abandoned
 * jobs that should have been retried.
 */
async function handleTerminalEscalationError(params: {
  job: any;
  shop: string;
  admin: AdminApiContext;
  credentials: { apiKey: string; apiSecret: string };
  prismaAny: any;
  originalError: string;
  elapsedMinutes: number;
}): Promise<EscalationResult> {
  const { job, shop, admin, credentials, prismaAny, originalError, elapsedMinutes } =
    params;

  const result: EscalationResult = {
    jobId: job.id,
    routeId: job.routeId,
    action: elapsedMinutes >= REORDER_MINUTES
      ? { type: "reorder" }
      : { type: "priority_fee", level: Math.min((job.priorityFeeLevel ?? 0) + 1, 3) as 1 | 2 | 3 },
    success: false,
    error: originalError,
  };

  // Fetch live Lalamove status. 404 here means the order is truly gone → retry.
  let liveStatus: string | null = null;
  try {
    const details = await getLalamoveOrderDetails(
      job.market,
      job.lalamoveOrderId,
      credentials,
    );
    liveStatus = details?.status?.trim().toUpperCase() ?? null;
    console.info(
      `[escalation] terminal-handler job=${job.id} shop=${shop} lalamoveOrderId=${job.lalamoveOrderId} liveStatus=${liveStatus ?? "?"}`,
    );
  } catch (fetchErr) {
    const fetchMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    if (fetchMsg.startsWith("404:")) {
      console.warn(
        `[escalation] terminal-handler job=${job.id} shop=${shop} fetch 404 → retrying as CANCELED`,
      );
      const retryResult = await autoRetryDispatchJob(job, shop, admin);
      return retryResult;
    }
    console.error(
      `[escalation] terminal-handler fetch FAILED job=${job.id} shop=${shop} error=${fetchMsg} — leaving job untouched`,
    );
    return result;
  }

  if (!liveStatus) {
    console.warn(
      `[escalation] terminal-handler job=${job.id} shop=${shop} missing liveStatus — leaving untouched`,
    );
    return result;
  }

  const happyPath: LalamoveLiveStatus[] = ["ON_GOING", "PICKED_UP", "COMPLETED"];
  const failurePath: LalamoveLiveStatus[] = ["CANCELED", "REJECTED", "EXPIRED"];

  if (happyPath.includes(liveStatus as LalamoveLiveStatus)) {
    // Happy path — a webhook was missed. Sync DB and Shopify tags, stop escalating.
    console.info(
      `[escalation] terminal-handler job=${job.id} shop=${shop} liveStatus=${liveStatus} → syncing DB + tags, stop escalating`,
    );
    await prismaAny.lalamoveDispatchJob
      .update({ where: { id: job.id }, data: { status: liveStatus } })
      .catch((e: unknown) =>
        console.error(`[escalation] terminal-handler job=${job.id} status update failed`, e),
      );
    try {
      const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
        where: { shop, dispatchJobId: job.id },
        select: { shopifyOrderId: true },
      });
      const shopifyOrderIds = orderMaps.map(
        (m: { shopifyOrderId: string }) => m.shopifyOrderId,
      );
      const deliveryState = mapStatusToDeliveryState(liveStatus);
      if (deliveryState && shopifyOrderIds.length > 0) {
        await applyLalamoveDeliveryState(admin, {
          orderIds: shopifyOrderIds,
          state: deliveryState,
          reason: `Recovered from terminal escalation error (${originalError})`,
        });
      }
      await prismaAny.lalamoveDispatchOrderMap.updateMany({
        where: { shop, dispatchJobId: job.id },
        data: { currentStatus: liveStatus },
      });
    } catch (syncErr) {
      console.error(
        `[escalation] terminal-handler job=${job.id} Shopify sync FAILED`,
        syncErr,
      );
    }
    result.success = true;
    result.error = `Recovered — liveStatus=${liveStatus}`;
    return result;
  }

  if (failurePath.includes(liveStatus as LalamoveLiveStatus)) {
    console.info(
      `[escalation] terminal-handler job=${job.id} shop=${shop} liveStatus=${liveStatus} → invoking autoRetryDispatchJob`,
    );
    return autoRetryDispatchJob(job, shop, admin);
  }

  if (liveStatus === "ASSIGNING_DRIVER") {
    console.warn(
      `[escalation] terminal-handler job=${job.id} shop=${shop} unexpected liveStatus=ASSIGNING_DRIVER after 422 — leaving untouched`,
    );
    return result;
  }

  console.warn(
    `[escalation] terminal-handler job=${job.id} shop=${shop} unmapped liveStatus=${liveStatus} — leaving untouched`,
  );
  return result;
}

// ── Main function ────────────────────────────────────────────────────────────

/**
 * Check all ASSIGNING_DRIVER jobs for this shop and apply the appropriate
 * escalation action based on elapsed time since requestedAt.
 */
export async function checkAndApplyEscalations(
  shop: string,
  admin: AdminApiContext,
): Promise<EscalationResult[]> {
  const prismaAny = prisma as any;

  const credentials = await getRuntimeCredentialsForShop(shop);
  if (!credentials) {
    console.warn("[escalation] No Lalamove credentials for shop:", shop);
    return [];
  }

  // Only process jobs actively looking for a driver
  const jobs = await prismaAny.lalamoveDispatchJob.findMany({
    where: { shop, status: "ASSIGNING_DRIVER" },
  });

  if (jobs.length === 0) return [];

  const results: EscalationResult[] = [];

  for (const job of jobs) {
    const elapsedMinutes =
      (Date.now() - new Date(job.requestedAt).getTime()) / 60_000;
    const level = job.priorityFeeLevel ?? 0;

    try {
      if (elapsedMinutes >= REORDER_MINUTES) {
        // ── 60+ min: cancel + re-request regardless of fee level ──────────
        // Previously gated on level >= 3, which meant missed cron ticks or
        // failed priority fees could block reorder indefinitely.
        console.info(`[escalation] reorder triggered job=${job.id} elapsed=${elapsedMinutes.toFixed(1)}min level=${level}`);
        const reorderResult = await reorderJob(job, shop, admin, credentials, prismaAny);
        if (!reorderResult.success) {
          console.error(`[escalation] reorder result FAILED job=${job.id} error=${reorderResult.error ?? "?"}`);
        }
        results.push(reorderResult);
      } else if (level < 3 && elapsedMinutes >= LEVEL_3_MINUTES) {
        // ── 30 min: +20% priority fee (catch up from any level) ──────────
        const fee = computeFeeAmount(job.quotationTotal, 3);
        await applyPriorityFeeWithFallback(job, 3, fee, credentials, prismaAny);
        results.push({ jobId: job.id, routeId: job.routeId, action: { type: "priority_fee", level: 3 }, success: true });
      } else if (level < 2 && elapsedMinutes >= LEVEL_2_MINUTES) {
        // ── 20 min: +15% priority fee (catch up from level 0) ───────────
        const fee = computeFeeAmount(job.quotationTotal, 2);
        await applyPriorityFeeWithFallback(job, 2, fee, credentials, prismaAny);
        results.push({ jobId: job.id, routeId: job.routeId, action: { type: "priority_fee", level: 2 }, success: true });
      } else if (level < 1 && elapsedMinutes >= LEVEL_1_MINUTES) {
        // ── 10 min: +10% priority fee ────────────────────────────────────
        const fee = computeFeeAmount(job.quotationTotal, 1);
        await applyPriorityFeeWithFallback(job, 1, fee, credentials, prismaAny);
        results.push({ jobId: job.id, routeId: job.routeId, action: { type: "priority_fee", level: 1 }, success: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[escalation] Action failed job=${job.id} shop=${shop} lalamoveOrderId=${job.lalamoveOrderId ?? "?"} level=${level} elapsed=${elapsedMinutes.toFixed(1)}min error=${message}`);

      // "Amount does not reach the minimum" is a transient fee-sizing error —
      // applyPriorityFeeWithFallback already handles it (warn + advance level),
      // so it should never reach this catch. Defensive no-op in case it does.
      if (message.includes(MIN_FEE_ERROR_HINT)) {
        console.warn(`[escalation] min-fee error surfaced to outer catch job=${job.id} — ignoring, next tick will retry`);
        results.push({
          jobId: job.id,
          routeId: job.routeId,
          action: { type: "priority_fee", level: Math.min(level + 1, 3) as 1 | 2 | 3 },
          success: false,
          error: message,
        });
        continue;
      }

      const isTerminal =
        (message.includes("422") && message.includes(TERMINAL_ORDER_STATUS_HINT)) ||
        message.startsWith("404:");
      if (isTerminal) {
        // Don't mark COMPLETED — fetch live status and branch. If the order
        // actually failed, autoRetryDispatchJob will be invoked. If it
        // actually progressed past ASSIGNING_DRIVER (missed webhook), sync
        // the DB + Shopify tags.
        const handled = await handleTerminalEscalationError({
          job,
          shop,
          admin,
          credentials,
          prismaAny,
          originalError: message,
          elapsedMinutes,
        });
        results.push(handled);
        continue;
      }

      // Other 422s (validation errors, etc.) — treat as transient, log and move on.
      results.push({
        jobId: job.id,
        routeId: job.routeId,
        action: elapsedMinutes >= REORDER_MINUTES
          ? { type: "reorder" }
          : { type: "priority_fee", level: Math.min(level + 1, 3) as 1 | 2 | 3 },
        success: false,
        error: message,
      });
    }
  }

  return results;
}

// ── Re-order helper ──────────────────────────────────────────────────────────

type OrderStop = {
  shopifyOrderId: string;
  lat: number;
  lng: number;
  address: string;
  name: string;
  phone: string;
};

const MAX_STOP_MATCH_DISTANCE = 0.0003;

const coordKey = (lat: number | string, lng: number | string) => {
  const latitude = typeof lat === "string" ? parseFloat(lat) : lat;
  const longitude = typeof lng === "string" ? parseFloat(lng) : lng;
  return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
};

const parseCoord = (value: string | number | null | undefined) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

async function reorderJob(
  job: any,
  shop: string,
  admin: AdminApiContext,
  credentials: { apiKey: string; apiSecret: string },
  prismaAny: any,
  options?: { skipCancel?: boolean },
): Promise<EscalationResult> {
  const result: EscalationResult = {
    jobId: job.id,
    routeId: job.routeId,
    action: { type: "reorder" },
    success: false,
  };

  // ── Hard cap (2026-05-19) ────────────────────────────────────────────────
  // Stop sending driver-invitation pushes once we've reorderd MAX_REORDER_ATTEMPTS
  // times for the same job. Flip the status to NEEDS_REVIEW so the watchdog's
  // escalation query (`status: "ASSIGNING_DRIVER"`) no longer matches it.
  // Operator must manually advance the job (re-dispatch or cancel for good).
  const currentReorderCount = job.reorderCount ?? 0;
  if (currentReorderCount >= MAX_REORDER_ATTEMPTS) {
    console.warn(
      `[escalation] reorder CAP REACHED job=${job.id} shop=${shop} count=${currentReorderCount} max=${MAX_REORDER_ATTEMPTS} — flipping to NEEDS_REVIEW`,
    );
    // Cancel the current Lalamove order (best-effort) so we stop being on the
    // hook for it. The flip to NEEDS_REVIEW removes it from any auto path.
    if (!options?.skipCancel && job.lalamoveOrderId) {
      try {
        await cancelLalamoveOrder(job.market, job.lalamoveOrderId, credentials);
      } catch (cancelErr) {
        const msg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
        // 422/404 = already terminal; that's fine.
        if (!msg.includes("422") && !msg.startsWith("404:")) {
          console.warn(
            `[escalation] reorder CAP cancel non-fatal job=${job.id} error=${msg.slice(0, 150)}`,
          );
        }
      }
    }
    await prismaAny.lalamoveDispatchJob.update({
      where: { id: job.id },
      data: { status: "NEEDS_REVIEW" },
    });
    result.error = `Max reorder attempts (${MAX_REORDER_ATTEMPTS}) reached — job flipped to NEEDS_REVIEW`;
    return result;
  }

  // 1. Cancel the existing Lalamove order (skip if already terminal)
  if (!options?.skipCancel) {
    try {
      await cancelLalamoveOrder(job.market, job.lalamoveOrderId, credentials);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTerminal =
        (message.includes("422") && message.includes(TERMINAL_ORDER_STATUS_HINT)) ||
        message.startsWith("404:");
      if (isTerminal) {
        // Order already moved past ASSIGNING_DRIVER — re-request by delegating
        // to autoRetryDispatchJob, which fetches the live Lalamove state and
        // either syncs or retries. Previously this marked CANCELED and
        // returned, leaving the watchdog safety net to eventually pick it up.
        console.warn(
          `[escalation] cancel terminal job=${job.id} error=${message} → delegating to autoRetryDispatchJob`,
        );
        return autoRetryDispatchJob(job, shop, admin);
      }
      // Transient failure — log and skip re-request
      console.error(
        `[escalation] cancel transient FAILED job=${job.id} error=${message}`,
      );
      result.error = `Cancel failed: ${message}`;
      return result;
    }
  }

  // 2. Get route stops — prefer the dispatch job's own snapshot (set at create
  // time) and fall back to PendingDeliveryRoute only for pre-migration jobs.
  let ordersData: OrderStop[] | null = null;
  if (Array.isArray(job.ordersData) && job.ordersData.length > 0) {
    ordersData = job.ordersData as OrderStop[];
  } else {
    const routeRecord = await prismaAny.pendingDeliveryRoute.findFirst({
      where: { routeId: job.routeId, shop },
    });
    if (routeRecord) {
      ordersData = routeRecord.ordersData as OrderStop[];
    }
  }
  if (!ordersData || ordersData.length === 0) {
    result.error =
      "No order stops available for reorder (job.ordersData empty and no PendingDeliveryRoute): " +
      job.routeId;
    console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
    return result;
  }

  // 3. Get Lalamove config for this location
  const configRow = await prismaAny.lalamoveLocationConfig.findUnique({
    where: { shop_locationId: { shop, locationId: job.locationId } },
  });
  if (!configRow) {
    result.error = "LalamoveLocationConfig not found for locationId: " + job.locationId;
    console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
    return result;
  }
  const config = configRow.data as {
    market: string;
    language: string;
    preferredServiceType?: string;
    locationAddress?: string;
    locationName?: string;
    locationPhone?: string;
    pickupInstructions?: string;
    pickupLat?: number;
    pickupLng?: number;
    city?: string | null;
  };

  // 4. Get pickup location coordinates from Shopify GraphQL
  let pickupLat: number | null = config.pickupLat ?? null;
  let pickupLng: number | null = config.pickupLng ?? null;
  let pickupAddress = config.locationAddress?.trim() ?? "";

  if (pickupLat == null || pickupLng == null) {
    try {
      const locRes = await admin.graphql(
        `#graphql
          query EscalationPickupLocation($id: ID!) {
            location(id: $id) {
              address {
                address1
                city
                province
                zip
                country
                latitude
                longitude
              }
            }
          }`,
        { variables: { id: job.locationId } },
      );
      const locJson = await locRes.json();
      const addr = locJson?.data?.location?.address;
      pickupLat = addr?.latitude ?? null;
      pickupLng = addr?.longitude ?? null;
      if (!pickupAddress && addr) {
        pickupAddress = [addr.address1, addr.city, addr.province, addr.zip, addr.country]
          .filter(Boolean)
          .join(", ");
      }
    } catch (err) {
      result.error = "Failed to fetch pickup location coordinates.";
      console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
      return result;
    }
  }

  if (pickupLat == null || pickupLng == null) {
    result.error = "Missing pickup coordinates for re-request.";
    console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
    return result;
  }

  // 5. Build quotation stops
  const deliveryStops = ordersData.map((stop) => ({
    coordinates: { lat: String(stop.lat), lng: String(stop.lng) },
    address: stop.address,
  }));

  const quotationStops = [
    {
      coordinates: { lat: String(pickupLat), lng: String(pickupLng) },
      address: pickupAddress,
    },
    ...deliveryStops,
  ];

  // 6. Resolve configured special requests (e.g. WAITING_TIME_030MIN) for
  // this shop + market + city so reorder preserves the merchant's preferences.
  const specialRequests = await resolveConfiguredSpecialRequests(
    shop,
    {
      market: job.market,
      city: config.city ?? null,
      preferredServiceType: config.preferredServiceType?.trim() || "LALAGO",
    },
    credentials,
  );

  // 7. Create new quotation
  let newQuotation;
  try {
    newQuotation = await createLalamoveQuotation(
      {
        market: job.market,
        language: config.language,
        serviceType: config.preferredServiceType?.trim() || "LALAGO",
        stops: quotationStops,
        isRouteOptimized: quotationStops.length >= 3,
        ...(specialRequests.length > 0 ? { specialRequests } : {}),
      },
      credentials,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Quotation failed: ${message}`;
    console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
    return result;
  }

  const stopIds = (newQuotation.stops ?? [])
    .map((s) => s.stopId)
    .filter(Boolean) as string[];
  if (stopIds.length < 2) {
    result.error = "New quotation returned insufficient stopIds.";
    console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
    return result;
  }

  const senderStopId = stopIds[0]!;
  const recipientStopIds = stopIds.slice(1);
  const responseDeliveryStops = (newQuotation.stops ?? []).slice(1);
  if (responseDeliveryStops.length !== recipientStopIds.length) {
    result.error = "Optimized stop count mismatch in escalation re-request.";
    console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
    return result;
  }

  const queueByCoord = new Map<string, string[]>();
  const pointByOrderId = new Map<string, { lat: number; lng: number }>();
  for (const stop of ordersData) {
    pointByOrderId.set(stop.shopifyOrderId, { lat: stop.lat, lng: stop.lng });
    const key = coordKey(stop.lat, stop.lng);
    const list = queueByCoord.get(key) ?? [];
    list.push(stop.shopifyOrderId);
    queueByCoord.set(key, list);
  }
  const remainingOrderIds = new Set(ordersData.map((stop) => stop.shopifyOrderId));
  const assignmentOrderIds: string[] = [];
  for (const stop of responseDeliveryStops) {
    const lat = parseCoord(stop.coordinates?.lat);
    const lng = parseCoord(stop.coordinates?.lng);
    if (lat == null || lng == null) {
      result.error = "Optimized stop missing coordinates in escalation re-request.";
      console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
      return result;
    }

    let matchedOrderId: string | undefined;
    const exactQueue = queueByCoord.get(coordKey(lat, lng));
    while (exactQueue && exactQueue.length > 0) {
      const candidate = exactQueue.shift();
      if (candidate && remainingOrderIds.has(candidate)) {
        matchedOrderId = candidate;
        break;
      }
    }
    if (!matchedOrderId) {
      let best: { orderId: string; distance: number } | null = null;
      for (const orderId of remainingOrderIds) {
        const point = pointByOrderId.get(orderId);
        if (!point) continue;
        const distance = Math.hypot(lat - point.lat, lng - point.lng);
        if (!best || distance < best.distance) {
          best = { orderId, distance };
        }
      }
      if (!best || best.distance > MAX_STOP_MATCH_DISTANCE) {
        result.error =
          "Unable to map optimized stops to orders during escalation re-request.";
        console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
        return result;
      }
      matchedOrderId = best.orderId;
    }
    remainingOrderIds.delete(matchedOrderId);
    assignmentOrderIds.push(matchedOrderId);
  }

  const orderContactsRes = await admin.graphql(
    `#graphql
      query EscalationOrderContacts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            name
            shippingAddress {
              address2
              phone
            }
            customer {
              displayName
              phone
              defaultPhoneNumber { phoneNumber }
            }
          }
        }
      }`,
    { variables: { ids: assignmentOrderIds } },
  );
  const orderContactsJson = await orderContactsRes.json();
  const orderNodes = (orderContactsJson?.data?.nodes ?? []) as Array<{
    id: string;
    name: string;
    shippingAddress?: { address2?: string | null; phone?: string | null } | null;
    customer?: {
      displayName?: string | null;
      phone?: string | null;
      defaultPhoneNumber?: { phoneNumber: string } | null;
    } | null;
  }>;
  const orderById = new Map(orderNodes.map((order) => [order.id, order]));
  const missingOrderId = assignmentOrderIds.find((orderId) => !orderById.has(orderId));
  if (missingOrderId) {
    result.error = `Missing Shopify order data during escalation re-request: ${missingOrderId}`;
    console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
    return result;
  }

  // 7. Build recipients from explicit assignment order
  const pickupInstructions = config.pickupInstructions?.trim();
  const recipients = recipientStopIds.map((stopId, index) => {
    const orderId = assignmentOrderIds[index]!;
    const order = orderById.get(orderId)!;
    const remarks = buildLalamoveRecipientRemarks(
      index,
      pickupInstructions,
      order.shippingAddress?.address2,
    );
    return {
      stopId,
      name: order.customer?.displayName || order.name || "Customer",
      phone: (() => {
        const candidates = [
          order.customer?.defaultPhoneNumber?.phoneNumber,
          order.shippingAddress?.phone,
          order.customer?.phone,
        ];
        for (const candidate of candidates) {
          const normalized = normalizePhoneForMarket(candidate, job.market);
          if (normalized) return normalized;
        }
        return config.locationPhone || "";
      })(),
      ...(remarks ? { remarks } : {}),
    };
  });

  // 8. Place new order
  let newOrderResponse;
  try {
    newOrderResponse = await placeLalamoveOrder(
      {
        market: job.market,
        quotationId: newQuotation.quotationId,
        sender: {
          stopId: senderStopId,
          name: config.locationName?.trim() ?? "",
          phone: config.locationPhone ?? "",
        },
        recipients,
        isPODEnabled: true,
        metadata: { shop },
      },
      credentials,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Place order failed: ${message}`;
    console.error(`[escalation] reorder FAILED job=${job.id} error=${result.error}`);
    return result;
  }

  // 9. Update DB records
  await prismaAny.lalamoveDispatchJob.update({
    where: { id: job.id },
    data: {
      lalamoveOrderId: newOrderResponse.orderId,
      quotationId: newQuotation.quotationId,
      status: newOrderResponse.status,
      requestedAt: new Date(),
      priorityFeeLevel: 0,
      // Increment escalation reorder counter. Cap enforced at the top of
      // this function — once reorderCount hits MAX_REORDER_ATTEMPTS, the
      // next tick flips to NEEDS_REVIEW instead of re-requesting again.
      reorderCount: { increment: 1 },
    },
  });

  await prismaAny.lalamoveDispatchOrderMap.updateMany({
    where: { shop, dispatchJobId: job.id },
    data: {
      lalamoveOrderId: newOrderResponse.orderId,
      currentStatus: newOrderResponse.status,
    },
  });

  result.success = true;
  console.info("[escalation] Re-requested job", job.id, "→ new order", newOrderResponse.orderId);
  return result;
}

// ── Find-new-driver watchdog (mid-flight stuck driver) ──────────────────────

/**
 * Stuck-driver recovery: cancel the current Lalamove order and re-request a
 * fresh quotation + order so Lalamove invites new drivers. Invoked by the
 * `check-dispatches` cron when a driver's distance-to-pickup has stalled or
 * grown for APPROACH_STRIKE_LIMIT consecutive samples.
 *
 * Lalamove's DELETE /v3/orders/{id} returns 422 ERR_CANCELLATION
 * ("Cannot cancel order.") once the driver has accepted past the early window.
 * Empirically discovered 2026-05-20: applying a small priority fee unblocks
 * the cancellation. The fee here is a workaround, NOT a "go-faster" payment.
 *
 * Outcomes:
 *   - cancel OK → delegate to reorderJob(skipCancel=true) for re-POST.
 *   - cancel ERR_CANCELLATION → apply MIN_FEE_AMOUNT priority fee, retry cancel
 *     once; on success delegate to reorderJob, on failure flip the job to
 *     NEEDS_REVIEW with reason="driver-locked-share-link" so the operator can
 *     contact the driver via the Lalamove share link.
 *   - cancel returns terminal-status error (beyond allowable / 404) → delegate
 *     to autoRetryDispatchJob which fetches live state and either syncs or
 *     retries. Same defensive-guard path as escalation reorder.
 *   - any other cancel failure → return error, leave job untouched.
 *
 * reorderCount is incremented inside reorderJob; MAX_REORDER_ATTEMPTS cap
 * applies here too — at the cap the job flips to NEEDS_REVIEW.
 */
export async function findNewDriverForJob(
  jobId: string,
  shop: string,
  admin: AdminApiContext,
): Promise<EscalationResult> {
  const job = await prisma.lalamoveDispatchJob.findUnique({
    where: { id: jobId },
  });
  if (!job) {
    console.error(`[find-new-driver] job not found jobId=${jobId} shop=${shop}`);
    return {
      jobId,
      routeId: "",
      action: { type: "reorder" },
      success: false,
      error: "Job not found",
    };
  }
  if (!job.lalamoveOrderId || !job.market) {
    return {
      jobId,
      routeId: job.routeId,
      action: { type: "reorder" },
      success: false,
      error: !job.lalamoveOrderId
        ? "Job has no lalamoveOrderId"
        : "Job has no market",
    };
  }
  const lalamoveOrderId: string = job.lalamoveOrderId;
  const market: string = job.market;

  const credentials = await getRuntimeCredentialsForShop(shop);
  if (!credentials) {
    console.warn(`[find-new-driver] no credentials shop=${shop}`);
    return {
      jobId,
      routeId: job.routeId,
      action: { type: "reorder" },
      success: false,
      error: "No Lalamove credentials configured.",
    };
  }

  console.info(
    `[find-new-driver] START job=${jobId} shop=${shop} lalamoveOrderId=${lalamoveOrderId} reorderCount=${job.reorderCount ?? 0}`,
  );

  // 1. Try to cancel the current Lalamove order
  try {
    await cancelLalamoveOrder(market, lalamoveOrderId, credentials);
    console.info(`[find-new-driver] cancel OK job=${jobId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    const isErrCancellation =
      message.includes("ERR_CANCELLATION") ||
      (message.includes("422") && message.toLowerCase().includes("cannot cancel order"));

    if (isErrCancellation) {
      console.warn(
        `[find-new-driver] cancel BLOCKED job=${jobId} reason=ERR_CANCELLATION → applying priority fee ${MIN_FEE_AMOUNT} to unblock`,
      );

      try {
        await addLalamovePriorityFee(
          market,
          lalamoveOrderId,
          MIN_FEE_AMOUNT,
          credentials,
        );
      } catch (feeErr) {
        const feeMsg = feeErr instanceof Error ? feeErr.message : String(feeErr);
        console.error(
          `[find-new-driver] priority fee FAILED job=${jobId} error=${feeMsg} → flipping NEEDS_REVIEW`,
        );
        await prisma.lalamoveDispatchJob.update({
          where: { id: jobId },
          data: {
            status: "NEEDS_REVIEW",
            needsReviewReason: "driver-locked-share-link",
          },
        });
        return {
          jobId,
          routeId: job.routeId,
          action: { type: "reorder" },
          success: false,
          error: `Priority fee failed: ${feeMsg}`,
        };
      }

      try {
        await cancelLalamoveOrder(market, lalamoveOrderId, credentials);
        console.info(
          `[find-new-driver] cancel retry OK job=${jobId} after priority fee`,
        );
      } catch (retryErr) {
        const retryMsg =
          retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.warn(
          `[find-new-driver] cancel retry FAILED job=${jobId} error=${retryMsg} → flipping NEEDS_REVIEW`,
        );
        await prisma.lalamoveDispatchJob.update({
          where: { id: jobId },
          data: {
            status: "NEEDS_REVIEW",
            needsReviewReason: "driver-locked-share-link",
          },
        });
        return {
          jobId,
          routeId: job.routeId,
          action: { type: "reorder" },
          success: false,
          error: `Cancel retry failed after priority fee: ${retryMsg}`,
        };
      }
    } else {
      const isTerminal =
        (message.includes("422") && message.includes(TERMINAL_ORDER_STATUS_HINT)) ||
        message.startsWith("404:");
      if (isTerminal) {
        console.warn(
          `[find-new-driver] cancel terminal job=${jobId} error=${message} → delegating to autoRetryDispatchJob`,
        );
        return autoRetryDispatchJob(
          { ...job, market, lalamoveOrderId },
          shop,
          admin,
        );
      }
      console.error(
        `[find-new-driver] cancel transient FAILED job=${jobId} error=${message}`,
      );
      return {
        jobId,
        routeId: job.routeId,
        action: { type: "reorder" },
        success: false,
        error: `Cancel failed: ${message}`,
      };
    }
  }

  // 2. Cancel succeeded — delegate to reorderJob for the re-POST.
  // skipCancel: true because we already cancelled above; reorderJob still
  // enforces MAX_REORDER_ATTEMPTS and increments reorderCount.
  return reorderJob(job, shop, admin, credentials, prisma, { skipCancel: true });
}

// ── Auto-retry for webhook-triggered failures ───────────────────────────────

const MAX_AUTO_RETRIES = 2;

/**
 * Attempt to re-request a Lalamove delivery for a failed dispatch job.
 * Used by both the webhook auto-retry and the watchdog cron.
 *
 * Returns an EscalationResult. Increments retryCount in DB.
 * Refuses to retry if retryCount >= MAX_AUTO_RETRIES.
 */
export async function autoRetryDispatchJob(
  job: {
    id: string;
    routeId: string;
    locationId: string;
    market: string;
    lalamoveOrderId: string;
    retryCount?: number;
    shop?: string;
  },
  shop: string,
  admin: AdminApiContext,
): Promise<EscalationResult> {
  const prismaAny = prisma as any;
  const currentRetryCount = job.retryCount ?? 0;

  if (currentRetryCount >= MAX_AUTO_RETRIES) {
    console.warn(
      `[escalation] auto-retry SKIP max retries reached job=${job.id} retries=${currentRetryCount}`,
    );
    return {
      jobId: job.id,
      routeId: job.routeId,
      action: { type: "reorder" },
      success: false,
      error: `Max auto-retry limit (${MAX_AUTO_RETRIES}) reached.`,
    };
  }

  const credentials = await getRuntimeCredentialsForShop(shop);
  if (!credentials) {
    console.warn(`[escalation] auto-retry SKIP no credentials shop=${shop}`);
    return {
      jobId: job.id,
      routeId: job.routeId,
      action: { type: "reorder" },
      success: false,
      error: "No Lalamove credentials configured.",
    };
  }

  // ── Defensive live-status guard ──────────────────────────────────────────
  // Before placing a duplicate Lalamove order, verify the existing one isn't
  // still being delivered. The bug this protects against (incident 2026-05-12):
  // the stale-ON_GOING watchdog path treats Lalamove's `422 Cannot cancel`
  // response as "fine to proceed with retry" — but 422 actually means the
  // order is mid-delivery (ON_GOING/PICKED_UP). Without this guard the
  // watchdog placed duplicate Lalamove orders for routes already being
  // delivered, costing real money.
  if (job.lalamoveOrderId) {
    let liveStatus: string | null = null;
    try {
      const details = await getLalamoveOrderDetails(
        job.market,
        job.lalamoveOrderId,
        credentials,
      );
      liveStatus = details?.status?.trim().toUpperCase() ?? null;
    } catch (fetchErr) {
      const fetchMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      if (fetchMsg.startsWith("404:")) {
        // Original order is genuinely gone — retry is correct.
        console.info(
          `[escalation] auto-retry GUARD job=${job.id} live-status 404 — original gone, proceeding with retry`,
        );
      } else {
        // Any other fetch failure: refuse to retry. Fail-safe.
        console.error(
          `[escalation] auto-retry GUARD fetch FAILED job=${job.id} shop=${shop} error=${fetchMsg} — REFUSING retry to be safe`,
        );
        return {
          jobId: job.id,
          routeId: job.routeId,
          action: { type: "reorder" },
          success: false,
          error: `Live status fetch failed — refusing retry to avoid duplicate: ${fetchMsg}`,
        };
      }
    }
    const happyPath = ["ON_GOING", "PICKED_UP", "COMPLETED"];
    if (liveStatus && happyPath.includes(liveStatus)) {
      console.warn(
        `[escalation] auto-retry GUARD job=${job.id} shop=${shop} lalamoveOrderId=${job.lalamoveOrderId} liveStatus=${liveStatus} — REFUSING duplicate dispatch, syncing DB instead`,
      );
      await prismaAny.lalamoveDispatchJob
        .update({ where: { id: job.id }, data: { status: liveStatus } })
        .catch((e: unknown) =>
          console.error(`[escalation] auto-retry GUARD status update failed job=${job.id}`, e),
        );
      await prismaAny.lalamoveDispatchOrderMap
        .updateMany({
          where: { shop, dispatchJobId: job.id },
          data: { currentStatus: liveStatus },
        })
        .catch((e: unknown) =>
          console.error(`[escalation] auto-retry GUARD orderMap sync failed job=${job.id}`, e),
        );
      return {
        jobId: job.id,
        routeId: job.routeId,
        action: { type: "reorder" },
        success: true,
        error: `Refused duplicate — liveStatus=${liveStatus}`,
      };
    }
  }

  // Increment retry count BEFORE attempting (prevents concurrent retries)
  await prismaAny.lalamoveDispatchJob.update({
    where: { id: job.id },
    data: { retryCount: currentRetryCount + 1, lastRetryAt: new Date() },
  });

  const result = await reorderJob(
    job,
    shop,
    admin,
    credentials,
    prismaAny,
    { skipCancel: true },
  );

  if (!result.success) {
    console.error(
      `[escalation] auto-retry FAILED job=${job.id} attempt=${currentRetryCount + 1} error=${result.error ?? "?"}`,
    );
  } else {
    console.info(
      `[escalation] auto-retry OK job=${job.id} attempt=${currentRetryCount + 1}`,
    );
    // Reset retry count on success (new order starts fresh)
    await prismaAny.lalamoveDispatchJob.update({
      where: { id: job.id },
      data: { retryCount: 0 },
    });
  }

  return result;
}
