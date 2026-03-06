/**
 * lalamove-escalation.server.ts
 *
 * Handles automatic priority-fee escalation and cancel+re-request logic for
 * Lalamove dispatch jobs that are stuck in ASSIGNING_DRIVER status.
 *
 * Escalation schedule (minutes since requestedAt):
 *   20 min → add 10% priority fee (level 0 → 1)
 *   30 min → add another 10% priority fee (level 1 → 2)
 *   45 min → add another 10% priority fee (level 2 → 3)
 *   60 min → cancel order + re-request from scratch (level resets to 0)
 */

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import {
  addLalamovePriorityFee,
  cancelLalamoveOrder,
  createLalamoveQuotation,
  placeLalamoveOrder,
} from "./lalamove.server";
import { getRuntimeCredentialsForShop } from "./lalamove-credentials.server";
import { applyLalamoveDeliveryState } from "./lalamove-sync.server";

// ── Escalation thresholds (minutes) ─────────────────────────────────────────

const LEVEL_1_MINUTES = 20;
const LEVEL_2_MINUTES = 30;
const LEVEL_3_MINUTES = 45;
const REORDER_MINUTES = 60;

// ── Priority fee calculation ─────────────────────────────────────────────────

const MIN_FEE_AMOUNT = "1.00"; // fallback when quotation total is unavailable

