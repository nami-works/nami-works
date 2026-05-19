/**
 * Candidate generator (Phase 1.2).
 *
 * Produces K=1..6 candidate clusterings of an unassigned-orders set, drawn
 * from the variant playbook captured in eval/seed.json. The output feeds the
 * quote-engine (Phase 1.4) and decision-arbiter (Phase 1.6) — this stage does
 * not call Lalamove and does not pick a winner.
 *
 * Variants:
 *
 *   - optimizer-base               (always emitted)
 *   - split-outliers               (when an order is > metro outlier threshold)
 *   - absorb-low-spread            (when optimizer-base has a 2-order route ≥ minSpread)
 *   - corridor-from-pickup-swap    (when geofence corridor pairs match cluster layout)
 *   - rule-fallback                (when optimizer-base has a route > 7-cap)
 *   - deferred                     (when input is a single solo order at a sparse location with promise margin)
 *
 * All variants are pure functions of the input — no I/O, no network. Tests
 * cover each variant in isolation + integration against eval/seed.json
 * scenarios. The arbiter picks the actual winner.
 */

import {
  centroidOf,
  haversineMeters,
  kMeansAssign,
  maxPairwiseSpreadMeters,
  median,
  nearestCentroid,
} from "./geometry";
import type {
  Candidate,
  CandidateOrderInput,
  Coordinate,
  GeofenceRegistry,
  MarketKey,
  OutlierThreshold,
  RouteSlot,
} from "./types";

// ── Constants ──────────────────────────────────────────────────────────────

/** Hard cap: Lalamove + driver-carry constraint. See feedback_max_orders_per_route. */
const HARD_SEVEN_CAP = 7;

/** Target average orders per route when no other heuristic fires. */
const DEFAULT_ORDERS_PER_ROUTE = 4;

// ── Input / helpers ────────────────────────────────────────────────────────

export type CandidateGeneratorInput = {
  orders: CandidateOrderInput[];
  pickupCoordinates: Coordinate;
  /** Shopify Location GID OR a legacy numeric id keyed in the sparse-volume table. */
  locationId: string;
  /** Tenant key matching geofence registry (e.g. "ge-beauty"). */
  tenantKey: string;
  market: MarketKey;
  geofenceRegistry: GeofenceRegistry;
};

function pickOutlierThreshold(
  registry: GeofenceRegistry,
  market: MarketKey,
): OutlierThreshold {
  return registry.outlierThresholds.byMetro[market] ?? registry.outlierThresholds.default;
}

function buildSlots(clusters: CandidateOrderInput[][]): RouteSlot[] {
  return clusters
    .filter((c) => c.length > 0)
    .map((cluster, idx) => ({
      slot: idx,
      orderIds: cluster.map((o) => o.name),
    }));
}

function flattenSlots(slots: RouteSlot[]): string[] {
  return slots.flatMap((s) => s.orderIds);
}

function ordersByName(orders: CandidateOrderInput[]): Map<string, CandidateOrderInput> {
  const map = new Map<string, CandidateOrderInput>();
  for (const o of orders) map.set(o.name, o);
  return map;
}

// ── Variant 1: optimizer-base ──────────────────────────────────────────────

/**
 * Naive baseline clustering: pick K from a simple heuristic (~ceil(N / 4)),
 * cap at 1 cluster per ~4 orders, then k-means assign. Not cost-optimal — the
 * arbiter picks among variants based on cost + rules + LLM scores.
 */
function generateOptimizerBase(
  orders: CandidateOrderInput[],
  pickup: Coordinate,
): Candidate {
  if (orders.length === 0) {
    return {
      candidateId: "optimizer-base",
      candidateType: "optimizer-base",
      clustering: [],
      generationNote: "No unassigned orders.",
    };
  }

  const k = Math.max(1, Math.ceil(orders.length / DEFAULT_ORDERS_PER_ROUTE));
  const clusters = kMeansAssign(orders, k, pickup);
  return {
    candidateId: "optimizer-base",
    candidateType: "optimizer-base",
    clustering: buildSlots(clusters),
    generationNote: `naive k-means clustering with k=${k}`,
  };
}

// ── Variant 2: split-outliers ──────────────────────────────────────────────

/**
 * Identify outliers using per-metro thresholds (default: 2× median distance
 * from cluster centroid AND > 10 km absolute). Emit a variant where each
 * outlier sits in its own route slot.
 *
 * Returns null when no orders qualify as outliers — caller drops the variant.
 */
