/**
 * Shared types for the route-optimization pipeline (Phase 1).
 *
 * The pipeline has five stages, each producing a typed artifact the next stage
 * consumes:
 *
 *   handleOptimize input
 *        │
 *        ▼
 *   candidate-generator   → Candidate[]
 *        │
 *        ▼
 *   rule-engine           → RuleResult[]   (one per candidate)
 *        │
 *        ▼
 *   quote-engine          → QuoteResult[]  (one per candidate)
 *        │
 *        ▼
 *   spatial-reasoner      → SpatialReasonerOutput  (advisory LLM call)
 *        │
 *        ▼
 *   decision-arbiter      → ArbiterDecision  (the winner + post-mortem flags)
 *
 * The system is fully autonomous at decision time. There is no operator
 * review queue. Soft-rule violations, novel patterns and ambiguity emit a
 * `postMortemFlag` carried on the dispatched decision; operator feedback
 * enters only retroactively via the post-mortem panel (Phase 3).
 *
 * The eval set at `eval/seed.json` is the regression baseline; every Phase 1
 * component is tested by running real cases through it.
 */

import type { Coordinate } from "../google-routes-shared.server";

// ── Input shapes (consumed by candidate-generator + downstream stages) ────

/**
 * Minimum order shape the pipeline reasons about. Coordinates are required;
 * neighborhood + promise fields are optional hints used by specific variants
 * (corridor-swap reads neighborhood; deferred reads delivery-promise fields).
 */
export type CandidateOrderInput = {
  /** Shopify order name (e.g. "79900"). Stable across the pipeline. */
  name: string;
  /** Shopify order GID (when known); not used for routing, surfaced for audit. */
  orderId?: string;
  coordinates: Coordinate;
  /** Free-text neighborhood label from the order's address. */
  neighborhood?: string;
  /** Total order amount in BRL (informational; downstream may surface in commentary). */
  totalBRL?: number;
  /** Hint: order is a known outlier (set when the upstream tag exists). */
  isOutlier?: boolean;
  /** Distance from pickup, km (computed upstream when available). */
  distanceFromPickupKm?: number;
  /** Days the delivery promise allows (informational; deferred variant reads this). */
  deliveryPromiseDays?: number;
  /** How many days into the promise window we are (1 = first day). */
  daysIntoPromise?: number;
};

/** Market keys used by per-metro outlier thresholds. */
export type MarketKey = "rio-de-janeiro" | "sao-paulo" | "recife" | "other";

// ── Geofence registry (parsed brazil.json) ─────────────────────────────────

export type GeofenceBarrier = {
  id: string;
  name: string;
  type: string;
  severity: "hard" | "soft" | "info-only" | "outlier-pattern";
  citation: string;
  explanation: string;
  addsMinutesTypical?: number;
  addsMinutesPeak?: number;
  rule?: string;
  sides?: Record<
    string,
    {
      neighborhoods?: string[];
      description?: string;
      boundingBox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
    }
  >;
  neighborhoods?: string[];
  evidenceFromCases?: string[];
};

export type OutlierThreshold = {
  multiplierOverMedianCentroidDistance: number;
  minimumAbsoluteDistanceKm: number;
  explanation?: string;
};

export type AbsorptionThreshold = {
  maxOrdersPerCandidateRoute: number;
  minSpreadKm: number;
  explanation?: string;
};

export type SparseVolumeLocation = {
  name: string;
  avgOrdersPerDay30d: number;
  rationale?: string;
};

export type CorridorPair = {
  id: string;
  pickupNeighborhood: string;
  distantClusterNeighborhood: string;
  intermediateNeighborhoods: string[];
  evidenceFromCases?: string[];
  validationsObserved?: number;
  validationsRequiredForPromotion?: number;
  status?: "candidate" | "promoted";
};

export type GeofenceRegistry = {
  version: number;
  generatedAt: string;
  scope: string;
  country: string;
  purpose?: string;
  schema?: Record<string, string>;
  barriers: GeofenceBarrier[];
  outlierThresholds: {
    default: OutlierThreshold;
    byMetro: Record<string, OutlierThreshold>;
  };
  absorptionThresholds: {
    default: AbsorptionThreshold;
    evidenceFromCases?: string[];
  };
  sparseVolumeLocations: {
    criterionAvgOrdersPerDay: number;
    criterionConsecutiveSingleOrderDays: number;
    explanation?: string;
    knownSparseLocationsByTenant: Record<string, Record<string, SparseVolumeLocation>>;
  };
  corridorPairs: {
    explanation?: string;
    pairs: CorridorPair[];
  };
  changelog?: { version: number; date: string; summary: string }[];
};

// ── Candidate (output of candidate-generator) ──────────────────────────────

