/**
 * Spatial reasoner (Phase 1.5).
 *
 * Orchestrates the LLM call that scores candidate clusterings, surfaces
 * barrier/corridor/outlier reasoning, and emits post-mortem flags. Pure
 * orchestrator — the actual LLM call is injected via the `Reasoner`
 * interface so tests run without hitting Anthropic.
 *
 * The system is fully autonomous: this module ALWAYS commits to a winning
 * candidate. Soft-rule violations, ambiguous trade-offs, and low confidence
 * surface via `postMortemFlags[]` for the operator's post-mortem panel,
 * never via a real-time review queue.
 *
 * Heuristics (from prompts/v1-spatial-reasoner.md):
 *   1. Haiku first; escalate to Sonnet if confidence < 0.7 on first pass.
 *   2. One retry on validation failure with the same model.
 *   3. recommendedCandidateId is never null — fallback to cheapest +
 *      synthetic low-confidence flag if both attempts fail.
 */

import type {
  Candidate,
  CandidateOrderInput,
  Coordinate,
  GeofenceBarrier,
  GeofenceRegistry,
  MarketKey,
  PostMortemFlag,
  QuoteResult,
  RuleResult,
  SpatialReasonerOutput,
} from "./types";

// ── Reasoner contract (injection point) ────────────────────────────────────

export type ReasonerModel = "haiku" | "sonnet";

export type ReasonerInput = {
  systemPrompt: string;
  userMessage: string;
  /**
   * Either a public Static Maps URL (Anthropic fetches it server-side OR the
   * adapter base64-encodes it) or a base64 PNG payload.
   */
  pngUrl?: string;
  pngBase64?: string;
  promptVersion: string;
  model: ReasonerModel;
};

export type ReasonerSuccess = {
  ok: true;
  /** Raw text returned by the model, prior to JSON parse. */
  rawText: string;
  parsed: SpatialReasonerOutput;
  /** Reported usage from the model (when available). */
  tokensUsed?: { input: number; output: number };
  /** The model id Anthropic actually billed. */
  modelActual: string;
};

export type ReasonerFailure = {
  ok: false;
  reason: "json_parse_failure" | "validation_failure" | "api_failure" | "timeout" | "unparseable_sentinel";
  rawText?: string;
  errorDetail?: string;
};

export type ReasonerOutput = ReasonerSuccess | ReasonerFailure;
export type Reasoner = (input: ReasonerInput) => Promise<ReasonerOutput>;

// ── User-message rendering ────────────────────────────────────────────────

export type ReasonerOrchestratorInput = {
  candidates: Candidate[];
  rules: RuleResult[];
  quotes: QuoteResult[];
  orders: CandidateOrderInput[];
  pickupCoordinates: Coordinate;
  market: MarketKey;
  locationName: string;
  pngUrl?: string;
  pngBase64?: string;
  geofenceRegistry: GeofenceRegistry;
  marketContext?: string;
  systemPrompt: string;
  promptVersion: string;
  reasoner: Reasoner;
  /** ISO date for the user-message header. */
  dateIso?: string;
};

/**
 * Filter the registry down to entries relevant for a given market — we
 * don't send the whole brazil.json to the model on every call, just the
 * subset that affects this dispatch.
 */
export function geofenceExcerptForMarket(
  registry: GeofenceRegistry,
  market: MarketKey,
): {
  barriers: GeofenceBarrier[];
  outlierThreshold: { multiplierOverMedianCentroidDistance: number; minimumAbsoluteDistanceKm: number };
  absorptionThreshold: { maxOrdersPerCandidateRoute: number; minSpreadKm: number };
  corridorPairs: typeof registry.corridorPairs.pairs;
} {
  // Barriers: include any whose neighborhoods/bounding boxes might fall in
  // this market. For Phase 1.5 simplicity, we include all SOFT/HARD barriers
  // regardless of market — the LLM ignores irrelevant ones and the prompt
  // is small enough that this is fine.
  const barriers = registry.barriers.filter(
    (b) => b.severity === "soft" || b.severity === "hard",
  );
  const outlierThreshold =
    registry.outlierThresholds.byMetro[market] ?? registry.outlierThresholds.default;
  return {
    barriers,
    outlierThreshold,
    absorptionThreshold: registry.absorptionThresholds.default,
    corridorPairs: registry.corridorPairs.pairs,
  };
}

