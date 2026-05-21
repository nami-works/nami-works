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
export type StopOutcome = "DELIVERED" | "FAILED" | "PENDING" | "MISSING" | "UNKNOWN";

export type RouteBucket = "clean" | "mixed" | "held" | "skip" | "needs-review";

/**
 * When bucket = "needs-review", which detection rule fired. The watchdog
 * cron and operator review surfaces translate these into i18n strings.
 *
 *   return-stop-detected            — last stop ≈ pickup OR stops.length > orders.length + 1
 *   cancelled-with-partial-success  — order at CANCELED/REJECTED/EXPIRED + ≥1 DELIVERED POD
 *   unknown-pod-status              — Lalamove returned a POD.status string we don't classify
 *   empty-pod-after-retries         — terminal order with zero POD data, retried for >24h
 */
export type NeedsReviewReason =
  | "return-stop-detected"
  | "cancelled-with-partial-success"
  | "unknown-pod-status"
  | "empty-pod-after-retries";

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
  /** Populated when bucket === "needs-review". */
  needsReviewReason?: NeedsReviewReason;
  /** Stop indexes that triggered the needs-review flag — used by the UI to
   *  highlight the suspect rows in the route-details modal. */
  needsReviewStopIndexes?: number[];
};

export type BucketingContext = {
  /** Top-level Lalamove order status (uppercased). Drives the
   *  cancelled-with-partial-success and empty-pod-after-retries rules. */
  orderLevelStatus?: string | null;
  /** Timestamp of the last bucketing run on this job. Used to age
   *  empty-POD-on-terminal routes into needs-review after 24h. */
  lastBucketingAt?: Date | null;
  /** Injectable clock for tests. Defaults to new Date(). */
  reconcileNow?: Date;
  /** Number of orders the dispatch was created for. Used by the
   *  return-stop-by-count heuristic — if Lalamove returns more delivery
   *  stops than orders dispatched, an extra leg was inserted. The reconciler
   *  passes `orderMaps.length`. */
  expectedDeliveryStops?: number;
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

/** Normalise an address string for equality comparison: strip diacritics,
 *  lowercase, collapse whitespace, drop common separator noise. Conservative
 *  on purpose — false positives here cause innocent routes to flip into
 *  needs-review, which is operationally costly. */
const normalizeAddress = (s: string | undefined | null): string => {
  if (!s) return "";
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[,;|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * Detect a return-to-pickup signature on the route. Two independent signals;
 * either firing flips the route to needs-review.
 *
 *   1. Address match — last stop's normalised address equals the pickup
 *      (stops[0]) address. Lalamove appends a return stop here when the
 *      driver brings undelivered items back. The Ana Castro (Freguesia,
 *      2026-05-15) incident is the canonical case.
 *   2. Stop count anomaly — `deliveryStops.length > expectedDeliveryStops`.
 *      An "extra" stop landed in the route beyond what we dispatched,
 *      suggesting Lalamove inserted a return leg.
 *
 * Returns the indexes of stops we consider suspect, or [] if no signature.
 */
export const detectReturnStopSignature = (
  stops: LalamoveStop[],
  expectedDeliveryStops: number,
): number[] => {
  if (stops.length < 2) return [];
  const pickupAddr = normalizeAddress(stops[0]?.address);
  const lastIndex = stops.length - 1;
  const lastAddr = normalizeAddress(stops[lastIndex]?.address);
  const addressMatch = pickupAddr.length > 0 && pickupAddr === lastAddr;

  const deliveryStopCount = stops.length - 1; // first stop is pickup
  const countAnomaly =
    expectedDeliveryStops > 0 && deliveryStopCount > expectedDeliveryStops;

  if (!addressMatch && !countAnomaly) return [];

  // When address matches, the last stop itself is the return — flag it AND
  // the second-to-last (the actual last delivery attempt). When only the
  // count is anomalous, flag the trailing extras.
  const suspect: number[] = [];
  if (addressMatch) {
    suspect.push(lastIndex);
    if (lastIndex - 1 >= 1) suspect.push(lastIndex - 1);
  }
  if (countAnomaly) {
    const extras = deliveryStopCount - expectedDeliveryStops;
    for (let i = 0; i < extras; i++) {
      const idx = lastIndex - i;
      if (idx >= 1 && !suspect.includes(idx)) suspect.push(idx);
    }
  }
  return suspect.sort((a, b) => a - b);
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
  // Non-empty POD.status that we don't recognise — bucket as UNKNOWN so the
  // route flips to needs-review and an operator validates before fulfillment.
  // This is the canonical edge-case-1-style guardrail: trust per-stop POD only
  // for outcomes we understand.
  if (raw.length > 0) {
    return { outcome: "UNKNOWN", reason: `Unrecognised POD.status=${raw}` };
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

const NON_COMPLETED_TERMINAL = new Set([
  "CANCELED", "CANCELLED",
  "REJECTED",
  "EXPIRED",
]);

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "CANCELED", "CANCELLED",
  "REJECTED",
  "EXPIRED",
  "DELIVERED",
  "FULFILLED",
]);

const EMPTY_POD_RETRY_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Decide how to act on a route given its per-stop summary.
 *
 * Buckets:
 *   - clean         — every delivery stop DELIVERED & matched. Fulfill all.
 *   - mixed         — at least one DELIVERED + at least one FAILED, no PENDING/unmatched.
 *                     Fulfill the DELIVERED stops only; tag FAILED stops for re-delivery.
 *   - held          — at least one PENDING or unmatched delivery stop. No writes.
 *   - skip          — no DELIVERED stops at all (everything FAILED/MISSING). Manual review.
 *   - needs-review  — one of the four detection rules fired. Block auto-fulfill;
 *                     operator resolves via CLI (`mark-stop-delivered` /
 *                     `mark-stop-failed`) then clears review state. The route
 *                     stays in this bucket until human input lands.
 *
 * Detection rules (run BEFORE existing bucket classification, first match wins):
 *
 *   1. Return-stop signature       (edge case 1 — Ana Castro / Freguesia)
 *   2. Cancelled-with-partial      (edge case 2 — driver cancels mid-route)
 *   3. Unknown POD status          (Lalamove returns a string we don't classify)
 *   4. Empty POD after retries     (terminal order with zero POD, retried >24h)
 *
 * Optional `stops` and `context` are not provided by legacy callers; in that
 * case detection rules 1, 2 and 4 cannot fire and the function behaves as
 * before. Rule 3 (unknown POD) is driven by per-stop outcome so it works
 * regardless.
 */
export const bucketRouteForFulfillment = (
  summary: StopSummary[],
  stops?: LalamoveStop[],
  context?: BucketingContext,
): RouteBucketDecision => {
  const deliveryStops = summary.filter((s) => !s.isPickup);
  const matchedOrderIds = deliveryStops
    .map((s) => s.orderId)
    .filter((id): id is string => Boolean(id));
  const orderLevelStatus = (context?.orderLevelStatus ?? "").trim().toUpperCase();

  // ── Rule 1: return-stop signature ────────────────────────────────────
  if (stops && stops.length > 1) {
    // `expectedDeliveryStops` is the count we DISPATCHED. The reconciler
    // passes orderMaps.length. When unknown we skip the count-anomaly check
    // by passing 0 — address match still runs.
    const expected = context?.expectedDeliveryStops ?? 0;
    const suspect = detectReturnStopSignature(stops, expected);
    if (suspect.length > 0) {
      return {
        bucket: "needs-review",
        needsReviewReason: "return-stop-detected",
        needsReviewStopIndexes: suspect,
        ordersToFulfill: [],
        ordersToHold: matchedOrderIds,
        ordersToRedeliver: [],
        unmatchedStopIndexes: deliveryStops
          .filter((s) => !s.orderId)
          .map((s) => s.stopIndex),
      };
    }
  }

  // ── Rule 2: order cancelled at Lalamove with partial delivery ────────
  if (NON_COMPLETED_TERMINAL.has(orderLevelStatus)) {
    const hasDelivered = deliveryStops.some((s) => s.outcome === "DELIVERED");
    if (hasDelivered) {
      const suspectIndexes = deliveryStops
        .filter((s) => s.outcome !== "DELIVERED")
        .map((s) => s.stopIndex);
      return {
        bucket: "needs-review",
        needsReviewReason: "cancelled-with-partial-success",
        needsReviewStopIndexes: suspectIndexes,
        ordersToFulfill: [],
        ordersToHold: matchedOrderIds,
        ordersToRedeliver: [],
        unmatchedStopIndexes: deliveryStops
          .filter((s) => !s.orderId)
          .map((s) => s.stopIndex),
      };
    }
  }

  // ── Rule 3: unknown POD status on any delivery stop ──────────────────
  const unknownStops = deliveryStops.filter((s) => s.outcome === "UNKNOWN");
  if (unknownStops.length > 0) {
    return {
      bucket: "needs-review",
      needsReviewReason: "unknown-pod-status",
      needsReviewStopIndexes: unknownStops.map((s) => s.stopIndex),
      ordersToFulfill: [],
      ordersToHold: matchedOrderIds,
      ordersToRedeliver: [],
      unmatchedStopIndexes: deliveryStops
        .filter((s) => !s.orderId)
        .map((s) => s.stopIndex),
    };
  }

  // ── Existing bucket classification ──────────────────────────────────
  const ordersToFulfill: string[] = [];
  const ordersToRedeliver: string[] = [];
  const unmatchedStopIndexes: number[] = [];

  let pendingCount = 0;
  let unmatchedCount = 0;
  let deliveredCount = 0;
  let failedCount = 0;
  let missingCount = 0;

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
    } else if (stop.outcome === "MISSING") {
      missingCount += 1;
      pendingCount += 1;
    } else {
      // UNKNOWN is handled above by Rule 3; the catch-all keeps types tight.
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

  // ── Rule 4: empty POD after retries (terminal + all-MISSING + aged) ──
  const allMissing =
    deliveryStops.length > 0 &&
    missingCount === deliveryStops.length &&
    deliveredCount === 0 &&
    failedCount === 0;
  if (allMissing && TERMINAL_STATUSES.has(orderLevelStatus)) {
    const now = context?.reconcileNow ?? new Date();
    const last = context?.lastBucketingAt;
    if (last && now.getTime() - last.getTime() >= EMPTY_POD_RETRY_AGE_MS) {
      return {
        bucket: "needs-review",
        needsReviewReason: "empty-pod-after-retries",
        needsReviewStopIndexes: deliveryStops.map((s) => s.stopIndex),
        ordersToFulfill: [],
        ordersToHold: matchedOrderIds,
        ordersToRedeliver: [],
        unmatchedStopIndexes,
      };
    }
    // Otherwise fall through to held — give the webhook / next poll a chance.
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
