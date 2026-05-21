/**
 * Rule engine (Phase 1.3).
 *
 * Consumes the candidate-generator's output + the geofence registry and
 * emits one `RuleResult` per candidate. Rules cover:
 *
 *   HARD (cannot be overridden):
 *     - 7-cap: no route may carry more than 7 orders.
 *
 *   SOFT (advisory; arbiter weighs against cost):
 *     - Barrier crossings (Guanabara Bay, Tietê river, etc.)
 *     - Outlier-paired-with-central in a multi-stop route
 *     - Absorption-candidate (≤2-order route with ≥minSpread spread)
 *
 *   INFO (rule passed; surfaced for trend tracking):
 *     - Corridor-from-pickup matches
 *     - Sparse-volume location detection
 *
 * Pure function — no I/O. Geofence registry is passed in, not loaded
 * from disk.
 *
 * The arbiter (Phase 1.6) combines RuleResult[] with QuoteResult[] and
 * SpatialReasonerOutput to pick the winning candidate.
 */

import { centroidOf, haversineMeters, maxPairwiseSpreadMeters, median } from "./geometry";
import type {
  Candidate,
  CandidateOrderInput,
  Coordinate,
  GeofenceBarrier,
  GeofenceRegistry,
  MarketKey,
  RuleResult,
  RuleViolation,
  SeverityVerdict,
} from "./types";

// ── Constants ──────────────────────────────────────────────────────────────

const HARD_SEVEN_CAP = 7;

// ── Input ──────────────────────────────────────────────────────────────────

export type RuleEngineInput = {
  candidates: Candidate[];
  orders: CandidateOrderInput[];
  pickupCoordinates: Coordinate;
  market: MarketKey;
  /** Shopify Location GID or legacy id; used for sparse-volume lookup. */
  locationId: string;
  tenantKey: string;
  geofenceRegistry: GeofenceRegistry;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function ordersByName(orders: CandidateOrderInput[]): Map<string, CandidateOrderInput> {
  const map = new Map<string, CandidateOrderInput>();
  for (const o of orders) map.set(o.name, o);
  return map;
}

const normalize = (s: string | undefined): string =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function coordInsideBoundingBox(
  c: Coordinate,
  box: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): boolean {
  return (
    c.latitude >= box.minLat &&
    c.latitude <= box.maxLat &&
    c.longitude >= box.minLng &&
    c.longitude <= box.maxLng
  );
}

/**
 * Returns the side key for an order against a barrier, or null when the
 * order can't be classified (no matching neighborhood + no bounding box).
 */
function sideOf(order: CandidateOrderInput, barrier: GeofenceBarrier): string | null {
  if (!barrier.sides) return null;
  const orderNeighborhood = normalize(order.neighborhood);

  // Neighborhood match has priority over bounding-box (more precise).
  if (orderNeighborhood) {
    for (const [sideKey, side] of Object.entries(barrier.sides)) {
      const list = side.neighborhoods?.map(normalize) ?? [];
      if (list.includes(orderNeighborhood)) return sideKey;
    }
  }

  for (const [sideKey, side] of Object.entries(barrier.sides)) {
    const box = side.boundingBox;
    if (box && coordInsideBoundingBox(order.coordinates, box)) return sideKey;
  }

  return null;
}

// ── Barrier crossings (soft) ───────────────────────────────────────────────

function evaluateBarrierCrossings(
  candidate: Candidate,
  orderMap: Map<string, CandidateOrderInput>,
  registry: GeofenceRegistry,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  // Skip deferred (no routes to evaluate).
  if (candidate.clustering.length === 0) return violations;

  for (const barrier of registry.barriers) {
    if (barrier.severity === "info-only") continue;
    if (barrier.severity === "outlier-pattern") continue; // handled by outlier rule
    if (!barrier.sides || Object.keys(barrier.sides).length < 2) continue;

    for (const slot of candidate.clustering) {
      const sides = new Set<string>();
      for (const name of slot.orderIds) {
        const o = orderMap.get(name);
        if (!o) continue;
        const s = sideOf(o, barrier);
        if (s) sides.add(s);
      }
      if (sides.size >= 2) {
        violations.push({
          ruleId: barrier.id,
          severity: barrier.severity === "hard" ? "hard" : "soft",
          explanation: `Route slot ${slot.slot} crosses ${barrier.name} (sides: ${[...sides].join(", ")}).`,
          citation: barrier.citation,
          addsMinutesEstimate: barrier.addsMinutesTypical,
        });
        // One violation per barrier per candidate is enough — the arbiter
        // doesn't need duplicates from multi-slot routes.
        break;
      }
    }
  }

  return violations;
}

// ── Outlier check (soft) ───────────────────────────────────────────────────

function evaluateOutliers(
  candidate: Candidate,
  orderMap: Map<string, CandidateOrderInput>,
  market: MarketKey,
  registry: GeofenceRegistry,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  if (candidate.clustering.length === 0) return violations;
  const threshold =
    registry.outlierThresholds.byMetro[market] ?? registry.outlierThresholds.default;

  for (const slot of candidate.clustering) {
    if (slot.orderIds.length < 2) continue; // solo routes can't have intra-route outliers
    const slotOrders = slot.orderIds
      .map((n) => orderMap.get(n))
      .filter((o): o is CandidateOrderInput => o !== undefined);
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
        violations.push({
          ruleId: "outlier-detected",
          severity: "soft",
          explanation: `Order ${slotOrders[i]!.name} sits ${km.toFixed(1)}km from cluster centroid in slot ${slot.slot} (>${threshold.multiplierOverMedianCentroidDistance}× median + ≥${threshold.minimumAbsoluteDistanceKm}km).`,
          citation: "playbook §6.3 outlier-detection",
        });
      }
    }
  }

  return violations;
}