function buildUserMessage(input: ReasonerOrchestratorInput): string {
  const date = input.dateIso ?? new Date().toISOString().slice(0, 10);
  const excerpt = geofenceExcerptForMarket(input.geofenceRegistry, input.market);
  const ordersForPrompt = input.orders.map((o) => ({
    name: o.name,
    customer: o.totalBRL !== undefined ? `[BRL ${o.totalBRL}]` : undefined,
    address1: undefined, // Phase 1.5 keeps PII out of the prompt by default
    city: undefined,
    coordinates: o.coordinates,
    neighborhood: o.neighborhood,
    isOutlier: o.isOutlier,
  }));
  const candidatesForPrompt = input.candidates.map((c) => ({
    candidateId: c.candidateId,
    candidateType: c.candidateType,
    clustering: c.clustering,
    quotedTotalBRL: (() => {
      const q = input.quotes.find((qr) => qr.candidateId === c.candidateId);
      if (q?.ok) return Number(q.grandTotalDisplay);
      return undefined;
    })(),
    quotedDistanceMeters: (() => {
      const q = input.quotes.find((qr) => qr.candidateId === c.candidateId);
      if (q?.ok) return q.grandTotalDistanceMeters;
      return undefined;
    })(),
    generationNote: c.generationNote,
  }));
  const ruleFindings = input.rules.map((r) => ({
    candidateId: r.candidateId,
    severityVerdict: r.severityVerdict,
    ruleViolations: r.ruleViolations,
    rulesPassed: r.rulesPassed,
  }));

  return [
    `# Optimization request: ${input.locationName} · ${date}`,
    "",
    "## Pickup",
    `${input.locationName} at lat=${input.pickupCoordinates.latitude}, lng=${input.pickupCoordinates.longitude}`,
    "",
    "## Orders in this batch",
    JSON.stringify(ordersForPrompt, null, 2),
    "",
    "## Candidates considered",
    JSON.stringify(candidatesForPrompt, null, 2),
    "",
    "## Rule engine findings",
    JSON.stringify(ruleFindings, null, 2),
    "",
    "## Geofence registry (excerpt for this market)",
    JSON.stringify(excerpt, null, 2),
    "",
    "## Market context",
    input.marketContext ?? `${input.market}`,
    "",
    input.pngUrl || input.pngBase64
      ? "[ATTACHED: route map PNG]"
      : "[NO map PNG attached]",
    "",
    "Produce your structured review per the system prompt.",
  ].join("\n");
}

// ── Output validation ─────────────────────────────────────────────────────

const VALID_FLAG_CATEGORIES = new Set([
  "soft-rule-violation",
  "novel-pattern",
  "low-confidence-decision",
  "cost-vs-barrier-tradeoff",
  "outlier-kept-on-route",
  "autonomous-postponement",
]);

