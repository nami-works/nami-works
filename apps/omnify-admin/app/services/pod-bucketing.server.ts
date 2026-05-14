/**
 * POD bucketing — classify per-stop delivery outcomes and decide how to act on them.
 *
 * Pure logic: no DB, no Shopify, no Lalamove API. Caller passes in:
 *   - Lalamove `stops[]` (response from getLalamoveOrderDetails)
 *   - `ordersData` snapshot (LalamoveDispatchJob.ordersData)
 *   - order maps (LalamoveDispatchOrderMap rows for this dispatch)
 *
 * Returns a per-stop summary and a route-level bucket that drives downstream
 * fulfillment behavior. See blueprint §13.8 for the operational contract.
 */
export type StopOutcome = "DELIVERED" | "FAILED" | "PENDING" | "MISSING";

export type RouteBucket = "clean" | "mixed" | "held" | "skip";

export type LalamoveStop = {
  stopId?: string;
  address?: string;
  name?: string;
  phone?: string;
  POD?: { status?: string; deliveredAt?: string; image?: string };
};

export type DispatchOrderSnapshot = {
  shopifyOrderId: string;
  lat: number;
  lng: number;
  address: string;
  name: string;
  phone: string;
};

export type DispatchOrderMapRow = {
  shopifyOrderId: string;
  currentStatus?: string | null;
  failureReason?: string | null;
};

export type StopSummary = {
  stopIndex: number;
  isPickup: boolean;
  orderId: string | null;
  orderName: string | null;
  outcome: StopOutcome;
  failureReason: string | null;
  matchSignal: "phone" | "name" | "coords" | "first-stop-pickup" | "none";
};

export type RouteBucketDecision = {
  bucket: RouteBucket;
  ordersToFulfill: string[];
  ordersToHold: string[];
  ordersToRedeliver: string[];
  unmatchedStopIndexes: number[];
};

const FIRST_STOP_IS_PICKUP = true;
const COORD_MATCH_RADIUS_METERS = 50;

const haversineMeters = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const stripDiacritics = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "");