function generateSplitOutliers(
  base: Candidate,
  orders: CandidateOrderInput[],
  threshold: OutlierThreshold,
): Candidate | null {
  if (base.clustering.length === 0) return null;
  const lookup = ordersByName(orders);

  // Compute per-cluster centroid distances; track outliers globally.
  const outlierNames = new Set<string>();
  for (const slot of base.clustering) {
    const slotOrders = slot.orderIds
      .map((name) => lookup.get(name))
      .filter((o): o is CandidateOrderInput => o !== undefined);
    if (slotOrders.length < 2) continue;
    const c = centroidOf(slotOrders.map((o) => o.coordinates));
    if (!c) continue;
    const dists = slotOrders.map((o) => haversineMeters(o.coordinates, c));
    const med = median(dists);
    for (let i = 0; i < slotOrders.length; i += 1) {
      const d = dists[i]!;
      const km = d / 1000;
      if (
        d >= med * threshold.multiplierOverMedianCentroidDistance &&
        km >= threshold.minimumAbsoluteDistanceKm
      ) {
        outlierNames.add(slotOrders[i]!.name);
      }
    }
  }

  // Also catch hint-tagged outliers (input flagged them upstream).
  for (const o of orders) {
    if (o.isOutlier) outlierNames.add(o.name);
  }

  if (outlierNames.size === 0) return null;

  // Build new clustering: outliers split out, remaining orders re-clustered.
  const nonOutliers = orders.filter((o) => !outlierNames.has(o.name));
  const k = Math.max(1, Math.ceil(nonOutliers.length / DEFAULT_ORDERS_PER_ROUTE));
  // pickup approximation: use the existing base centroid for re-cluster
  // seeding stability (avoids requiring a pickup arg here).
  const baseCentroid = centroidOf(nonOutliers.map((o) => o.coordinates)) ?? {
    latitude: 0,
    longitude: 0,
  };
  const nonOutlierClusters = kMeansAssign(nonOutliers, k, baseCentroid);

  const slots: RouteSlot[] = [];
  let slotCounter = 0;
  for (const cluster of nonOutlierClusters) {
    if (cluster.length === 0) continue;
    slots.push({ slot: slotCounter, orderIds: cluster.map((o) => o.name) });
    slotCounter += 1;
  }
  for (const name of outlierNames) {
    slots.push({ slot: slotCounter, orderIds: [name] });
    slotCounter += 1;
  }

  return {
    candidateId: "split-outliers",
    candidateType: "split-outliers",
    clustering: slots,
    generationNote: `${outlierNames.size} outlier(s) split into solo route(s)`,
  };
}

// ── Variant 3: absorb-low-spread ───────────────────────────────────────────

/**
 * Find 2-order routes with ≥minSpreadKm haversine spread (low-spread = high
 * internal distance). For each stop in such a route, try absorbing it into
 * the nearest-centroid sibling route. Emit a variant with each absorption
 * applied where it tightens spread.
 *
 * Returns null when no low-spread routes exist.
 */