export type CandidateType =
  | "optimizer-base"
  | "split-outliers"
  | "absorb-low-spread"
  | "corridor-from-pickup-swap"
  | "rule-fallback"
  | "deferred";

/** One route slot inside a candidate (a single Lalamove dispatch). */
export type RouteSlot = {
  slot: number;
  orderIds: string[];
};

/**
 * A candidate clustering. Each candidate is one full assignment of the
 * unassigned-orders set into route slots; multiple candidates compete inside
 * the arbiter.
 */
export type Candidate = {
  candidateId: string;
  candidateType: CandidateType;
  /** Slots in dispatch order; orderIds within a slot are also dispatch-ordered. */
  clustering: RouteSlot[];
  /** Free-text hint from the generator about why this variant exists. */
  generationNote?: string;
};

// ── RuleResult (output of rule-engine) ─────────────────────────────────────

export type RuleSeverity = "hard" | "soft" | "info";

export type RuleViolation = {
  /** Stable id from `geofences/brazil.json` or a built-in rule key. */
  ruleId: string;
  severity: RuleSeverity;
  /** One-sentence explanation suitable for the post-mortem panel. */
  explanation: string;
  /** Citation, e.g. "playbook §6.2" or "feedback_corridor_pickup_check". */
  citation: string;
  /** Estimated minutes the violation adds (when knowable). */
  addsMinutesEstimate?: number;
};

export type SeverityVerdict = "clear" | "soft-violation" | "hard-violation";

export type RuleResult = {
  candidateId: string;
  ruleViolations: RuleViolation[];
  /** Rule ids that fired and passed — for per-rule coverage reporting. */
  rulesPassed: string[];
  severityVerdict: SeverityVerdict;
};

// ── QuoteResult (output of quote-engine) ───────────────────────────────────

/** One route's quote from Lalamove; shape mirrors carrier-quotation-optimizer's CarrierRouteResult. */
export type CandidateRouteQuote = {
  slot: number;
  orderIds: string[];
  costSubunits: number;
  costTotal: string;
  costCurrency: string;
  serviceType: string;
  distanceMeters?: number;
};

export type QuoteResult = {
  candidateId: string;
  ok: true;
  routes: CandidateRouteQuote[];
  /** Sum across all routes in this candidate (subunits). */
  grandTotalSubunits: number;
  grandTotalDisplay: string;
  grandTotalCurrency: string;
  /** Sum across all routes; missing when any leg's distance is unknown. */
  grandTotalDistanceMeters?: number;
} | {
  candidateId: string;
  ok: false;
  /** Quote failed for at least one route in the candidate. */
  error: string;
  /** Slots that failed (if partial); empty when the whole candidate is unquotable. */
  failedSlots: number[];
};

// ── SpatialReasonerOutput (output of spatial-reasoner) ─────────────────────

export type RuleEngineAgreement = "agrees" | "disagrees" | "extends";

export type OutlierFlag = {
  orderName: string;
  reasoning: string;
};

export type CandidateReview = {
  candidateId: string;
  /** Reasoner's confidence-weighted preference for this candidate. */
  score: number;
  /** 1–3 sentences. Surfaced in the post-mortem panel. */
  commentary: string;
  /** Barrier ids from geofences/brazil.json that this candidate crosses. */
  barrierCrossings: string[];
  /** Corridor pair ids from geofences/brazil.json that this candidate matches. */
  corridorMatches: string[];
  outlierFlags: OutlierFlag[];
  ruleEngineAgreement: RuleEngineAgreement;
};

export type PostMortemFlagCategory =
  | "soft-rule-violation"
  | "novel-pattern"
  | "low-confidence-decision"
  | "cost-vs-barrier-tradeoff"
  | "outlier-kept-on-route"
  | "autonomous-postponement";

export type PostMortemFlagSeverity = "info" | "review-suggested" | "review-recommended";

export type PostMortemFlag = {
  category: PostMortemFlagCategory;
  ruleIds: string[];
  severity: PostMortemFlagSeverity;
  /** One-sentence "why operator should look at this" rationale. */
  reasoning: string;
};

export type SpatialReasonerOutput = {
  candidates: CandidateReview[];
  /**
   * The reasoner's recommended candidate. NEVER null — the system always
   * commits to a decision. Use postMortemFlags + low confidence for cases
   * the operator should review retroactively.
   */
  recommendedCandidateId: string;
  /**
   * Self-rating of the review (0–1). Drives model escalation
   * (Haiku → Sonnet on second-pass) and post-mortem flag severity. Does NOT
   * gate dispatch.
   */
  confidence: number;
  globalCommentary: string;
  postMortemFlags: PostMortemFlag[];
  /** Which prompt version produced this review; immutable post-promotion. */
  promptVersion: string;
};

