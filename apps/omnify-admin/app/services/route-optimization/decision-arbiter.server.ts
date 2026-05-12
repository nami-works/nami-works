/**
 * Decision arbiter (Phase 1.6).
 *
 * Final stage of the route-optimization pipeline. Combines:
 *  - RuleResult[] (Phase 1.3)
 *  - QuoteResult[] (Phase 1.4)
 *  - SpatialReasonerOutput (Phase 1.5)
 *
 * Produces a single `ArbiterDecision`: the candidate that will actually
 * dispatch (or postpone), with rationale, confidence, and post-mortem
 * flags attached.
 *
 * The system is autonomous: there is no operator review queue. The
 * arbiter always commits to a candidate. Soft-rule violations, ambiguous
 * trade-offs, and low confidence surface via `postMortemFlags[]` for the
 * operator's on-demand post-mortem panel.
 *
 * Resolution rules (in order):
 *  1. Hard-violation candidates are eliminated.
 *  2. If the reasoner's recommendation is eligible → it wins.
 *  3. Otherwise → cheapest eligible candidate.
 *  4. If no candidate is eligible (all have hard violations OR all failed
 *     quotes) → escalate via `decisionPath: "exclude-from-optimize"`.
 *
 * Decision-path semantics:
 *  - "auto-dispatch-eligible": clean — no soft violations, no flags surface
 *  - "auto-dispatched-with-post-mortem-flag": soft violation OR low LLM
 *    confidence — dispatch proceeds; operator reviews retroactively
 *  - "auto-postponed-with-post-mortem-flag": winning candidate is deferred
 *  - "exclude-from-optimize": no viable candidate; operator must intervene
 */

import { rankByCost } from "./quote-engine.server";
import type {
  ArbiterDecision,
  Candidate,
  DecisionPath,
  PostMortemFlag,
  PostMortemFlagSeverity,
  QuoteResult,
  RuleResult,
  RuleViolation,
  SpatialReasonerOutput,
} from "./types";

// ── Constants ──────────────────────────────────────────────────────────────

const ARBITER_VERSION = "v1.0";

// ── Input ──────────────────────────────────────────────────────────────────