function generateAbsorbLowSpread(
  base: Candidate,
  orders: CandidateOrderInput[],
  minSpreadKm: number,
  maxOrdersPerRoute: number,
): Candidate | null {
  if (base.clustering.length < 2) return null;
  const lookup = ordersByName(orders);

  // Identify low-spread candidates.
  const lowSpreadSlots: number[] = [];
  for (let i = 0; i < base.clustering.length; i += 1) {
    const slot = base.clustering[i]!;
    if (slot.orderIds.length > maxOrdersPerRoute) continue;
    const slotOrders = slot.orderIds
      .map((name) => lookup.get(name))
      .filter((o): o is CandidateOrderInput => o !== undefined);
    if (slotOrders.length < 2) continue;
    const spreadM = maxPairwiseSpreadMeters(slotOrders.map((o) => o.coordinates));
    if (spreadM >= minSpreadKm * 1000) {
      lowSpreadSlots.push(i);
    }
  }

  if (lowSpreadSlots.length === 0) return null;

  // Build a mutable working clustering keyed by slot index.
  const working: CandidateOrderInput[][] = base.clustering.map((s) =>
    s.orderIds
      .map((name) => lookup.get(name))
      .filter((o): o is CandidateOrderInput => o !== undefined),
  );

  // Other-centroid lookup snapshot (cluster centroids excluding the low-spread one).
  for (const lowIdx of lowSpreadSlots) {
    const lowOrders = [...working[lowIdx]!];
    for (const order of lowOrders) {
      const otherCentroids: { idx: number; centroid: Coordinate }[] = [];
      for (let j = 0; j < working.length; j += 1) {
        if (j === lowIdx) continue;
        const c = centroidOf(working[j]!.map((o) => o.coordinates));
        if (c) otherCentroids.push({ idx: j, centroid: c });
      }
      if (otherCentroids.length === 0) continue;
      const best = nearestCentroid(
        order.coordinates,
        otherCentroids.map((x) => x.centroid),
      );
      if (best.index < 0) continue;
      const targetIdx = otherCentroids[best.index]!.idx;
      // Only absorb if the target cluster has room.
      if (working[targetIdx]!.length >= HARD_SEVEN_CAP) continue;
      working[lowIdx] = working[lowIdx]!.filter((o) => o.name !== order.name);
      working[targetIdx]!.push(order);
    }
  }

  // If absorption emptied any cluster, drop it.
  const slots = buildSlots(working);

  // Only return when the shape actually changed.
  const baseFlat = flattenSlots(base.clustering).join("|");
  const variantFlat = flattenSlots(slots).join("|");
  // Comparing flat order list isn't enough — clustering may have the same set
  // of orders in different groupings. Compare slot signatures instead.
  const baseSig = base.clustering
    .map((s) => [...s.orderIds].sort().join(","))
    .sort()
    .join("|");
  const variantSig = slots
    .map((s) => [...s.orderIds].sort().join(","))
    .sort()
    .join("|");
  if (baseSig === variantSig) return null;
  if (baseFlat === variantFlat && baseSig === variantSig) return null;

  return {
    candidateId: "absorb-low-spread",
    candidateType: "absorb-low-spread",
    clustering: slots,
    generationNote: `Absorbed stops from ${lowSpreadSlots.length} low-spread route(s) (≥${minSpreadKm}km)`,
  };
}

// ── Variant 4: corridor-from-pickup-swap ───────────────────────────────────

/**
 * For each corridor pair registered in geofences (pickup-neighborhood →
 * distant-cluster-neighborhood + intermediates), find orders in
 * intermediate neighborhoods and move them to the distant-cluster's route.
 * The reasoning: an order on the line between pickup and a distant cluster
 * is naturally a drive-by stop on the way there.
 *
 * Returns null when no corridor matches the input layout.
 */
function generateCorridorSwap(
  base: Candidate,
  orders: CandidateOrderInput[],
  registry: GeofenceRegistry,
): Candidate | null {
  if (base.clustering.length < 2) return null;
  const lookup = ordersByName(orders);

  const candidates = registry.corridorPairs.pairs;
  if (candidates.length === 0) return null;

  // Normalize neighborhood comparison (case-insensitive, accent-trimmed).
  const norm = (s: string | undefined): string =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

  const swappedCorridorIds: string[] = [];
  const working: CandidateOrderInput[][] = base.clustering.map((s) =>
    s.orderIds
      .map((name) => lookup.get(name))
      .filter((o): o is CandidateOrderInput => o !== undefined),
  );

  for (const corridor of candidates) {
    const distantNeighborhood = norm(corridor.distantClusterNeighborhood);
    const intermediates = corridor.intermediateNeighborhoods.map(norm);

    // Find the slot containing the distant cluster (any order in
    // distant-neighborhood). Pick the first match deterministically.
    let distantSlotIdx = -1;
    for (let i = 0; i < working.length; i += 1) {
      if (working[i]!.some((o) => norm(o.neighborhood) === distantNeighborhood)) {
        distantSlotIdx = i;
        break;
      }
    }
    if (distantSlotIdx < 0) continue;

    // Find intermediate orders sitting in OTHER slots; move them to the
    // distant slot.
    let didSwap = false;
    for (let i = 0; i < working.length; i += 1) {
      if (i === distantSlotIdx) continue;
      const toMove = working[i]!.filter((o) =>
        intermediates.includes(norm(o.neighborhood)),
      );
      if (toMove.length === 0) continue;
      // Respect 7-cap on the distant cluster.
      if (working[distantSlotIdx]!.length + toMove.length > HARD_SEVEN_CAP) continue;
      working[i] = working[i]!.filter((o) => !toMove.includes(o));
      working[distantSlotIdx]!.push(...toMove);
      didSwap = true;
    }
    if (didSwap) swappedCorridorIds.push(corridor.id);
  }

  if (swappedCorridorIds.length === 0) return null;

  const slots = buildSlots(working);
  return {
    candidateId: "corridor-from-pickup-swap",
    candidateType: "corridor-from-pickup-swap",
    clustering: slots,
    generationNote: `Applied corridor swap(s): ${swappedCorridorIds.join(", ")}`,
  };
}

