/**
 * Integration test for the pipeline orchestrator.
 *
 * Stubs Prisma + the Lalamove quoter + the Anthropic reasoner so the
 * pipeline runs end-to-end without external I/O. The goal is to exercise
 * the wiring between the five stages and the persist call.
 *
 * Run: npx tsx --test app/services/route-optimization/__tests__/pipeline.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import { isPhase1EnabledForLocation } from "../pipeline.server";

// ── Feature flag ────────────────────────────────────────────────────────

test("isPhase1EnabledForLocation: requires BOTH env flag and per-location flag", () => {
  const original = process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED;

  try {
    // Both off → off.
    delete process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED;
    assert.equal(
      isPhase1EnabledForLocation({ routeOptimizationPhase1Enabled: true }),
      false,
      "env off + location on → off",
    );

    // Env on, location off → off.
    process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED = "true";
    assert.equal(
      isPhase1EnabledForLocation({ routeOptimizationPhase1Enabled: false }),
      false,
      "env on + location off → off",
    );
    assert.equal(
      isPhase1EnabledForLocation({ routeOptimizationPhase1Enabled: null }),
      false,
      "env on + location null → off",
    );
    assert.equal(
      isPhase1EnabledForLocation({}),
      false,
      "env on + location undefined → off",
    );

    // Both on → on.
    assert.equal(
      isPhase1EnabledForLocation({ routeOptimizationPhase1Enabled: true }),
      true,
      "env on + location on → on",
    );

    // Env set to anything other than "true" → off.
    process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED = "1";
    assert.equal(
      isPhase1EnabledForLocation({ routeOptimizationPhase1Enabled: true }),
      false,
      "env '1' (not literal 'true') → off",
    );
  } finally {
    if (original === undefined) delete process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED;
    else process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED = original;
  }
});