// ── ArbiterDecision (output of decision-arbiter) ───────────────────────────

export type DecisionPath =
  | "auto-dispatch-eligible"
  | "auto-dispatched-with-post-mortem-flag"
  | "auto-postponed-with-post-mortem-flag"
  | "exclude-from-optimize"
  | "auto-fix-and-include"
  /**
   * Post-hoc tracking: a prior decision was operator-overridden in the
   * post-mortem panel. The system logged the override (with reasoning + tags)
   * for the rule-promotion-gate but did not propose a new rule yet (needs N
   * cross-tenant accumulation first). No new dispatch occurs.
   */
  | "log-override-no-rule-proposal";

export type ArbiterDecision = {
  /** The chosen candidate the dispatcher will fire. */
  winningCandidateId: string;
  decisionPath: DecisionPath;
  rationale: string;
  costSubunits: number;
  costDisplay: string;
  costCurrency: string;
  /** End-to-end confidence: combines reasoner confidence with rule + cost certainty. */
  confidence: number;
  postMortemFlags: PostMortemFlag[];
  /** Where each input came from — for replay + audit. */
  sources: {
    rulesUsed: string[];
    llmConfidence: number;
    /** Candidate ids sorted cheapest → most expensive. */
    costRanking: string[];
  };
};

// ── Eval case schema (matches eval/seed.json) ──────────────────────────────

export type EvalExpectedDecision = {
  decisionPath: DecisionPath;
  /** May be null only for legacy cases pre-autonomous pivot (none in v1.1). */
  chosenCandidateId: string | null;
  rationale: string;
  minimumConfidence?: number;
  maximumConfidence?: number;
  operatorOverrideAccepted?: boolean | string;
  /** For autonomous cases: which post-mortem flag the system should emit. */
  postMortemFlag?: {
    category: PostMortemFlagCategory;
    /** Either a single barrier or a list of rule ids that should be referenced. */
    barrierId?: string;
    rules?: string[];
    operatorFeedbackInvited?: string;
  };
  /** Side-channel notes attached to the expected decision. */
  ifOperatorPicksCombined?: string;
  ifOperatorPicksSplit?: string;
  chosenAutofix?: {
    address1: string;
    address2: string;
    pattern: string;
    confidence: string;
  };
};

export type EvalOrderInput = {
  name: string;
  customer?: string;
  address1?: string;
  city?: string;
  coordinates?: { lat: number; lng: number };
  neighborhood?: string;
  totalBRL?: number;
  isOutlier?: boolean;
  distanceFromPickupKm?: number;
  deliveryPromiseDays?: number;
  todayDay?: number;
  tags?: string[];
  expectedInOptimize?: boolean;
  corridorPosition?: string;
};

export type EvalCandidate = {
  candidateId: string;
  candidateType?: CandidateType | string;
  clustering?: { slot: number; orderNames: string[] }[];
  quotedTotalBRL?: number;
  quotedDistanceMeters?: number;
  ruleViolations?: {
    ruleId: string;
    severity: RuleSeverity;
    explanation: string;
    citation: string;
  }[];
};

export type EvalCase = {
  id: string;
  scenarioName: string;
  description: string;
  category: string;
  tenant: string | null;
  globalApplicability: string;
  inputSnapshot: {
    locationName?: string;
    locationId?: string;
    pickupCoordinates?: { lat: number; lng: number };
    pickupAddress?: string;
    orders?: EvalOrderInput[];
    ordersInPool?: EvalOrderInput[];
    ordersInCluster?: number;
    allInSameNeighborhood?: boolean;
    centroidDistanceMaxKm?: number;
    address1?: string;
    address2?: string;
    city?: string;
    marketContext?: string;
    locationVolumeContext?: string;
    decisionId?: string;
    operatorAction?: {
      chosenCandidate: string;
      reasoning: string;
      tags: string[];
    };
    originalOptimizerClustering?: unknown;
    absorptionVariantClustering?: unknown;
    savings?: number;
  };
  candidates?: EvalCandidate[];
  expectedDecision: EvalExpectedDecision;
  rulesExercised: string[];
  source: {
    sessionDate?: string;
    operatorReasoning?: string;
    actualOutcome?: string;
    shippedIn?: string;
    purpose?: string;
    rulePromotionCandidate?: string;
  };
};

export type EvalSet = {
  version: number;
  generatedAt: string;
  extractedFromSessions: string;
  purpose: string;
  architecturalPremise: string;
  passRateNotes: string;
  cases: EvalCase[];
  passRatePolicy: Record<string, string>;
  changelog: {
    version: number;
    date: string;
    author?: string;
    summary: string;
  }[];
};

// ── Coordinate helpers (re-export so all consumers stay in this module) ────

export type { Coordinate };