// ── Variant 5: rule-fallback (hard 7-cap split) ────────────────────────────

/**
 * If any cluster in optimizer-base exceeds the 7-order hard cap, emit a
 * fallback variant that splits each oversized cluster geographically.
 *
 * The 7-cap is a HARD rule (driver carry-capacity + identification time)
 * that cannot be overridden — see feedback_max_orders_per_route. This
 * variant exists so the arbiter has a compliant choice even when the
 * optimizer's heuristic happens to produce an oversized cluster.
 *
 * Returns null when no cluster exceeds the cap.
 */
function generateRuleFallback(
  base: Candidate,
  orders: CandidateOrderInput[],
): Candidate | null {
  const lookup = ordersByName(orders);
  const hasViolation = base.clustering.some(
    (s) => s.orderIds.length > HARD_SEVEN_CAP,
  );
  if (!hasViolation) return null;

  const newClusters: CandidateOrderInput[][] = [];
  for (const slot of base.clustering) {
    const slotOrders = slot.orderIds
      .map((n) => lookup.get(n))
      .filter((o): o is CandidateOrderInput => o !== undefined);
    if (slotOrders.length <= HARD_SEVEN_CAP) {
      newClusters.push(slotOrders);
      continue;
    }
    // Split via a fresh k-means on the slot's orders.
    const subK = Math.ceil(slotOrders.length / HARD_SEVEN_CAP);
    const seedCentroid =
      centroidOf(slotOrders.map((o) => o.coordinates)) ?? slotOrders[0]!.coordinates;
    const subs = kMeansAssign(slotOrders, subK, seedCentroid);
    for (const sub of subs) if (sub.length > 0) newClusters.push(sub);
  }

  return {
    candidateId: "rule-fallback",
    candidateType: "rule-fallback",
    clustering: buildSlots(newClusters),
    generationNote: `Split oversized cluster(s) to respect 7-cap hard rule`,
  };
}

// ── Variant 7: exclude-outliers-route-rest ────────────────────────────────

/**
 * Pickup-distance threshold above which an order is considered an "out-of-
 * area" outlier — too far from the pickup for Lalamove standard multi-stop.
 * Anything farther will either trigger a hard rule violation (geographic
 * barrier / intercity flag) or get refused by the Lalamove quote engine,
 * which collectively forces the arbiter into `exclude-from-optimize` and
 * refuses to route ANY of the batch.
 *
 * Empirically picked from incidents:
 *  - Serra Negra (~100 km from SP pickup, 2026-05-19)
 *  - Tietê River crossings with peak-hour penalties (2026-05-15)
 * Both produced `exclude-from-optimize` + confidence=0 + total batch refusal.
 *
 * Set conservatively. The Lalamove BR_SAO operating radius for standard
 * `LALAGO` service is typically 30-40 km; 50 km is a comfortable cushion
 * beyond which we should not attempt a multi-stop dispatch.
 *
 * Could later be moved into GeofenceRegistry per-metro if other markets
 * need different thresholds.
 */
const EXCLUDE_OUTLIER_PICKUP_DISTANCE_KM = 50;

/**
 * Emit a partial-batch candidate that excludes orders sitting too far from
 * the pickup (per the threshold above), and routes only the in-range
 * remainder. The excluded orders are not assigned to any slot — they stay
 * unassigned for operator review.
 *
 * Returns null when:
 *   - no orders exceed the threshold (no excludes needed; existing variants
 *     suffice), or
 *   - ALL orders exceed the threshold (nothing to route — emitting an empty
 *     candidate is a job for the deferred variant, not this one).
 *
 * Critical design constraint: this variant is INTENDED to be a fallback.
 * The arbiter must not prefer it over a complete candidate that's eligible.
 * See decision-arbiter precedence (winning-candidate selection).
 */