// ── Absorption candidate (soft, informational) ─────────────────────────────

function evaluateAbsorptionCandidates(
  candidate: Candidate,
  orderMap: Map<string, CandidateOrderInput>,
  registry: GeofenceRegistry,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  if (candidate.clustering.length === 0) return violations;
  const thresholds = registry.absorptionThresholds.default;

  for (const slot of candidate.clustering) {
    if (slot.orderIds.length > thresholds.maxOrdersPerCandidateRoute) continue;
    if (slot.orderIds.length < 2) continue;
    const slotOrders = slot.orderIds
      .map((n) => orderMap.get(n))
      .filter((o): o is CandidateOrderInput => o !== undefined);
    const spreadM = maxPairwiseSpreadMeters(slotOrders.map((o) => o.coordinates));
    if (spreadM >= thresholds.minSpreadKm * 1000) {
      violations.push({
        ruleId: "absorption-test-candidate",
        severity: "soft",
        explanation: `Slot ${slot.slot} is a ${slot.orderIds.length}-order route with ${(spreadM / 1000).toFixed(1)}km spread (≥${thresholds.minSpreadKm}km). Absorption test should fire.`,
        citation: "playbook §6.3 absorption-test",
      });
    }
  }

  return violations;
}

// ── Hard cap (hard) ────────────────────────────────────────────────────────

function evaluateHardSevenCap(candidate: Candidate): RuleViolation[] {
  const violations: RuleViolation[] = [];
  for (const slot of candidate.clustering) {
    if (slot.orderIds.length > HARD_SEVEN_CAP) {
      violations.push({
        ruleId: "hard-7-cap",
        severity: "hard",
        explanation: `Slot ${slot.slot} carries ${slot.orderIds.length} orders, exceeding the 7-order driver-carry hard cap.`,
        citation: "playbook §6.1",
      });
    }
  }
  return violations;
}

// ── Corridor matches (info — counts as rule passed) ────────────────────────

function evaluateCorridorMatches(
  candidate: Candidate,
  orderMap: Map<string, CandidateOrderInput>,
  registry: GeofenceRegistry,
): string[] {
  const matched: string[] = [];
  if (candidate.clustering.length === 0) return matched;

  for (const corridor of registry.corridorPairs.pairs) {
    const distantNeighborhood = normalize(corridor.distantClusterNeighborhood);
    const intermediates = corridor.intermediateNeighborhoods.map(normalize);

    for (const slot of candidate.clustering) {
      const neighborhoods = slot.orderIds
        .map((n) => orderMap.get(n)?.neighborhood)
        .map(normalize);
      const hasDistant = neighborhoods.includes(distantNeighborhood);
      const hasIntermediate = neighborhoods.some((n) => intermediates.includes(n));
      if (hasDistant && hasIntermediate) {
        matched.push(corridor.id);
        break;
      }
    }
  }

  return matched;
}

// ── Sparse volume (info) ───────────────────────────────────────────────────

function evaluateSparseVolume(
  candidate: Candidate,
  registry: GeofenceRegistry,
  locationId: string,
  tenantKey: string,
): string[] {
  if (candidate.clustering.length === 0) return [];
  const legacyId = locationId.includes("/") ? locationId.split("/").pop()! : locationId;
  const tenantTable =
    registry.sparseVolumeLocations.knownSparseLocationsByTenant[tenantKey];
  if (!tenantTable?.[legacyId]) return [];

  // A solo route at a sparse location is a postponement candidate.
  const hasSolo = candidate.clustering.some((s) => s.orderIds.length === 1);
  if (hasSolo) return ["sparse-volume-solo"];
  return [];
}

// ── Severity verdict ──────────────────────────────────────────────────────

function computeSeverityVerdict(violations: RuleViolation[]): SeverityVerdict {
  if (violations.some((v) => v.severity === "hard")) return "hard-violation";
  if (violations.some((v) => v.severity === "soft")) return "soft-violation";
  return "clear";
}

// ── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Evaluate every candidate against every applicable rule.
 *
 * Returns one `RuleResult` per candidate, in the same order as the input.
 * Each result includes the violations (HARD or SOFT) plus `rulesPassed`
 * (corridor matches, sparse-volume detection) for per-rule coverage
 * reporting against the eval set.
 */
export function evaluateCandidates(input: RuleEngineInput): RuleResult[] {
  const orderMap = ordersByName(input.orders);
  const results: RuleResult[] = [];

  for (const candidate of input.candidates) {
    const violations: RuleViolation[] = [
      ...evaluateHardSevenCap(candidate),
      ...evaluateBarrierCrossings(candidate, orderMap, input.geofenceRegistry),
      ...evaluateOutliers(
        candidate,
        orderMap,
        input.market,
        input.geofenceRegistry,
      ),
      ...evaluateAbsorptionCandidates(candidate, orderMap, input.geofenceRegistry),
    ];

    const rulesPassed = [
      ...evaluateCorridorMatches(candidate, orderMap, input.geofenceRegistry),
      ...evaluateSparseVolume(
        candidate,
        input.geofenceRegistry,
        input.locationId,
        input.tenantKey,
      ),
    ];

    results.push({
      candidateId: candidate.candidateId,
      ruleViolations: violations,
      rulesPassed,
      severityVerdict: computeSeverityVerdict(violations),
    });
  }

  return results;
}
