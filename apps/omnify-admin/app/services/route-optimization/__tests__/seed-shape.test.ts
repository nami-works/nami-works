/**
 * Eval-set shape test.
 *
 * Validates that `eval/seed.json` conforms to the `EvalSet` type contract in
 * `../types.ts`. Catches drift the moment a case is added or a field
 * renamed, so the type contract stays the source of truth.
 *
 * Run: npx tsx --test app/services/route-optimization/__tests__/seed-shape.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { loadEvalSet } from "../eval/runner";
import type {
  DecisionPath,
  EvalCase,
  EvalSet,
  PostMortemFlagCategory,
  RuleSeverity,
} from "../types";

const VALID_DECISION_PATHS: DecisionPath[] = [
  "auto-dispatch-eligible",
  "auto-dispatched-with-post-mortem-flag",
  "auto-postponed-with-post-mortem-flag",
  "exclude-from-optimize",
  "auto-fix-and-include",
  "log-override-no-rule-proposal",
];

const VALID_POST_MORTEM_CATEGORIES: PostMortemFlagCategory[] = [
  "soft-rule-violation",
  "novel-pattern",
  "low-confidence-decision",
  "cost-vs-barrier-tradeoff",
  "outlier-kept-on-route",
  "autonomous-postponement",
];

const VALID_RULE_SEVERITIES: RuleSeverity[] = ["hard", "soft", "info"];

let evalSet: EvalSet;

test("seed loads + has top-level fields", () => {
  evalSet = loadEvalSet();
  assert.equal(typeof evalSet.version, "number");
  assert.equal(typeof evalSet.generatedAt, "string");
  assert.equal(typeof evalSet.purpose, "string");
  assert.equal(typeof evalSet.architecturalPremise, "string");
  assert.ok(Array.isArray(evalSet.cases));
  assert.ok(evalSet.cases.length >= 10, "eval set must have ≥10 cases per Phase 0 acceptance");
  assert.ok(Array.isArray(evalSet.changelog));
  assert.ok(evalSet.changelog.length >= 1);
});

test("every case has required identity + decision fields", () => {
  for (const c of evalSet.cases) {
    assert.equal(typeof c.id, "string", `case missing id: ${JSON.stringify(c).slice(0, 80)}`);
    assert.equal(typeof c.scenarioName, "string", `${c.id}: missing scenarioName`);
    assert.equal(typeof c.description, "string", `${c.id}: missing description`);
    assert.equal(typeof c.category, "string", `${c.id}: missing category`);
    assert.equal(typeof c.globalApplicability, "string", `${c.id}: missing globalApplicability`);
    assert.ok(c.expectedDecision, `${c.id}: missing expectedDecision`);
    assert.ok(Array.isArray(c.rulesExercised), `${c.id}: rulesExercised must be array`);
    assert.ok(c.source, `${c.id}: missing source`);
  }
});

test("every expectedDecision.decisionPath is a known value", () => {
  for (const c of evalSet.cases) {
    assert.ok(
      VALID_DECISION_PATHS.includes(c.expectedDecision.decisionPath),
      `${c.id}: decisionPath=${c.expectedDecision.decisionPath} not in ${VALID_DECISION_PATHS.join("|")}`,
    );
  }
});

test("autonomous-pivot cases never have null chosenCandidateId", () => {
  // The 2026-05-12 architectural pivot removed the queued-for-review path —
  // every case in v1.1+ commits to a decision. null is allowed only for
  // category=baseline-clean (where the "choice" is the optimizer-base default)
  // and operator-override-tracking (which is post-hoc).
  const allowedNullCategories = new Set([
    "operator-override-tracking",
    "address-autofix-pattern-1",
    "address-autofix-pattern-2-edge-case",
    "hard-exclusion-rule",
    "baseline-clean",
    "hard-cap",
  ]);
  for (const c of evalSet.cases) {
    if (
      c.expectedDecision.chosenCandidateId === null &&
      !allowedNullCategories.has(c.category)
    ) {
      assert.fail(
        `${c.id}: chosenCandidateId is null but category=${c.category} is not in allowed-null set ` +
          `(${[...allowedNullCategories].join(",")}). Did the autonomous-pivot get applied?`,
      );
    }
  }
});

test("postMortemFlag categories are known", () => {
  for (const c of evalSet.cases) {
    const flag = c.expectedDecision.postMortemFlag;
    if (!flag) continue;
    assert.ok(
      VALID_POST_MORTEM_CATEGORIES.includes(flag.category),
      `${c.id}: postMortemFlag.category=${flag.category} not in ${VALID_POST_MORTEM_CATEGORIES.join("|")}`,
    );
  }
});

test("candidate ruleViolations carry known severities", () => {
  for (const c of evalSet.cases) {
    for (const cand of c.candidates ?? []) {
      for (const v of cand.ruleViolations ?? []) {
        assert.ok(
          VALID_RULE_SEVERITIES.includes(v.severity),
          `${c.id}/${cand.candidateId}/${v.ruleId}: severity=${v.severity} not in ${VALID_RULE_SEVERITIES.join("|")}`,
        );
        assert.equal(typeof v.explanation, "string", `${c.id}/${cand.candidateId}/${v.ruleId}: missing explanation`);
        assert.equal(typeof v.citation, "string", `${c.id}/${cand.candidateId}/${v.ruleId}: missing citation`);
      }
    }
  }
});

test("case ids are unique", () => {
  const ids = new Set<string>();
  for (const c of evalSet.cases) {
    assert.ok(!ids.has(c.id), `duplicate case id: ${c.id}`);
    ids.add(c.id);
  }
});

test("when chosenCandidateId is set, it appears in the case's candidates[]", () => {
  for (const c of evalSet.cases) {
    const chosen = c.expectedDecision.chosenCandidateId;
    if (!chosen) continue;
    const candidates = c.candidates ?? [];
    if (candidates.length === 0) continue; // legacy cases with no candidates[] block
    const ids = candidates.map((cd) => cd.candidateId);
    assert.ok(
      ids.includes(chosen) || chosen === "postpone-tomorrow" || chosen === "optimizer-base",
      `${c.id}: chosenCandidateId=${chosen} not in candidates [${ids.join(",")}]`,
    );
  }
});

// Compile-time assertion: the EvalCase import resolves. If types.ts is moved
// or the symbol is renamed, this line fails to compile.
const _evalCaseTypeReachable: EvalCase | undefined = undefined;
void _evalCaseTypeReachable;