function generateExcludeOutliersRouteRest(
  orders: CandidateOrderInput[],
  pickup: Coordinate,
): Candidate | null {
  if (orders.length === 0) return null;

  const thresholdMeters = EXCLUDE_OUTLIER_PICKUP_DISTANCE_KM * 1000;
  const excluded: CandidateOrderInput[] = [];
  const kept: CandidateOrderInput[] = [];
  for (const order of orders) {
    const distM = haversineMeters(order.coordinates, pickup);
    if (distM > thresholdMeters) {
      excluded.push(order);
    } else {
      kept.push(order);
    }
  }

  // No outliers → no need for this variant.
  if (excluded.length === 0) return null;
  // Every order is an outlier → nothing to route. Don't emit; operator
  // handles the whole batch manually.
  if (kept.length === 0) return null;

  const k = Math.max(1, Math.ceil(kept.length / DEFAULT_ORDERS_PER_ROUTE));
  const clusters = kMeansAssign(kept, k, pickup);
  const slots = buildSlots(clusters);

  const excludedNames = excluded.map((o) => o.name).join(", ");
  return {
    candidateId: "exclude-outliers-route-rest",
    candidateType: "exclude-outliers-route-rest",
    clustering: slots,
    generationNote: `${excluded.length} order(s) excluded (>${EXCLUDE_OUTLIER_PICKUP_DISTANCE_KM}km from pickup): ${excludedNames}. Operator must handle unassigned orders manually.`,
  };
}

// ── Variant 6: deferred (sparse-volume solo postponement) ──────────────────

/**
 * If the input set is a single solo order at a sparse-volume location AND
 * the delivery promise allows postponement, emit a "deferred" candidate
 * with empty clustering. The arbiter interprets this as "postpone to
 * tomorrow's batch."
 *
 * Returns null when:
 *  - more than one order is present, OR
 *  - the location isn't registered as sparse-volume, OR
 *  - the order's promise has expired (no margin left).
 */
function generateDeferred(
  orders: CandidateOrderInput[],
  registry: GeofenceRegistry,
  locationId: string,
  tenantKey: string,
): Candidate | null {
  if (orders.length !== 1) return null;
  const order = orders[0]!;

  // Sparse-volume check: extract numeric legacy id from a GID if needed.
  const legacyId = locationId.includes("/")
    ? locationId.split("/").pop()!
    : locationId;
  const tenantTable =
    registry.sparseVolumeLocations.knownSparseLocationsByTenant[tenantKey];
  const sparseEntry = tenantTable?.[legacyId];
  if (!sparseEntry) return null;

  // Promise margin check: at least 1 day of margin (today < promiseDays).
  if (typeof order.deliveryPromiseDays === "number") {
    const daysIn = order.daysIntoPromise ?? 1;
    if (daysIn >= order.deliveryPromiseDays) return null;
  }

  return {
    candidateId: "postpone-tomorrow",
    candidateType: "deferred",
    clustering: [],
    generationNote: `Single order at sparse-volume location ${sparseEntry.name}; promise margin allows postponement`,
  };
}

// ── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Produce all applicable candidates for the input set. The output array
 * always contains optimizer-base (even if empty); other variants are
 * appended only when their precondition fires. Order is stable so the
 * arbiter + post-mortem panel can reference candidates by index.
 */
export function generateCandidates(
  input: CandidateGeneratorInput,
): Candidate[] {
  const out: Candidate[] = [];

  const base = generateOptimizerBase(input.orders, input.pickupCoordinates);
  out.push(base);

  if (input.orders.length === 0) return out;

  const threshold = pickOutlierThreshold(input.geofenceRegistry, input.market);

  const splitOutliers = generateSplitOutliers(base, input.orders, threshold);
  if (splitOutliers) out.push(splitOutliers);

  const absorption = generateAbsorbLowSpread(
    base,
    input.orders,
    input.geofenceRegistry.absorptionThresholds.default.minSpreadKm,
    input.geofenceRegistry.absorptionThresholds.default.maxOrdersPerCandidateRoute,
  );
  if (absorption) out.push(absorption);

  const corridorSwap = generateCorridorSwap(base, input.orders, input.geofenceRegistry);
  if (corridorSwap) out.push(corridorSwap);

  const ruleFallback = generateRuleFallback(base, input.orders);
  if (ruleFallback) out.push(ruleFallback);

  const deferred = generateDeferred(
    input.orders,
    input.geofenceRegistry,
    input.locationId,
    input.tenantKey,
  );
  if (deferred) out.push(deferred);

  // Last-resort variant: when one or more orders are too far from the pickup
  // (the "Serra Negra / Tietê River" pattern) AND every complete candidate
  // would therefore fail eligibility, the arbiter picks this one instead of
  // refusing the whole batch via exclude-from-optimize. See the variant's
  // own docblock for the threshold rationale.
  const partial = generateExcludeOutliersRouteRest(
    input.orders,
    input.pickupCoordinates,
  );
  if (partial) out.push(partial);

  return out;
}