function isValidSpatialReasonerOutput(
  candidate: unknown,
): candidate is SpatialReasonerOutput {
  if (!candidate || typeof candidate !== "object") return false;
  const o = candidate as Record<string, unknown>;
  if (!Array.isArray(o.candidates)) return false;
  if (typeof o.recommendedCandidateId !== "string" || !o.recommendedCandidateId) return false;
  if (typeof o.confidence !== "number" || o.confidence < 0 || o.confidence > 1) return false;
  if (typeof o.globalCommentary !== "string") return false;
  if (!Array.isArray(o.postMortemFlags)) return false;
  // `promptVersion` is metadata the reasoner injects post-parse from
  // `ReasonerInput.promptVersion` — the LLM never sees it in the v1 prompt
  // schema, so requiring it here causes every real call to fail validation.
  for (const c of o.candidates as unknown[]) {
    if (!c || typeof c !== "object") return false;
    const cc = c as Record<string, unknown>;
    if (typeof cc.candidateId !== "string") return false;
    if (typeof cc.score !== "number") return false;
    if (typeof cc.commentary !== "string") return false;
    if (!Array.isArray(cc.barrierCrossings)) return false;
    if (!Array.isArray(cc.corridorMatches)) return false;
    if (!Array.isArray(cc.outlierFlags)) return false;
    if (typeof cc.ruleEngineAgreement !== "string") return false;
  }
  for (const f of o.postMortemFlags as unknown[]) {
    if (!f || typeof f !== "object") return false;
    const ff = f as Record<string, unknown>;
    if (typeof ff.category !== "string" || !VALID_FLAG_CATEGORIES.has(ff.category as string)) return false;
    if (!Array.isArray(ff.ruleIds)) return false;
    if (typeof ff.severity !== "string") return false;
    if (typeof ff.reasoning !== "string") return false;
  }
  return true;
}

/**
 * Strict JSON parse with sentinel handling. The v1 prompt instructs the LLM
 * to emit the literal token `UNPARSEABLE` when input is non-delivery; we
 * detect that here.
 */