const normalizeName = (s: string | undefined | null): string => {
  if (!s) return "";
  return stripDiacritics(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
};

/** Strip everything that isn't a digit. Caller should have already passed
 *  market-aware E.164 normalization through the Lalamove side. */
const normalizePhone = (s: string | undefined | null): string => {
  if (!s) return "";
  return s.replace(/\D+/g, "");
};

const lastNameTokens = (name: string): string[] => {
  const tokens = normalizeName(name).split(/\s+/).filter(Boolean);
  return tokens.length > 1 ? tokens.slice(-2) : tokens;
};

const namesLooselyMatch = (a: string, b: string): boolean => {
  const aTokens = lastNameTokens(a);
  const bTokens = lastNameTokens(b);
  if (aTokens.length === 0 || bTokens.length === 0) return false;
  return aTokens.some((tok) => bTokens.includes(tok));
};

const coordsForStop = (
  stop: LalamoveStop,
): { lat: number; lng: number } | null => {
  // Lalamove's order-details response does NOT consistently expose stop
  // coordinates. We rely on the `ordersData` snapshot for coordinate matching.
  // This helper is a place-holder for the day Lalamove adds coords on the
  // response — until then it returns null and the cascade falls through.
  void stop;
  return null;
};

const classifyPodStatus = (
  stop: LalamoveStop,
  fallback: DispatchOrderMapRow | undefined,
): { outcome: StopOutcome; reason: string | null } => {
  const raw = (stop.POD?.status ?? "").trim().toUpperCase();
  // Lalamove POD outcomes that mean "the recipient got it":
  //   DELIVERED  — generic dropoff
  //   COMPLETED  — terminal state when no specific POD captured
  //   SUCCESS    — alias seen on some routes
  //   SIGNED     — signature captured at the doorstep (Lalamove BR emits this
  //                when the driver collects a signature). Missing from this
  //                set caused the 2026-05-13 Recife dispatch to bucket as
  //                "held" despite being fully delivered.
  if (
    raw === "DELIVERED" ||
    raw === "COMPLETED" ||
    raw === "SUCCESS" ||
    raw === "SIGNED"
  ) {
    return { outcome: "DELIVERED", reason: null };
  }
  if (raw === "FAILED" || raw === "FAIL" || raw === "REJECTED") {
    return { outcome: "FAILED", reason: stop.POD?.image ? null : "Lalamove POD: failed" };
  }
  if (raw === "PENDING" || raw === "IN_PROGRESS" || raw === "ON_GOING") {
    return { outcome: "PENDING", reason: null };
  }
  // No POD on the stop. Fall back to whatever the order map last recorded
  // (mostly useful when re-running a check-dispatches sweep).
  const fallbackStatus = (fallback?.currentStatus ?? "").trim().toLowerCase();
  if (fallbackStatus === "delivered") return { outcome: "DELIVERED", reason: null };
  if (fallbackStatus === "failed") {
    return { outcome: "FAILED", reason: fallback?.failureReason ?? null };
  }
  if (fallbackStatus === "pending" || fallbackStatus === "in_progress") {
    return { outcome: "PENDING", reason: null };
  }
  return { outcome: "MISSING", reason: null };
};

/**
 * Match each Lalamove stop to a Shopify order via the operational cascade:
 *   1. exact phone (digits-only)            — strongest signal
 *   2. last-name fuzzy match                — secondary
 *   3. coords within 50m (when available)   — tertiary
 *   4. first-stop = pickup heuristic        — first delivery stop
 */
export const summarizeRoutePOD = (
  stops: LalamoveStop[],
  ordersData: DispatchOrderSnapshot[],
  orderMaps: DispatchOrderMapRow[],
): StopSummary[] => {
  const orderMapByOrderId = new Map<string, DispatchOrderMapRow>();
  for (const row of orderMaps) orderMapByOrderId.set(row.shopifyOrderId, row);

  const claimedOrderIds = new Set<string>();
  const summary: StopSummary[] = [];

  stops.forEach((stop, index) => {
    const isPickup = FIRST_STOP_IS_PICKUP && index === 0;
    if (isPickup) {
      summary.push({
        stopIndex: index,
        isPickup: true,
        orderId: null,
        orderName: null,
        outcome: "DELIVERED",
        failureReason: null,
        matchSignal: "first-stop-pickup",
      });
      return;
    }

    const stopPhone = normalizePhone(stop.phone);
    const stopName = stop.name ?? "";
    const stopCoords = coordsForStop(stop);

    let matched: { order: DispatchOrderSnapshot; signal: StopSummary["matchSignal"] } | null = null;

    if (stopPhone.length >= 8) {
      const phoneMatch = ordersData.find(
        (o) =>
          !claimedOrderIds.has(o.shopifyOrderId) &&
          normalizePhone(o.phone) === stopPhone,
      );
      if (phoneMatch) matched = { order: phoneMatch, signal: "phone" };
    }

    if (!matched && stopName) {
      const nameMatch = ordersData.find(
        (o) =>
          !claimedOrderIds.has(o.shopifyOrderId) && namesLooselyMatch(o.name, stopName),
      );
      if (nameMatch) matched = { order: nameMatch, signal: "name" };
    }

    if (!matched && stopCoords) {
      let bestDistance = Infinity;
      let best: DispatchOrderSnapshot | null = null;
      for (const o of ordersData) {
        if (claimedOrderIds.has(o.shopifyOrderId)) continue;
        const d = haversineMeters(stopCoords.lat, stopCoords.lng, o.lat, o.lng);
        if (d < bestDistance) {
          bestDistance = d;
          best = o;
        }
      }
      if (best && bestDistance <= COORD_MATCH_RADIUS_METERS) {
        matched = { order: best, signal: "coords" };
      }
    }

    if (matched) claimedOrderIds.add(matched.order.shopifyOrderId);

    const fallback = matched
      ? orderMapByOrderId.get(matched.order.shopifyOrderId)
      : undefined;
    const classified = classifyPodStatus(stop, fallback);

    summary.push({
      stopIndex: index,
      isPickup: false,
      orderId: matched?.order.shopifyOrderId ?? null,
      orderName: matched?.order.name ?? null,
      outcome: matched ? classified.outcome : "MISSING",
      failureReason: classified.reason,
      matchSignal: matched ? matched.signal : "none",
    });
  });

  return summary;
};

/**
 * Decide how to act on a route given its per-stop summary.
 *
 * Buckets:
 *   - clean  — every delivery stop DELIVERED & matched. Fulfill all.
 *   - mixed  — at least one DELIVERED + at least one FAILED, no PENDING/unmatched.
 *              Fulfill the DELIVERED stops only; tag FAILED stops for re-delivery.
 *   - held   — at least one PENDING or unmatched delivery stop. No writes.
 *   - skip   — no DELIVERED stops at all (everything FAILED/MISSING). Manual review.
 */
export const bucketRouteForFulfillment = (
  summary: StopSummary[],
): RouteBucketDecision => {
  const deliveryStops = summary.filter((s) => !s.isPickup);

  const ordersToFulfill: string[] = [];
  const ordersToRedeliver: string[] = [];
  const unmatchedStopIndexes: number[] = [];

  let pendingCount = 0;
  let unmatchedCount = 0;
  let deliveredCount = 0;
  let failedCount = 0;

  for (const stop of deliveryStops) {
    if (!stop.orderId) {
      unmatchedCount += 1;
      unmatchedStopIndexes.push(stop.stopIndex);
      continue;
    }
    if (stop.outcome === "DELIVERED") {
      deliveredCount += 1;
      ordersToFulfill.push(stop.orderId);
    } else if (stop.outcome === "FAILED") {
      failedCount += 1;
      ordersToRedeliver.push(stop.orderId);
    } else if (stop.outcome === "PENDING") {
      pendingCount += 1;
    } else {
      // MISSING but matched — treat as held (Lalamove stop exists but no POD yet)
      pendingCount += 1;
    }
  }

  if (deliveryStops.length === 0) {
    return {
      bucket: "skip",
      ordersToFulfill: [],
      ordersToHold: [],
      ordersToRedeliver: [],
      unmatchedStopIndexes,
    };
  }

  if (pendingCount > 0 || unmatchedCount > 0) {
    return {
      bucket: "held",
      ordersToFulfill: [],
      ordersToHold: ordersToFulfill, // anything that COULD be fulfilled, but we hold the whole route
      ordersToRedeliver: [],
      unmatchedStopIndexes,
    };
  }

  if (deliveredCount === 0) {
    return {
      bucket: "skip",
      ordersToFulfill: [],
      ordersToHold: [],
      ordersToRedeliver,
      unmatchedStopIndexes,
    };
  }

  if (failedCount > 0) {
    return {
      bucket: "mixed",
      ordersToFulfill,
      ordersToHold: [],
      ordersToRedeliver,
      unmatchedStopIndexes,
    };
  }

  return {
    bucket: "clean",
    ordersToFulfill,
    ordersToHold: [],
    ordersToRedeliver: [],
    unmatchedStopIndexes,
  };
};

export const REDELIVERY_TAG = "ld_redelivery_pending";
