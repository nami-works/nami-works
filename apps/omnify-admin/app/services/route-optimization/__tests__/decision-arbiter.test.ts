/**
 * Unit tests for decision-arbiter.server.ts.
 *
 * Run: npx tsx --test app/services/route-optimization/__tests__/decision-arbiter.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { arbitrate } from "../decision-arbiter.server";
import type {
  Candidate,
  PostMortemFlag,
  QuoteResult,
  RuleResult,
  RuleViolation,
  SpatialReasonerOutput,
} from "../types";

// ── Fixtures ───────────────────────────────────────────────────────────────

function candidate(
  id: string,
  type: Candidate["candidateType"] = "optimizer-base",
  slots: string[][] = [["a"]],
): Candidate {
  return {
    candidateId: id,
    candidateType: type,
    clustering: slots.map((ids, slot) => ({ slot, orderIds: ids })),
  };
}

function rule(
  id: string,
  verdict: RuleResult["severityVerdict"] = "clear",
  violations: RuleViolation[] = [],
  rulesPassed: string[] = [],
): RuleResult {
  return { candidateId: id, ruleViolations: violations, rulesPassed, severityVerdict: verdict };
}

function quoteOk(id: string, total: number): QuoteResult {
  return {
    candidateId: id,
    ok: true,
    routes: [],
    grandTotalSubunits: total,
    grandTotalDisplay: (total / 100).toFixed(2),
    grandTotalCurrency: "BRL",
  };
}

function quoteFail(id: string, err = "lalamove down"): QuoteResult {
  return {
    candidateId: id,
    ok: false,
    error: err,
    failedSlots: [0],
  };
}

function reasonerOutput(
  recommendedId: string,
  confidence = 0.9,
  flags: PostMortemFlag[] = [],
): SpatialReasonerOutput {
  return {
    candidates: [],
    recommendedCandidateId: recommendedId,
    confidence,
    globalCommentary: "x",
    postMortemFlags: flags,
    promptVersion: "v1",
  };
}

// ── Happy path: reasoner recommendation is eligible + clean ────────────────

test("clean dispatch: reasoner pick eligible, no flags, decisionPath = auto-dispatch-eligible", () => {
  const decision = arbitrate({
    candidates: [candidate("a"), candidate("b")],
    ruleResults: [rule("a"), rule("b")],
    quoteResults: [quoteOk("a", 5000), quoteOk("b", 6000)],
    reasonerOutput: reasonerOutput("a", 0.92),
  });
  assert.equal(decision.winningCandidateId, "a");
  assert.equal(decision.decisionPath, "auto-dispatch-eligible");
  assert.equal(decision.costSubunits, 5000);
  assert.equal(decision.postMortemFlags.length, 0);
});

// ── Soft violation → flag + dispatch-with-flag path ────────────────────────

test("soft violation on winner: auto-dispatched-with-post-mortem-flag", () => {
  const softViolation: RuleViolation = {
    ruleId: "rio-guanabara-bay",
    severity: "soft",
    explanation: "crosses bay",
    citation: "playbook §6.2",
  };
  const decision = arbitrate({
    candidates: [candidate("combined"), candidate("split")],
    ruleResults: [
      rule("combined", "soft-violation", [softViolation]),
      rule("split"),
    ],
    quoteResults: [quoteOk("combined", 4495), quoteOk("split", 6509)],
    reasonerOutput: reasonerOutput("combined", 0.85),
  });
  assert.equal(decision.winningCandidateId, "combined");
  assert.equal(decision.decisionPath, "auto-dispatched-with-post-mortem-flag");
  assert.ok(
    decision.postMortemFlags.some((f) => f.ruleIds.includes("rio-guanabara-bay")),
    `expected post-mortem flag with rio-guanabara-bay. Got: ${decision.postMortemFlags.map((f) => JSON.stringify(f)).join(",")}`,
  );
});

// ── Low confidence → adds low-confidence-decision flag ─────────────────────

test("confidence below 0.7 raises low-confidence-decision flag", () => {
  const decision = arbitrate({
    candidates: [candidate("a")],
    ruleResults: [rule("a")],
    quoteResults: [quoteOk("a", 5000)],
    reasonerOutput: reasonerOutput("a", 0.6),
  });
  assert.equal(decision.winningCandidateId, "a");
  assert.equal(decision.decisionPath, "auto-dispatched-with-post-mortem-flag");
  assert.ok(
    decision.postMortemFlags.some((f) => f.category === "low-confidence-decision"),
  );
});

// ── Hard violation → reasoner pick rejected, fallback to cheapest eligible ─

test("reasoner pick has hard violation: arbiter falls back to cheapest eligible", () => {
  const decision = arbitrate({
    candidates: [candidate("a"), candidate("b"), candidate("c")],
    ruleResults: [
      rule("a", "hard-violation", [
        { ruleId: "hard-7-cap", severity: "hard", explanation: "x", citation: "y" },
      ]),
      rule("b"),
      rule("c"),
    ],
    quoteResults: [quoteOk("a", 4000), quoteOk("b", 6000), quoteOk("c", 5000)],
    reasonerOutput: reasonerOutput("a", 0.9),
  });
  // a is cheapest but hard-violation → ineligible.
  // c (5000) is cheaper than b (6000) → c wins.
  assert.equal(decision.winningCandidateId, "c");
  assert.ok(decision.rationale.includes("ineligible"));
});

// ── All hard violations → exclude-from-optimize ────────────────────────────

test("all candidates have hard violations: decisionPath = exclude-from-optimize", () => {
  const decision = arbitrate({
    candidates: [candidate("a"), candidate("b")],
    ruleResults: [
      rule("a", "hard-violation", [
        { ruleId: "hard-7-cap", severity: "hard", explanation: "x", citation: "y" },
      ]),
      rule("b", "hard-violation", [
        { ruleId: "hard-7-cap", severity: "hard", explanation: "x", citation: "y" },
      ]),
    ],
    quoteResults: [quoteOk("a", 4000), quoteOk("b", 6000)],
    reasonerOutput: reasonerOutput("a", 0.5),
  });
  assert.equal(decision.decisionPath, "exclude-from-optimize");
  assert.equal(decision.confidence, 0);
});

// ── Quote failure → candidate ineligible ───────────────────────────────────

test("quote failure makes a candidate ineligible; reasoner pick is bypassed", () => {
  const decision = arbitrate({
    candidates: [candidate("a"), candidate("b")],
    ruleResults: [rule("a"), rule("b")],
    quoteResults: [quoteFail("a"), quoteOk("b", 6000)],
    reasonerOutput: reasonerOutput("a", 0.9),
  });
  assert.equal(decision.winningCandidateId, "b");
});

// ── Deferred winner ───────────────────────────────────────────────────────

test("deferred winner: decisionPath = auto-postponed-with-post-mortem-flag", () => {
  const deferred: Candidate = {
    candidateId: "postpone-tomorrow",
    candidateType: "deferred",
    clustering: [],
  };
  const decision = arbitrate({
    candidates: [deferred],
    ruleResults: [rule("postpone-tomorrow")],
    quoteResults: [
      {
        candidateId: "postpone-tomorrow",
        ok: true,
        routes: [],
        grandTotalSubunits: 0,
        grandTotalDisplay: "0.00",
        grandTotalCurrency: "BRL",
      },
    ],
    reasonerOutput: reasonerOutput("postpone-tomorrow", 0.85),
  });
  assert.equal(decision.winningCandidateId, "postpone-tomorrow");
  assert.equal(decision.decisionPath, "auto-postponed-with-post-mortem-flag");
  assert.equal(decision.costSubunits, 0);
  assert.ok(
    decision.postMortemFlags.some((f) => f.category === "autonomous-postponement"),
  );
});

// ── Flag deduplication ─────────────────────────────────────────────────────

test("flag dedup: reasoner + arbiter agree on a flag, only one emitted", () => {
  const dupFlag: PostMortemFlag = {
    category: "soft-rule-violation",
    ruleIds: ["rio-guanabara-bay"],
    severity: "review-suggested",
    reasoning: "from reasoner",
  };
  const softViolation: RuleViolation = {
    ruleId: "rio-guanabara-bay",
    severity: "soft",
    explanation: "from rule engine",
    citation: "playbook §6.2",
  };
  const decision = arbitrate({
    candidates: [candidate("a")],
    ruleResults: [rule("a", "soft-violation", [softViolation])],
    quoteResults: [quoteOk("a", 5000)],
    reasonerOutput: reasonerOutput("a", 0.85, [dupFlag]),
  });
  const matching = decision.postMortemFlags.filter((f) =>
    f.ruleIds.includes("rio-guanabara-bay"),
  );
  assert.equal(
    matching.length,
    1,
    `expected single rio-guanabara-bay flag after dedup. Got: ${decision.postMortemFlags.length}`,
  );
});

// ── Cost ranking ──────────────────────────────────────────────────────────

test("sources.costRanking reflects per-candidate quote ordering", () => {
  const decision = arbitrate({
    candidates: [candidate("a"), candidate("b"), candidate("c")],
    ruleResults: [rule("a"), rule("b"), rule("c")],
    quoteResults: [quoteOk("a", 9000), quoteOk("b", 4000), quoteOk("c", 6500)],
    reasonerOutput: reasonerOutput("b", 0.85),
  });
  assert.deepEqual(decision.sources.costRanking, ["b", "c", "a"]);
});

// ── Confidence combination ─────────────────────────────────────────────────

test("end-to-end confidence ≤ reasoner confidence (penalties apply, never bonus)", () => {
  const decision = arbitrate({
    candidates: [candidate("a")],
    ruleResults: [
      rule("a", "soft-violation", [
        { ruleId: "rio-guanabara-bay", severity: "soft", explanation: "x", citation: "y" },
      ]),
    ],
    quoteResults: [quoteOk("a", 5000)],
    reasonerOutput: reasonerOutput("a", 0.85),
  });
  assert.ok(decision.confidence < 0.85, `expected penalty applied. Got ${decision.confidence}`);
});

// ── Recommendation is null-safe ────────────────────────────────────────────

test("winningCandidateId is always set, never null even on degraded inputs", () => {
  const decision = arbitrate({
    candidates: [candidate("a")],
    ruleResults: [rule("a")],
    quoteResults: [quoteOk("a", 5000)],
    reasonerOutput: reasonerOutput("a", 0.5),
  });
  assert.ok(typeof decision.winningCandidateId === "string");
  assert.notEqual(decision.winningCandidateId, "");
});