function parseStrictJson(raw: string):
  | { ok: true; value: SpatialReasonerOutput }
  | { ok: false; reason: "unparseable_sentinel" | "json_parse_failure" | "validation_failure"; detail?: string } {
  const trimmed = raw.trim();
  if (trimmed === "UNPARSEABLE") {
    return { ok: false, reason: "unparseable_sentinel" };
  }
  let parsed: unknown;
  try {
    // Allow ```json blocks at the model's discretion.
    const inFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    parsed = JSON.parse(inFence ? inFence[1]! : trimmed);
  } catch (err) {
    return {
      ok: false,
      reason: "json_parse_failure",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!isValidSpatialReasonerOutput(parsed)) {
    return {
      ok: false,
      reason: "validation_failure",
      detail: "schema mismatch (missing required field or wrong type)",
    };
  }
  return { ok: true, value: parsed };
}

// ── Synthetic fallback for total-failure path ─────────────────────────────

function syntheticFallback(
  candidates: Candidate[],
  quotes: QuoteResult[],
  rules: RuleResult[],
  promptVersion: string,
  reason: string,
): SpatialReasonerOutput {
  // Pick the cheapest ok-quoted candidate that has no HARD violation.
  const eligible = candidates.filter((c) => {
    const r = rules.find((rr) => rr.candidateId === c.candidateId);
    return r?.severityVerdict !== "hard-violation";
  });
  const ranked = eligible.slice().sort((a, b) => {
    const qa = quotes.find((q) => q.candidateId === a.candidateId);
    const qb = quotes.find((q) => q.candidateId === b.candidateId);
    if (qa?.ok && qb?.ok) return qa.grandTotalSubunits - qb.grandTotalSubunits;
    if (qa?.ok) return -1;
    if (qb?.ok) return 1;
    return 0;
  });
  const chosen = ranked[0] ?? candidates[0]!;

  const flags: PostMortemFlag[] = [
    {
      category: "low-confidence-decision",
      ruleIds: [],
      severity: "review-recommended",
      reasoning: `Spatial reasoner unavailable (${reason}); fell back to cheapest non-hard-violation candidate.`,
    },
  ];

  return {
    candidates: candidates.map((c) => ({
      candidateId: c.candidateId,
      score: c.candidateId === chosen.candidateId ? 0.5 : 0.3,
      commentary: "Synthetic score (reasoner unavailable).",
      barrierCrossings: [],
      corridorMatches: [],
      outlierFlags: [],
      ruleEngineAgreement: "agrees",
    })),
    recommendedCandidateId: chosen.candidateId,
    confidence: 0.4,
    globalCommentary: `Fallback decision — reasoner ${reason}.`,
    postMortemFlags: flags,
    promptVersion,
  };
}

// ── Orchestrator ───────────────────────────────────────────────────────────

export type ReasonerOrchestratorResult = {
  output: SpatialReasonerOutput;
  diagnostics: {
    attempts: { model: ReasonerModel; outcome: ReasonerOutput["ok"] extends true ? "ok" : string }[];
    finalModel: ReasonerModel;
    finalRawText?: string;
    fellBackToSynthetic: boolean;
  };
};

/**
 * Run the spatial reasoner.
 *
 * Flow:
 *  1. Call Haiku.
 *  2. If output parses + confidence ≥ 0.7 → return.
 *  3. If output is UNPARSEABLE or validation failed once → retry once.
 *  4. If parsed but confidence < 0.7 → escalate to Sonnet.
 *  5. If Sonnet output parses → return; else fall back to synthetic.
 */
export async function reasonAboutCandidates(
  input: ReasonerOrchestratorInput,
): Promise<ReasonerOrchestratorResult> {
  const userMessage = buildUserMessage(input);
  const attempts: ReasonerOrchestratorResult["diagnostics"]["attempts"] = [];

  async function callModel(model: ReasonerModel): Promise<ReasonerOutput> {
    const result = await input.reasoner({
      systemPrompt: input.systemPrompt,
      userMessage,
      pngUrl: input.pngUrl,
      pngBase64: input.pngBase64,
      promptVersion: input.promptVersion,
      model,
    });
    attempts.push({ model, outcome: result.ok ? "ok" : result.reason });
    return result;
  }

  // 1. Haiku.
  let haikuOut = await callModel("haiku");
  // 2. Retry on transient parse/validation failure.
  if (
    !haikuOut.ok &&
    (haikuOut.reason === "json_parse_failure" || haikuOut.reason === "validation_failure")
  ) {
    haikuOut = await callModel("haiku");
  }

  // 3. If Haiku produced a valid output and confidence is high enough, return.
  if (haikuOut.ok && haikuOut.parsed.confidence >= 0.7) {
    return {
      output: haikuOut.parsed,
      diagnostics: { attempts, finalModel: "haiku", finalRawText: haikuOut.rawText, fellBackToSynthetic: false },
    };
  }

  // 4. Escalate to Sonnet — either because Haiku failed or because
  //    confidence was below the auto-dispatch threshold.
  const sonnetOut = await callModel("sonnet");
  if (sonnetOut.ok) {
    return {
      output: sonnetOut.parsed,
      diagnostics: { attempts, finalModel: "sonnet", finalRawText: sonnetOut.rawText, fellBackToSynthetic: false },
    };
  }

  // 5. If Sonnet ALSO failed and Haiku had ANY valid output (even low conf),
  //    use the Haiku output and tag a low-confidence post-mortem flag.
  if (haikuOut.ok) {
    const enriched: SpatialReasonerOutput = {
      ...haikuOut.parsed,
      postMortemFlags: [
        ...haikuOut.parsed.postMortemFlags,
        {
          category: "low-confidence-decision",
          ruleIds: [],
          severity: "review-recommended",
          reasoning: "Haiku produced low confidence and Sonnet escalation failed; surfacing Haiku output for operator review.",
        },
      ],
    };
    return {
      output: enriched,
      diagnostics: { attempts, finalModel: "haiku", finalRawText: haikuOut.rawText, fellBackToSynthetic: false },
    };
  }

  // 6. Total reasoner failure — synthetic fallback.
  const fallback = syntheticFallback(
    input.candidates,
    input.quotes,
    input.rules,
    input.promptVersion,
    sonnetOut.reason,
  );
  return {
    output: fallback,
    diagnostics: { attempts, finalModel: "sonnet", fellBackToSynthetic: true },
  };
}

// ── Exports for direct testing ─────────────────────────────────────────────

export { buildUserMessage, parseStrictJson, isValidSpatialReasonerOutput };
