/**
 * Quote engine (Phase 1.4).
 *
 * Costs each candidate by placing parallel Lalamove quotations — one per
 * route slot — and aggregating into a per-candidate grand total. The
 * decision-arbiter (Phase 1.6) uses these costs alongside RuleResult[] and
 * SpatialReasonerOutput to pick the winning candidate.
 *
 * Mockable: the actual Lalamove call is injected via the `Quoter` interface.
 * Tests provide a deterministic in-memory quoter so they never hit the real
 * API. Production wires this to `createLalamoveQuotation` from
 * `lalamove.server.ts`.
 *
 * Concurrency: all slots across all candidates fan out in parallel. The
 * underlying Lalamove rate limit (300 req/min, ~270 safe ceiling) is several
 * orders of magnitude above realistic per-optimize-run volume (≤6 candidates
 * × ≤7 slots = 42 quotes worst case).
 */

import type {
  Candidate,
  CandidateOrderInput,
  CandidateRouteQuote,
  Coordinate,
  QuoteResult,
  RouteSlot,
} from "./types";

// ── Quoter contract (injection point) ──────────────────────────────────────

export type QuoterInput = {
  pickupCoordinates: Coordinate;
  stops: { orderName: string; coordinates: Coordinate }[];
  market: string;
  serviceType: string;
};

export type QuoterSuccess = {
  ok: true;
  costSubunits: number;
  costTotal: string;
  costCurrency: string;
  serviceType: string;
  distanceMeters?: number;
};

export type QuoterFailure = {
  ok: false;
  error: string;
};

export type QuoterOutput = QuoterSuccess | QuoterFailure;

export type Quoter = (input: QuoterInput) => Promise<QuoterOutput>;

// ── Engine input ───────────────────────────────────────────────────────────

export type QuoteEngineInput = {
  candidates: Candidate[];
  orders: CandidateOrderInput[];
  pickupCoordinates: Coordinate;
  market: string;
  serviceType: string;
  quoter: Quoter;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function ordersByName(orders: CandidateOrderInput[]): Map<string, CandidateOrderInput> {
  const map = new Map<string, CandidateOrderInput>();
  for (const o of orders) map.set(o.name, o);
  return map;
}

function buildQuoterInput(
  slot: RouteSlot,
  orderMap: Map<string, CandidateOrderInput>,
  pickup: Coordinate,
  market: string,
  serviceType: string,
): QuoterInput | null {
  const stops = slot.orderIds
    .map((name) => {
      const o = orderMap.get(name);
      if (!o) return null;
      return { orderName: o.name, coordinates: o.coordinates };
    })
    .filter((s): s is { orderName: string; coordinates: Coordinate } => s !== null);
  if (stops.length === 0) return null;
  return {
    pickupCoordinates: pickup,
    stops,
    market,
    serviceType,
  };
}

function aggregate(
  candidate: Candidate,
  perSlotResults: ({ slot: number; orderIds: string[] } & QuoterOutput)[],
  currencyHint: string,
): QuoteResult {
  const successes = perSlotResults.filter(
    (r): r is { slot: number; orderIds: string[] } & QuoterSuccess => r.ok,
  );
  const failures = perSlotResults.filter(
    (r): r is { slot: number; orderIds: string[] } & QuoterFailure => !r.ok,
  );

  if (failures.length > 0) {
    return {
      candidateId: candidate.candidateId,
      ok: false,
      error: failures.map((f) => `slot=${f.slot}: ${f.error}`).join("; "),
      failedSlots: failures.map((f) => f.slot),
    };
  }

  const routes: CandidateRouteQuote[] = successes.map((r) => ({
    slot: r.slot,
    orderIds: r.orderIds,
    costSubunits: r.costSubunits,
    costTotal: r.costTotal,
    costCurrency: r.costCurrency,
    serviceType: r.serviceType,
    distanceMeters: r.distanceMeters,
  }));

  const grandTotalSubunits = routes.reduce((s, r) => s + r.costSubunits, 0);
  const distanceAccumulator = routes.reduce<{ ok: boolean; meters: number }>(
    (acc, r) => {
      if (!acc.ok) return acc;
      if (typeof r.distanceMeters !== "number") return { ok: false, meters: 0 };
      return { ok: true, meters: acc.meters + r.distanceMeters };
    },
    { ok: true, meters: 0 },
  );

  const currency = routes[0]?.costCurrency ?? currencyHint;

  return {
    candidateId: candidate.candidateId,
    ok: true,
    routes,
    grandTotalSubunits,
    grandTotalDisplay: (grandTotalSubunits / 100).toFixed(2),
    grandTotalCurrency: currency,
    grandTotalDistanceMeters: distanceAccumulator.ok ? distanceAccumulator.meters : undefined,
  };
}

// ── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Quote every candidate in parallel and return one `QuoteResult` per
 * candidate (in input order).
 *
 * Deferred candidates (empty clustering) get an ok:true result with zero
 * cost — they represent postponement, not dispatch.
 */
export async function quoteCandidates(
  input: QuoteEngineInput,
): Promise<QuoteResult[]> {
  const orderMap = ordersByName(input.orders);
  const currencyHint = "BRL";

  const work = input.candidates.map(async (candidate) => {
    // Deferred / empty: zero cost, no quote needed.
    if (candidate.clustering.length === 0) {
      const result: QuoteResult = {
        candidateId: candidate.candidateId,
        ok: true,
        routes: [],
        grandTotalSubunits: 0,
        grandTotalDisplay: "0.00",
        grandTotalCurrency: currencyHint,
        grandTotalDistanceMeters: 0,
      };
      return result;
    }

    const slotWork = candidate.clustering.map(async (slot) => {
      const qInput = buildQuoterInput(
        slot,
        orderMap,
        input.pickupCoordinates,
        input.market,
        input.serviceType,
      );
      if (!qInput) {
        return {
          slot: slot.slot,
          orderIds: slot.orderIds,
          ok: false as const,
          error: "no_valid_stops",
        };
      }
      try {
        const out = await input.quoter(qInput);
        return { slot: slot.slot, orderIds: slot.orderIds, ...out };
      } catch (err) {
        return {
          slot: slot.slot,
          orderIds: slot.orderIds,
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });
    const slotResults = await Promise.all(slotWork);
    return aggregate(candidate, slotResults, currencyHint);
  });

  return Promise.all(work);
}

// ── Cost-ranked helper (used by arbiter) ───────────────────────────────────

/**
 * Return the candidate ids sorted cheapest → most expensive. Candidates
 * that failed to quote are pushed to the end.
 */
export function rankByCost(results: QuoteResult[]): string[] {
  const indexed = results.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    if (a.r.ok && b.r.ok) return a.r.grandTotalSubunits - b.r.grandTotalSubunits;
    if (a.r.ok) return -1;
    if (b.r.ok) return 1;
    return a.i - b.i;
  });
  return indexed.map((x) => x.r.candidateId);
}