export type DecisionArbiterInput = {
  candidates: Candidate[];
  ruleResults: RuleResult[];
  quoteResults: QuoteResult[];
  reasonerOutput: SpatialReasonerOutput;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function findRule(rules: RuleResult[], id: string): RuleResult | undefined {
  return rules.find((r) => r.candidateId === id);
}

function findQuote(quotes: QuoteResult[], id: string): QuoteResult | undefined {
  return quotes.find((q) => q.candidateId === id);
}

function findCandidate(candidates: Candidate[], id: string): Candidate | undefined {
  return candidates.find((c) => c.candidateId === id);
}

function isEligible(
  candidate: Candidate,
  rules: RuleResult[],
  quotes: QuoteResult[],
): { eligible: boolean; reason?: string } {
  const r = findRule(rules, candidate.candidateId);
  if (r?.severityVerdict === "hard-violation") {
    return { eligible: false, reason: "hard-rule-violation" };
  }
  const q = findQuote(quotes, candidate.candidateId);
  if (q && !q.ok) {
    return { eligible: false, reason: `quote-failed: ${q.error}` };
  }
  return { eligible: true };
}

/** Merge dedup'd post-mortem flags from rule-engine + reasoner + arbiter. */
function combineFlags(
  reasonerFlags: PostMortemFlag[],
  arbiterFlags: PostMortemFlag[],
): PostMortemFlag[] {
  const seen = new Set<string>();
  const out: PostMortemFlag[] = [];
  for (const f of [...arbiterFlags, ...reasonerFlags]) {
    const key = `${f.category}|${f.ruleIds.slice().sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Severity ranking: review-recommended > review-suggested > info. */
const SEVERITY_RANK: Record<PostMortemFlagSeverity, number> = {
  "review-recommended": 3,
  "review-suggested": 2,
  info: 1,
};

function highestFlagSeverity(flags: PostMortemFlag[]): PostMortemFlagSeverity | null {
  let best: PostMortemFlagSeverity | null = null;
  for (const f of flags) {
    if (best === null || SEVERITY_RANK[f.severity] > SEVERITY_RANK[best]) {
      best = f.severity;
    }
  }
  return best;
}

// ── Post-mortem-flag derivation from inputs ────────────────────────────────

/**
 * Synthesize the arbiter's own post-mortem flags from the rule-engine
 * findings + reasoner confidence. The reasoner's flags pass through;
 * these are *additional* flags the arbiter raises based on its own
 * combined view.
 */
function deriveArbiterFlags(
  winningRule: RuleResult | undefined,
  reasonerOutput: SpatialReasonerOutput,
  winningCandidate: Candidate,
): PostMortemFlag[] {
  const flags: PostMortemFlag[] = [];

  // Soft-rule violations on the winning candidate become explicit flags
  // (even if the reasoner didn't surface them).
  if (winningRule && winningRule.severityVerdict === "soft-violation") {
    const softViolations: RuleViolation[] = winningRule.ruleViolations.filter(
      (v) => v.severity === "soft",
    );
    for (const v of softViolations) {
      const category = v.ruleId.startsWith("outlier-")
        ? "outlier-kept-on-route"
        : v.ruleId === "absorption-test-candidate"
          ? "cost-vs-barrier-tradeoff"
          : "soft-rule-violation";
      flags.push({
        category,
        ruleIds: [v.ruleId],
        severity: "review-suggested",
        reasoning: v.explanation,
      });
    }
  }

  // Low reasoner confidence becomes a post-mortem signal.
  if (reasonerOutput.confidence < 0.7) {
    flags.push({
      category: "low-confidence-decision",
      ruleIds: [],
      severity: "review-recommended",
      reasoning: `Reasoner confidence ${reasonerOutput.confidence.toFixed(2)} below 0.7 auto-dispatch threshold.`,
    });
  }

  // Deferred candidates always carry an autonomous-postponement flag.
  if (winningCandidate.candidateType === "deferred") {
    flags.push({
      category: "autonomous-postponement",
      ruleIds: ["solo-order-postponement", "sparse-volume-location"],
      severity: "review-suggested",
      reasoning: "Sparse-volume solo order auto-postponed; operator can override if customer expectation changed.",
    });
  }

  return flags;
}

// ── Decision-path picker ──────────────────────────────────────────────────

function pickDecisionPath(
  winningCandidate: Candidate,
  winningRule: RuleResult | undefined,
  combinedFlags: PostMortemFlag[],
  reasonerConfidence: number,
): DecisionPath {
  if (winningCandidate.candidateType === "deferred") {
    return "auto-postponed-with-post-mortem-flag";
  }
  const hasSoftViolation = winningRule?.severityVerdict === "soft-violation";
  const hasReviewFlag = combinedFlags.some(
    (f) => f.severity === "review-suggested" || f.severity === "review-recommended",
  );
  if (hasSoftViolation || hasReviewFlag || reasonerConfidence < 0.85) {
    return "auto-dispatched-with-post-mortem-flag";
  }
  return "auto-dispatch-eligible";
}

// ── Confidence combination ────────────────────────────────────────────────

/**
 * End-to-end confidence: reasoner confidence multiplied by penalties for
 * soft violations and absent quotes. Reported on the dispatched decision
 * and on the post-mortem panel.
 */
function computeEndToEndConfidence(
  reasonerConfidence: number,
  winningRule: RuleResult | undefined,
  winningQuote: QuoteResult | undefined,
): number {
  let conf = reasonerConfidence;
  if (winningRule?.severityVerdict === "soft-violation") conf *= 0.95;
  if (!winningQuote || !winningQuote.ok) conf *= 0.6;
  return Math.max(0, Math.min(1, conf));
}

// ── Orchestrator ───────────────────────────────────────────────────────────

export function arbitrate(input: DecisionArbiterInput): ArbiterDecision {
  const { candidates, ruleResults, quoteResults, reasonerOutput } = input;

  // 1. Filter to eligible candidates.
  const eligibleIds = candidates
    .filter((c) => isEligible(c, ruleResults, quoteResults).eligible)
    .map((c) => c.candidateId);

  // 2. No-eligible escape hatch.
  if (eligibleIds.length === 0) {
    const placeholder = candidates[0];
    return {
      winningCandidateId: placeholder?.candidateId ?? "no-candidate",
      decisionPath: "exclude-from-optimize",
      rationale: "No candidate was eligible: all carry hard-rule violations OR all quotes failed. Operator must intervene.",
      costSubunits: 0,
      costDisplay: "0.00",
      costCurrency: "BRL",
      confidence: 0,
      postMortemFlags: [
        ...reasonerOutput.postMortemFlags,
        {
          category: "low-confidence-decision",
          ruleIds: [],
          severity: "review-recommended",
          reasoning: "No eligible candidate; system escalated to exclude-from-optimize and surfaced for operator handling.",
        },
      ],
      sources: {
        rulesUsed: candidates.flatMap((c) => findRule(ruleResults, c.candidateId)?.ruleViolations.map((v) => v.ruleId) ?? []),
        llmConfidence: reasonerOutput.confidence,
        costRanking: rankByCost(quoteResults),
      },
    };
  }

  // 3. Prefer reasoner's recommendation when eligible.
  let winningId: string | null = null;
  if (eligibleIds.includes(reasonerOutput.recommendedCandidateId)) {
    winningId = reasonerOutput.recommendedCandidateId;
  } else {
    // Fall back to cheapest eligible.
    const costRanking = rankByCost(quoteResults);
    winningId = costRanking.find((id) => eligibleIds.includes(id)) ?? eligibleIds[0]!;
  }

  const winningCandidate = findCandidate(candidates, winningId)!;
  const winningRule = findRule(ruleResults, winningId);
  const winningQuote = findQuote(quoteResults, winningId);

  // 4. Build the combined post-mortem flag set.
  const arbiterFlags = deriveArbiterFlags(winningRule, reasonerOutput, winningCandidate);
  const combinedFlags = combineFlags(reasonerOutput.postMortemFlags, arbiterFlags);

  // 5. Pick the decision path.
  const decisionPath = pickDecisionPath(
    winningCandidate,
    winningRule,
    combinedFlags,
    reasonerOutput.confidence,
  );

  // 6. Build the rationale.
  const rationaleParts: string[] = [];
  rationaleParts.push(
    winningId === reasonerOutput.recommendedCandidateId
      ? "Followed reasoner recommendation."
      : "Reasoner pick was ineligible; fell back to cheapest eligible candidate.",
  );
  if (winningRule?.severityVerdict === "soft-violation") {
    rationaleParts.push(
      `Soft-rule violation(s) accepted: ${winningRule.ruleViolations.map((v) => v.ruleId).join(", ")}.`,
    );
  }
  if (winningQuote?.ok) {
    rationaleParts.push(
      `Cost ${winningQuote.grandTotalCurrency} ${winningQuote.grandTotalDisplay}.`,
    );
  }
  const topFlagSeverity = highestFlagSeverity(combinedFlags);
  if (topFlagSeverity) {
    rationaleParts.push(`Post-mortem flag severity: ${topFlagSeverity}.`);
  }

  // 7. Costs (deferred winners report 0).
  const costSubunits = winningQuote?.ok ? winningQuote.grandTotalSubunits : 0;
  const costCurrency = winningQuote?.ok ? winningQuote.grandTotalCurrency : "BRL";

  // 8. Final confidence.
  const confidence = computeEndToEndConfidence(
    reasonerOutput.confidence,
    winningRule,
    winningQuote,
  );

  return {
    winningCandidateId: winningId,
    decisionPath,
    rationale: rationaleParts.join(" "),
    costSubunits,
    costDisplay: (costSubunits / 100).toFixed(2),
    costCurrency,
    confidence,
    postMortemFlags: combinedFlags,
    sources: {
      rulesUsed:
        winningRule?.ruleViolations.map((v) => v.ruleId).concat(winningRule.rulesPassed) ?? [],
      llmConfidence: reasonerOutput.confidence,
      costRanking: rankByCost(quoteResults),
    },
  };
}

export { ARBITER_VERSION };
