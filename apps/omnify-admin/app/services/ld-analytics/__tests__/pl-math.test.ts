/**
 * Unit tests for app/services/ld-analytics/pl-math.server.ts.
 *
 * Run: npx tsx --test app/services/ld-analytics/__tests__/pl-math.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  plImpact,
  revenueRetained,
  netCostDelta,
  frame,
  sumInputs,
  ldNet,
  whNet,
  isFraming,
  FRAMINGS,
  type OrderInputs,
} from "../pl-math.server";

// Standard order: customer paid R$ 15 for LD, route cost R$ 25, warehouse would
// have charged the customer R$ 22 and cost the merchant R$ 28. Tax savings R$ 3.
const standard: OrderInputs = {
  ldRevenueSubunits: 1500,
  ldCarrierCostSubunits: 2500,
  warehouseCounterfactualSubunits: 2800,
  warehouseCustomerRateSubunits: 2200,
  taxSavingsSubunits: 300,
};

test("plImpact — standard order", () => {
  // ldNet  = 1500 + 300 - 2500 = -700
  // whNet  = 2200 - 2800       = -600
  // delta  = -700 - (-600)     = -100
  assert.equal(plImpact(standard), -100);
});

test("revenueRetained — standard order", () => {
  // 2200 - 1500 = 700 retained
  assert.equal(revenueRetained(standard), 700);
});

test("netCostDelta — standard order", () => {
  // 2500 - 2800 = -300 (LD cheaper by R$ 3)
  assert.equal(netCostDelta(standard), -300);
});

test("ldNet / whNet — standard order", () => {
  assert.equal(ldNet(standard), -700);
  assert.equal(whNet(standard), -600);
});

test("plImpact — free-ship order (LD revenue = 0, WH rate is what customer would have paid)", () => {
  const freeShip: OrderInputs = {
    ldRevenueSubunits: 0,
    ldCarrierCostSubunits: 2500,
    warehouseCounterfactualSubunits: 2800,
    warehouseCustomerRateSubunits: 2200,
    taxSavingsSubunits: 300,
  };
  // ldNet = 0 + 300 - 2500 = -2200
  // whNet = 2200 - 2800    = -600
  // delta = -2200 - (-600) = -1600
  assert.equal(plImpact(freeShip), -1600);
});

test("revenueRetained — free-ship order", () => {
  const freeShip: OrderInputs = {
    ldRevenueSubunits: 0,
    ldCarrierCostSubunits: 2500,
    warehouseCounterfactualSubunits: 2800,
    warehouseCustomerRateSubunits: 2200,
    taxSavingsSubunits: 0,
  };
  // 2200 - 0 = 2200 retained (full WH rate is the "savings" merchant gave)
  assert.equal(revenueRetained(freeShip), 2200);
});

test("zero tax savings still computes plImpact correctly", () => {
  const noTax: OrderInputs = { ...standard, taxSavingsSubunits: 0 };
  // ldNet = 1500 + 0 - 2500 = -1000
  // whNet = -600
  // delta = -1000 - (-600)  = -400
  assert.equal(plImpact(noTax), -400);
});

test("plImpact — LD wins (cheaper LD route, retained revenue)", () => {
  const ldWins: OrderInputs = {
    ldRevenueSubunits: 2500,
    ldCarrierCostSubunits: 1800,
    warehouseCounterfactualSubunits: 3000,
    warehouseCustomerRateSubunits: 2500,
    taxSavingsSubunits: 500,
  };
  // ldNet = 2500 + 500 - 1800 = 1200
  // whNet = 2500 - 3000       = -500
  // delta = 1200 - (-500)     = 1700
  assert.equal(plImpact(ldWins), 1700);
});

test("frame() dispatches to the right framing function", () => {
  assert.equal(frame("pl_impact", standard), plImpact(standard));
  assert.equal(frame("revenue_retained", standard), revenueRetained(standard));
  assert.equal(frame("net_cost_delta", standard), netCostDelta(standard));
});

test("frame() falls back to plImpact for unknown framings", () => {
  assert.equal(frame("nonsense", standard), plImpact(standard));
  assert.equal(frame("", standard), plImpact(standard));
});

test("isFraming type guard", () => {
  assert.equal(isFraming("pl_impact"), true);
  assert.equal(isFraming("revenue_retained"), true);
  assert.equal(isFraming("net_cost_delta"), true);
  assert.equal(isFraming("nonsense"), false);
  assert.equal(isFraming(null), false);
  assert.equal(isFraming(undefined), false);
  assert.equal(isFraming(42), false);
});

test("FRAMINGS list is the canonical 3", () => {
  assert.deepEqual([...FRAMINGS], ["pl_impact", "revenue_retained", "net_cost_delta"]);
});

test("sumInputs — empty list", () => {
  const sum = sumInputs([]);
  assert.equal(sum.ldRevenueSubunits, 0);
  assert.equal(sum.ldCarrierCostSubunits, 0);
  assert.equal(sum.warehouseCounterfactualSubunits, 0);
  assert.equal(sum.warehouseCustomerRateSubunits, 0);
  assert.equal(sum.taxSavingsSubunits, 0);
});

test("sumInputs — multiple orders", () => {
  const sum = sumInputs([standard, standard, standard]);
  assert.equal(sum.ldRevenueSubunits, 4500);
  assert.equal(sum.ldCarrierCostSubunits, 7500);
  assert.equal(sum.warehouseCounterfactualSubunits, 8400);
  assert.equal(sum.warehouseCustomerRateSubunits, 6600);
  assert.equal(sum.taxSavingsSubunits, 900);

  // plImpact of the sum equals 3x of one (linearity sanity check)
  assert.equal(plImpact(sum), 3 * plImpact(standard));
});

test("sumInputs — mixed orders", () => {
  const a: OrderInputs = {
    ldRevenueSubunits: 1000,
    ldCarrierCostSubunits: 1500,
    warehouseCounterfactualSubunits: 2000,
    warehouseCustomerRateSubunits: 1800,
    taxSavingsSubunits: 100,
  };
  const b: OrderInputs = {
    ldRevenueSubunits: 500,
    ldCarrierCostSubunits: 800,
    warehouseCounterfactualSubunits: 1200,
    warehouseCustomerRateSubunits: 1100,
    taxSavingsSubunits: 50,
  };
  const sum = sumInputs([a, b]);
  assert.equal(sum.ldRevenueSubunits, 1500);
  assert.equal(sum.ldCarrierCostSubunits, 2300);
  assert.equal(sum.warehouseCounterfactualSubunits, 3200);
  assert.equal(sum.warehouseCustomerRateSubunits, 2900);
  assert.equal(sum.taxSavingsSubunits, 150);
});