function computeFeeAmount(quotationTotal: string | null): string {
  const total = parseFloat(quotationTotal ?? "0");
  if (!total || isNaN(total)) return MIN_FEE_AMOUNT;
  const tenPercent = (total * 0.1).toFixed(2);
  return parseFloat(tenPercent) >= parseFloat(MIN_FEE_AMOUNT)
    ? tenPercent
    : MIN_FEE_AMOUNT;
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

// ── Main function ────────────────────────────────────────────────────────────

/**
 * Check all ASSIGNING_DRIVER jobs for this shop and apply the appropriate
 * escalation action based on elapsed time since requestedAt.
 */
export async function checkAndApplyEscalations(
  shop: string,
  admin: AdminApiContext["admin"],
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
      if (level >= 3 && elapsedMinutes >= REORDER_MINUTES) {
        // ── 60 min: cancel + re-request ───────────────────────────────────
        const reorderResult = await reorderJob(job, shop, admin, credentials, prismaAny);
        results.push(reorderResult);
      } else if (level === 2 && elapsedMinutes >= LEVEL_3_MINUTES) {
        // ── 45 min: third priority fee ────────────────────────────────────
        const fee = computeFeeAmount(job.quotationTotal);
        await addLalamovePriorityFee(job.market, job.lalamoveOrderId, fee, credentials);
        await prismaAny.lalamoveDispatchJob.update({
          where: { id: job.id },
          data: { priorityFeeLevel: 3 },
        });
        results.push({ jobId: job.id, routeId: job.routeId, action: { type: "priority_fee", level: 3 }, success: true });
      } else if (level === 1 && elapsedMinutes >= LEVEL_2_MINUTES) {
        // ── 30 min: second priority fee ───────────────────────────────────
        const fee = computeFeeAmount(job.quotationTotal);
        await addLalamovePriorityFee(job.market, job.lalamoveOrderId, fee, credentials);
        await prismaAny.lalamoveDispatchJob.update({
          where: { id: job.id },
          data: { priorityFeeLevel: 2 },
        });
        results.push({ jobId: job.id, routeId: job.routeId, action: { type: "priority_fee", level: 2 }, success: true });
      } else if (level === 0 && elapsedMinutes >= LEVEL_1_MINUTES) {
        // ── 20 min: first priority fee ────────────────────────────────────
        const fee = computeFeeAmount(job.quotationTotal);
        await addLalamovePriorityFee(job.market, job.lalamoveOrderId, fee, credentials);
        await prismaAny.lalamoveDispatchJob.update({
          where: { id: job.id },
          data: { priorityFeeLevel: 1 },
        });
        results.push({ jobId: job.id, routeId: job.routeId, action: { type: "priority_fee", level: 1 }, success: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[escalation] Action failed for job", job.id, message);
      results.push({
        jobId: job.id,
        routeId: job.routeId,
        action: level >= 3 && elapsedMinutes >= REORDER_MINUTES
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

async function reorderJob(
  job: any,
  shop: string,
  admin: AdminApiContext["admin"],
  credentials: { apiKey: string; apiSecret: string },
  prismaAny: any,
): Promise<EscalationResult> {
  const result: EscalationResult = {
    jobId: job.id,
    routeId: job.routeId,
    action: { type: "reorder" },
    success: false,
  };

  // 1. Cancel the existing Lalamove order
  try {
    await cancelLalamoveOrder(job.market, job.lalamoveOrderId, credentials);
  } catch (err) {
    // If cancel fails (already cancelled, accepted, etc.) log and skip re-request
    const message = err instanceof Error ? err.message : String(err);
    console.error("[escalation] Cancel failed for job", job.id, message);
    result.error = `Cancel failed: ${message}`;
    return result;
  }

  // 2. Get route stops from PendingDeliveryRoute
  const routeRecord = await prismaAny.pendingDeliveryRoute.findFirst({
    where: { routeId: job.routeId, shop },
  });
  if (!routeRecord) {
    result.error = "PendingDeliveryRoute not found for routeId: " + job.routeId;
    return result;
  }
  const ordersData = routeRecord.ordersData as OrderStop[];

  // 3. Get Lalamove config for this location
  const configRow = await prismaAny.lalamoveLocationConfig.findUnique({
    where: { shop_locationId: { shop, locationId: job.locationId } },
  });
  if (!configRow) {
    result.error = "LalamoveLocationConfig not found for locationId: " + job.locationId;
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
      return result;
    }
  }

  if (pickupLat == null || pickupLng == null) {
    result.error = "Missing pickup coordinates for re-request.";
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

  // 6. Create new quotation
  let newQuotation;
  try {
    newQuotation = await createLalamoveQuotation(
      {
        market: job.market,
        language: config.language,
        serviceType: config.preferredServiceType?.trim() || "LALAGO",
        stops: quotationStops,
        isRouteOptimized: quotationStops.length >= 3,
      },
      credentials,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Quotation failed: ${message}`;
    return result;
  }

  const stopIds = (newQuotation.stops ?? [])
    .map((s) => s.stopId)
    .filter(Boolean) as string[];
  if (stopIds.length < 2) {
    result.error = "New quotation returned insufficient stopIds.";
    return result;
  }

  const senderStopId = stopIds[0]!;
  const recipientStopIds = stopIds.slice(1);

  // 7. Build recipients from ordersData
  const recipients = ordersData.slice(0, recipientStopIds.length).map((stop, index) => ({
    stopId: recipientStopIds[index]!,
    name: stop.name || "Customer",
    phone: stop.phone || config.locationPhone || "",
    // remarks omitted for re-request (apartment numbers embedded in address field)
    ...(index === 0 && config.pickupInstructions?.trim()
      ? { remarks: `Tempo de espera incluído. ${config.pickupInstructions.trim()}` }
      : {}),
  }));

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
    },
  });

  await prismaAny.lalamoveDispatchOrderMap.updateMany({
    where: { shop, dispatchJobId: job.id },
    data: {
      lalamoveOrderId: newOrderResponse.orderId,
      currentStatus: newOrderResponse.status,
    },
  });

  // 10. Re-create fulfillment tracking event
  const orderIds: string[] = (
    await prismaAny.lalamoveDispatchOrderMap.findMany({
      where: { shop, dispatchJobId: job.id },
      select: { shopifyOrderId: true },
    })
  ).map((r: any) => r.shopifyOrderId as string);

  if (orderIds.length > 0) {
    try {
      await applyLalamoveDeliveryState(admin, {
        orderIds,
        state: "requested",
        existingFulfillmentId: null,
      });
    } catch (err) {
      // Non-fatal — fulfillment event failure shouldn't block the re-request
      console.warn("[escalation] Fulfillment event failed after re-request:", err);
    }
  }

  result.success = true;
  console.info("[escalation] Re-requested job", job.id, "→ new order", newOrderResponse.orderId);
  return result;
}
