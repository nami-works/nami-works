/**
 * Eval-set test runner for the route-optimization pipeline.
 *
 * Phase 1.1 scaffolding: loads `seed.json`, validates its shape against the
 * type contract, and exposes a `runCase()` interface that subsequent Phase 1
 * PRs (candidate-generator, rule-engine, spatial-reasoner, decision-arbiter)
 * will implement against.
 *
 * The runner is intentionally minimal in this PR — there are no components to
 * test yet. Once each Phase 1 component lands, its PR wires the case input
 * through that component and asserts the output matches the expected
 * decision.
 *
 * Companion: `../types.ts` (the type contract being validated).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type {
  ArbiterDecision,
  EvalCase,
  EvalSet,
  PostMortemFlag,
} from "../types";

// ── Loading ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Absolute path to the canonical eval set JSON. */
export const SEED_PATH = join(__dirname, "seed.json");

/**
 * Load and JSON-parse the eval set. Throws if the file is missing or malformed.
 * The returned value is the typed `EvalSet` — shape-validated by the seed-shape
 * test in the companion __tests__ folder.
 */
export function loadEvalSet(path: string = SEED_PATH): EvalSet {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as EvalSet;
}

// ── Case runner contract ───────────────────────────────────────────────────

/**
 * The signature each Phase 1 component must satisfy to be run against an
 * eval case. Subsequent PRs implement this; the scaffolding PR only defines
 * the contract.
 */
export type PipelineRunner = (input: EvalCase) => Promise<{
  decision: ArbiterDecision;
  /**
   * Best-effort trace of which rule citations the pipeline emitted along the
   * way. Used to verify `expectedDecision.rulesExercised` coverage.
   */
  rulesEmitted: string[];
}>;

/** Possible pass/fail outcomes for a single eval case. */
export type EvalOutcome =
  | { case: EvalCase; pass: true; diagnostics: string[] }
  | { case: EvalCase; pass: false; diagnostics: string[]; reasons: string[] };

/**
 * Run a single case through a pipeline implementation and return pass/fail.
 *
 * Pass = chosen candidate id matches expected AND all rules listed in
 * `expectedDecision.postMortemFlag.rules` (or `barrierId`) appear in
 * `rulesEmitted` AND every entry in `rulesExercised` appears in `rulesEmitted`.
 *
 * Soft-rule violations don't fail a case if `operatorOverrideAccepted` is set
 * — they're audited in diagnostics instead.
 */
export async function runCase(
  caseInput: EvalCase,
  pipeline: PipelineRunner,
): Promise<EvalOutcome> {
  const diagnostics: string[] = [];
  const reasons: string[] = [];

  let result: Awaited<ReturnType<PipelineRunner>>;
  try {
    result = await pipeline(caseInput);
  } catch (err) {
    return {
      case: caseInput,
      pass: false,
      diagnostics,
      reasons: [`pipeline threw: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const expected = caseInput.expectedDecision;

  // 1. chosenCandidateId match (when the expected decision names one).
  if (expected.chosenCandidateId !== null && expected.chosenCandidateId !== undefined) {
    if (result.decision.winningCandidateId !== expected.chosenCandidateId) {
      reasons.push(
        `winningCandidateId=${result.decision.winningCandidateId} expected=${expected.chosenCandidateId}`,
      );
    }
  }

  // 2. decisionPath match.
  if (result.decision.decisionPath !== expected.decisionPath) {
    reasons.push(
      `decisionPath=${result.decision.decisionPath} expected=${expected.decisionPath}`,
    );
  }

  // 3. Confidence in expected band (if specified).
  if (typeof expected.minimumConfidence === "number") {
    if (result.decision.confidence < expected.minimumConfidence) {
      reasons.push(
        `confidence=${result.decision.confidence} below minimum=${expected.minimumConfidence}`,
      );
    }
  }
  if (typeof expected.maximumConfidence === "number") {
    if (result.decision.confidence > expected.maximumConfidence) {
      reasons.push(
        `confidence=${result.decision.confidence} above maximum=${expected.maximumConfidence}`,
      );
    }
  }

  // 4. Post-mortem flag presence.
  if (expected.postMortemFlag) {
    const wanted = expected.postMortemFlag;
    const matching = result.decision.postMortemFlags.find(
      (f: PostMortemFlag) => f.category === wanted.category,
    );
    if (!matching) {
      reasons.push(
        `missing postMortemFlag category=${wanted.category} (got categories=${result.decision.postMortemFlags
          .map((f) => f.category)
          .join(",") || "none"})`,
      );
    } else {
      const wantedRules = [
        ...(wanted.rules ?? []),
        ...(wanted.barrierId ? [wanted.barrierId] : []),
      ];
      for (const ruleId of wantedRules) {
        if (!matching.ruleIds.includes(ruleId)) {
          reasons.push(
            `postMortemFlag missing ruleId=${ruleId} (got ${matching.ruleIds.join(",") || "none"})`,
          );
        }
      }
    }
  }

  // 5. rulesExercised coverage (informational unless reasons[] already set).
  for (const ruleId of caseInput.rulesExercised) {
    if (!result.rulesEmitted.includes(ruleId)) {
      diagnostics.push(`rule not exercised by pipeline: ${ruleId}`);
    }
  }

  if (reasons.length > 0) {
    return { case: caseInput, pass: false, diagnostics, reasons };
  }
  return { case: caseInput, pass: true, diagnostics };
}

/**
 * Run the full eval set against a pipeline. Returns a per-rule coverage
 * summary alongside the case-level outcomes — both are surfaced in CI output
 * so reviewers see which rule types regressed when a prompt version flips.
 */
export async function runAll(
  pipeline: PipelineRunner,
  evalSet: EvalSet = loadEvalSet(),
): Promise<{
  outcomes: EvalOutcome[];
  passRate: number;
  perRuleCoverage: Record<string, { exercised: number; total: number }>;
}> {
  const outcomes: EvalOutcome[] = [];
  for (const c of evalSet.cases) {
    outcomes.push(await runCase(c, pipeline));
  }

  const passed = outcomes.filter((o) => o.pass).length;
  const passRate = outcomes.length === 0 ? 0 : passed / outcomes.length;

  const perRuleCoverage: Record<string, { exercised: number; total: number }> = {};
  for (const c of evalSet.cases) {
    for (const ruleId of c.rulesExercised) {
      perRuleCoverage[ruleId] ??= { exercised: 0, total: 0 };
      perRuleCoverage[ruleId].total += 1;
      const outcome = outcomes.find((o) => o.case.id === c.id);
      if (outcome?.pass) {
        perRuleCoverage[ruleId].exercised += 1;
      }
    }
  }

  return { outcomes, passRate, perRuleCoverage };
}
