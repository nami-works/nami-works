/**
 * Unit tests for spatial-reasoner.server.ts.
 *
 * The production Reasoner (reasoner-anthropic.server.ts) is NOT tested here
 * — that would require an Anthropic API key. The orchestrator + JSON parse
 * + validation + fallback logic is what matters in CI.
 *
 * Run: npx tsx --test app/services/route-optimization/__tests__/spatial-reasoner.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  buildUserMessage,
  geofenceExcerptForMarket,
  isValidSpatialReasonerOutput,
  parseStrictJson,
  reasonAboutCandidates,
  type Reasoner,
  type ReasonerOrchestratorInput,
} from "../spatial-reasoner.server";
import { loadV1Prompt } from "../prompts/loader";
import type {
  Candidate,
  CandidateOrderInput,
  Coordinate,
  GeofenceRegistry,
  QuoteResult,
  RuleResult,
  SpatialReasonerOutput,
} from "../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const registry = JSON.parse(
  readFileSync(join(__dirname, "..", "geofences", "brazil.json"), "utf8"),
) as GeofenceRegistry;

const PICKUP: Coordinate = { latitude: -22.957, longitude: -43.176 };

function order(name: string, lat: number, lng: number, neighborhood?: string): CandidateOrderInput {
  return { name, coordinates: { latitude: lat, longitude: lng }, neighborhood };
}

function candidate(id: string, type: Candidate["candidateType"], slots: string[][]): Candidate {
  return {
    candidateId: id,
    candidateType: type,
    clustering: slots.map((ids, slot) => ({ slot, orderIds: ids })),
  };
}

function quoteOk(id: string, totalSubunits: number): QuoteResult {
  return {
    candidateId: id,
    ok: true,
    routes: [],
    grandTotalSubunits: totalSubunits,
    grandTotalDisplay: (totalSubunits / 100).toFixed(2),
    grandTotalCurrency: "BRL",
  };
}

function ruleClear(id: string): RuleResult {
  return { candidateId: id, ruleViolations: [], rulesPassed: [], severityVerdict: "clear" };
}

function ruleSoft(id: string, violationId = "rio-guanabara-bay"): RuleResult {
  return {
    candidateId: id,
    ruleViolations: [
      {
        ruleId: violationId,
        severity: "soft",
        explanation: "x",
        citation: "y",
      },
    ],
    rulesPassed: [],
    severityVerdict: "soft-violation",
  };
}

function validReasonerOutput(
  recommendedId: string,
  confidence = 0.9,
): SpatialReasonerOutput {
  return {
    candidates: [
      {
        candidateId: recommendedId,
        score: confidence,
        commentary: "ok",
        barrierCrossings: [],
        corridorMatches: [],
        outlierFlags: [],
        ruleEngineAgreement: "agrees",
      },
    ],
    recommendedCandidateId: recommendedId,
    confidence,
    globalCommentary: "fine",
    postMortemFlags: [],
    promptVersion: "v1",
  };
}

function buildBaseInput(reasoner: Reasoner): ReasonerOrchestratorInput {
  const cands = [
    candidate("a", "optimizer-base", [["1", "2"]]),
    candidate("b", "split-outliers", [["1"], ["2"]]),
  ];
  return {
    candidates: cands,
    rules: [ruleSoft("a"), ruleClear("b")],
    quotes: [quoteOk("a", 4495), quoteOk("b", 6509)],
    orders: [order("1", -22.97, -43.21, "Lagoa"), order("2", -22.89, -43.12, "Niterói Centro")],
    pickupCoordinates: PICKUP,
    market: "rio-de-janeiro",
    locationName: "RioSul",
    geofenceRegistry: registry,
    systemPrompt: "test prompt",
    promptVersion: "v1",
    reasoner,
    dateIso: "2026-05-12",
  };
}

// ── Prompt loader ──────────────────────────────────────────────────────────

test("loadV1Prompt extracts the verbatim system prompt", () => {
  const loaded = loadV1Prompt();
  assert.equal(loaded.version, "v1");
  assert.ok(loaded.systemPrompt.length > 200, "prompt should be substantial");
  // Spot-check a known phrase from the verbatim block.
  assert.ok(
    loaded.systemPrompt.includes("delivery-route optimization reviewer"),
    "expected verbatim block to start with role description",
  );
});

// ── Geofence excerpt ───────────────────────────────────────────────────────

test("geofenceExcerptForMarket filters info-only barriers out", () => {
  const excerpt = geofenceExcerptForMarket(registry, "rio-de-janeiro");
  const ids = excerpt.barriers.map((b) => b.id);
  assert.ok(ids.includes("rio-guanabara-bay"), "should include soft barriers");
  assert.equal(
    ids.includes("recife-rivers-capibaribe-beberibe"),
    false,
    "should not include info-only barriers",
  );
});

test("geofenceExcerptForMarket picks per-metro outlier threshold", () => {
  const rio = geofenceExcerptForMarket(registry, "rio-de-janeiro");
  const sp = geofenceExcerptForMarket(registry, "sao-paulo");
  // Rio is tighter (1.8×) than SP (2.0×).
  assert.ok(rio.outlierThreshold.multiplierOverMedianCentroidDistance < sp.outlierThreshold.multiplierOverMedianCentroidDistance);
});

// ── User message rendering ─────────────────────────────────────────────────

test("buildUserMessage includes location, candidates, rules, geofence excerpt", () => {
  const reasoner: Reasoner = async () => ({ ok: false, reason: "api_failure" });
  const input = buildBaseInput(reasoner);
  const msg = buildUserMessage(input);
  assert.ok(msg.includes("RioSul"));
  assert.ok(msg.includes("2026-05-12"));
  assert.ok(msg.includes("rio-guanabara-bay"));
  assert.ok(msg.includes("split-outliers"));
  assert.ok(msg.includes("[NO map PNG attached]"));
});

test("buildUserMessage marks the PNG attached when one is provided", () => {
  const reasoner: Reasoner = async () => ({ ok: false, reason: "api_failure" });
  const input = { ...buildBaseInput(reasoner), pngUrl: "https://example.com/map.png" };
  const msg = buildUserMessage(input);
  assert.ok(msg.includes("[ATTACHED: route map PNG]"));
});

// ── JSON parse ─────────────────────────────────────────────────────────────

test("parseStrictJson accepts a clean JSON payload", () => {
  const result = parseStrictJson(JSON.stringify(validReasonerOutput("a")));
  assert.equal(result.ok, true);
});

test("parseStrictJson accepts payload wrapped in a json fence", () => {
  const fenced = "```json\n" + JSON.stringify(validReasonerOutput("a")) + "\n```";
  const result = parseStrictJson(fenced);
  assert.equal(result.ok, true);
});

test("parseStrictJson detects UNPARSEABLE sentinel", () => {
  const result = parseStrictJson("UNPARSEABLE");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "unparseable_sentinel");
});

test("parseStrictJson catches malformed JSON", () => {
  const result = parseStrictJson("{ not really json");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "json_parse_failure");
});

test("parseStrictJson catches schema mismatch", () => {
  const result = parseStrictJson(JSON.stringify({ recommendedCandidateId: "a" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "validation_failure");
});

test("isValidSpatialReasonerOutput rejects out-of-range confidence", () => {
  const bad = { ...validReasonerOutput("a"), confidence: 1.5 };
  assert.equal(isValidSpatialReasonerOutput(bad), false);
});

// ── Orchestrator: Haiku-only happy path ────────────────────────────────────

test("Haiku-only path: high-confidence output returns immediately", async () => {
  let calls = 0;
  const reasoner: Reasoner = async () => {
    calls += 1;
    return {
      ok: true,
      rawText: "x",
      parsed: validReasonerOutput("a", 0.9),
      modelActual: "claude-haiku-4-5-20251001",
    };
  };
  const out = await reasonAboutCandidates(buildBaseInput(reasoner));
  assert.equal(calls, 1, "only Haiku should be called");
  assert.equal(out.diagnostics.finalModel, "haiku");
  assert.equal(out.output.recommendedCandidateId, "a");
});

// ── Orchestrator: confidence escalation to Sonnet ──────────────────────────

test("Low Haiku confidence escalates to Sonnet", async () => {
  const calls: string[] = [];
  const reasoner: Reasoner = async (input) => {
    calls.push(input.model);
    if (input.model === "haiku") {
      return {
        ok: true,
        rawText: "h",
        parsed: validReasonerOutput("a", 0.5),
        modelActual: "claude-haiku-4-5-20251001",
      };
    }
    return {
      ok: true,
      rawText: "s",
      parsed: validReasonerOutput("b", 0.92),
      modelActual: "claude-sonnet-4-6",
    };
  };
  const out = await reasonAboutCandidates(buildBaseInput(reasoner));
  assert.deepEqual(calls, ["haiku", "sonnet"]);
  assert.equal(out.diagnostics.finalModel, "sonnet");
  assert.equal(out.output.recommendedCandidateId, "b");
});

// ── Orchestrator: retry on validation failure ──────────────────────────────

test("validation failure on Haiku triggers a single Haiku retry", async () => {
  let haikuCalls = 0;
  const reasoner: Reasoner = async (input) => {
    if (input.model === "haiku") {
      haikuCalls += 1;
      if (haikuCalls === 1) {
        return { ok: false, reason: "validation_failure", rawText: "junk" };
      }
      return {
        ok: true,
        rawText: "ok-on-retry",
        parsed: validReasonerOutput("a", 0.9),
        modelActual: "claude-haiku-4-5-20251001",
      };
    }
    throw new Error("should not call sonnet");
  };
  const out = await reasonAboutCandidates(buildBaseInput(reasoner));
  assert.equal(haikuCalls, 2);
  assert.equal(out.diagnostics.finalModel, "haiku");
});

// ── Orchestrator: Sonnet also fails → reuse Haiku low-conf with flag ───────

test("Sonnet failure reuses low-conf Haiku output and adds review-recommended flag", async () => {
  const reasoner: Reasoner = async (input) => {
    if (input.model === "haiku") {
      return {
        ok: true,
        rawText: "h",
        parsed: validReasonerOutput("a", 0.4),
        modelActual: "claude-haiku-4-5-20251001",
      };
    }
    return { ok: false, reason: "api_failure", errorDetail: "boom" };
  };
  const out = await reasonAboutCandidates(buildBaseInput(reasoner));
  assert.equal(out.output.recommendedCandidateId, "a");
  const hasFallbackFlag = out.output.postMortemFlags.some(
    (f) => f.category === "low-confidence-decision",
  );
  assert.ok(hasFallbackFlag, "should add a low-confidence flag");
});

// ── Orchestrator: both fail → synthetic fallback ──────────────────────────

test("Total reasoner failure falls back to synthetic — picks cheapest non-hard-violation", async () => {
  const reasoner: Reasoner = async () => ({
    ok: false,
    reason: "api_failure",
    errorDetail: "down",
  });
  const out = await reasonAboutCandidates(buildBaseInput(reasoner));
  assert.equal(out.diagnostics.fellBackToSynthetic, true);
  // candidate "a" is R$44.95, "b" is R$65.09 (set in buildBaseInput). Cheapest is "a".
  // But "a" has soft-violation — that's still ELIGIBLE (only hard-violation excludes).
  assert.equal(out.output.recommendedCandidateId, "a");
  // recommendation is never null even on total failure
  assert.notEqual(out.output.recommendedCandidateId, null);
});

test("Synthetic fallback skips candidates with hard-violation", async () => {
  const reasoner: Reasoner = async () => ({ ok: false, reason: "timeout" });
  const base = buildBaseInput(reasoner);
  base.rules = [
    {
      candidateId: "a",
      ruleViolations: [
        { ruleId: "hard-7-cap", severity: "hard", explanation: "x", citation: "y" },
      ],
      rulesPassed: [],
      severityVerdict: "hard-violation",
    },
    ruleClear("b"),
  ];
  // Now a has hard violation, b is clear. Synthetic must pick b.
  const out = await reasonAboutCandidates(base);
  assert.equal(out.output.recommendedCandidateId, "b");
});
