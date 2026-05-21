/**
 * Test: KPI Computation Logic
 *
 * Validates the affiliate dashboard KPI calculations using mock data.
 * Tests the same math used in analytics-queries.server.ts without needing a DB.
 */

// ─── Mock data types (mirrors DB row shapes) ────────────────────────────────

type MockAffiliateMonthly = {
  orderCount: number;
  revenue: number;
  subtotal: number;
  affiliateDiscountTotal: number;
  siteDiscountTotal: number;
  commissionTotal: number;
  uniqueCustomers: number;
  newCustomers: number;
  repeatCustomers: number;
};

type MockOrganicAgg = {
  orderCount: number;
  revenue: number;
  subtotal: number;
  siteDiscountTotal: number;
  uniqueCustomers: number;
  repeatCustomers: number;
};

// ─── KPI computation functions (extracted from analytics-queries.server.ts) ──

function computeKPIs(aff: MockAffiliateMonthly, org: MockOrganicAgg) {
  const totalRevenue = aff.revenue + org.revenue;

  // Revenue split
  const affiliateSharePct = totalRevenue > 0 ? (aff.revenue / totalRevenue) * 100 : 0;

  // AOV
  const affAOV = aff.orderCount > 0 ? aff.revenue / aff.orderCount : 0;
  const orgAOV = org.orderCount > 0 ? org.revenue / org.orderCount : 0;

  // Repeat rate
  const affRepeatPct = aff.uniqueCustomers > 0
    ? (aff.repeatCustomers / aff.uniqueCustomers) * 100
    : 0;
  const orgRepeatPct = org.uniqueCustomers > 0
    ? (org.repeatCustomers / org.uniqueCustomers) * 100
    : 0;

  // Commission ROAS
  const totalCost = aff.commissionTotal + aff.affiliateDiscountTotal;
  const affiliateROAS = totalCost > 0 ? aff.revenue / totalCost : 0;

  // CAC
  const affiliateCAC = aff.newCustomers > 0 ? totalCost / aff.newCustomers : 0;

  // Margin waterfall
  const affMarginPct = aff.subtotal > 0
    ? ((aff.subtotal - aff.commissionTotal - aff.affiliateDiscountTotal) / aff.subtotal) * 100
    : 0;
  const orgMarginPct = org.subtotal > 0
    ? ((org.subtotal - org.siteDiscountTotal) / org.subtotal) * 100
    : 0;

  // Net margin (absolute)
  const netMargin = aff.subtotal - aff.affiliateDiscountTotal - aff.commissionTotal;

  // LTV
  const affiliateLTV = aff.uniqueCustomers > 0 ? aff.revenue / aff.uniqueCustomers : 0;
  const organicLTV = org.uniqueCustomers > 0 ? org.revenue / org.uniqueCustomers : 0;

  return {
    totalRevenue,
    affiliateSharePct,
    affAOV,
    orgAOV,
    affRepeatPct,
    orgRepeatPct,
    affiliateROAS,
    affiliateCAC,
    affMarginPct,
    orgMarginPct,
    netMargin,
    totalCost,
    affiliateLTV,
    organicLTV,
  };
}

function computeDelta(current: number, previous: number | null): number | undefined {
  if (previous == null || previous === 0) return undefined;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ─── Test Runner ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function approxEqual(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function runKpiLogicTests(): { passed: number; failed: number } {
  passed = 0;
  failed = 0;

  console.log("\n=== KPI Logic Tests ===\n");

  // ─── Mock data ───
  const aff: MockAffiliateMonthly = {
    orderCount: 150,
    revenue: 45000,
    subtotal: 50000,
    affiliateDiscountTotal: 5000,
    siteDiscountTotal: 2000,
    commissionTotal: 4500,
    uniqueCustomers: 120,
    newCustomers: 80,
    repeatCustomers: 40,
  };

  const org: MockOrganicAgg = {
    orderCount: 300,
    revenue: 90000,
    subtotal: 95000,
    siteDiscountTotal: 5000,
    uniqueCustomers: 250,
    repeatCustomers: 100,
  };

  const kpi = computeKPIs(aff, org);

  // (a) Revenue split: affiliate + organic = total
  assert(
    `Revenue split: aff(${aff.revenue}) + org(${org.revenue}) = total(${kpi.totalRevenue})`,
    kpi.totalRevenue === aff.revenue + org.revenue,
  );
  assert(
    `Affiliate share = ${kpi.affiliateSharePct.toFixed(2)}% (expected ~33.33%)`,
    approxEqual(kpi.affiliateSharePct, (45000 / 135000) * 100),
    `Got ${kpi.affiliateSharePct}`,
  );

  // (b) AOV: revenue / orderCount
  assert(
    `Affiliate AOV = ${kpi.affAOV} (expected 300)`,
    approxEqual(kpi.affAOV, 300),
    `Got ${kpi.affAOV}`,
  );
  assert(
    `Organic AOV = ${kpi.orgAOV} (expected 300)`,
    approxEqual(kpi.orgAOV, 300),
    `Got ${kpi.orgAOV}`,
  );

  // (c) Repeat rate: repeatCustomers / uniqueCustomers * 100
  assert(
    `Affiliate repeat rate = ${kpi.affRepeatPct.toFixed(2)}% (expected 33.33%)`,
    approxEqual(kpi.affRepeatPct, (40 / 120) * 100),
    `Got ${kpi.affRepeatPct}`,
  );
  assert(
    `Organic repeat rate = ${kpi.orgRepeatPct.toFixed(2)}% (expected 40%)`,
    approxEqual(kpi.orgRepeatPct, (100 / 250) * 100),
    `Got ${kpi.orgRepeatPct}`,
  );

  // (d) Commission ROAS: revenue / (commission + affiliateDiscount)
  const expectedROAS = 45000 / (4500 + 5000); // 45000 / 9500 = 4.7368...
  assert(
    `ROAS = ${kpi.affiliateROAS.toFixed(4)} (expected ${expectedROAS.toFixed(4)})`,
    approxEqual(kpi.affiliateROAS, expectedROAS),
    `Got ${kpi.affiliateROAS}`,
  );

  // (e) CAC: (commission + affiliateDiscount) / newCustomers
  const expectedCAC = (4500 + 5000) / 80; // 9500 / 80 = 118.75
  assert(
    `CAC = ${kpi.affiliateCAC.toFixed(2)} (expected ${expectedCAC.toFixed(2)})`,
    approxEqual(kpi.affiliateCAC, expectedCAC),
    `Got ${kpi.affiliateCAC}`,
  );

  // (f) Margin waterfall: subtotal - affiliateDiscount - commission = netMargin
  const expectedNetMargin = 50000 - 5000 - 4500; // 40500
  assert(
    `Net margin = ${kpi.netMargin} (expected ${expectedNetMargin})`,
    kpi.netMargin === expectedNetMargin,
    `Got ${kpi.netMargin}`,
  );
  const expectedAffMarginPct = (40500 / 50000) * 100; // 81%
  assert(
    `Affiliate margin % = ${kpi.affMarginPct.toFixed(2)}% (expected ${expectedAffMarginPct.toFixed(2)}%)`,
    approxEqual(kpi.affMarginPct, expectedAffMarginPct),
    `Got ${kpi.affMarginPct}`,
  );
  const expectedOrgMarginPct = ((95000 - 5000) / 95000) * 100; // 94.74%
  assert(
    `Organic margin % = ${kpi.orgMarginPct.toFixed(2)}% (expected ${expectedOrgMarginPct.toFixed(2)}%)`,
    approxEqual(kpi.orgMarginPct, expectedOrgMarginPct),
    `Got ${kpi.orgMarginPct}`,
  );

  // (g) Comparison deltas: (current - previous) / previous * 100
  console.log("\n  --- Delta computation tests ---");

  const delta1 = computeDelta(300, 250);
  assert(
    `Delta: 300 vs 250 = +20% (got ${delta1?.toFixed(2)}%)`,
    delta1 !== undefined && approxEqual(delta1, 20),
    `Got ${delta1}`,
  );

  const delta2 = computeDelta(200, 400);
  assert(
    `Delta: 200 vs 400 = -50% (got ${delta2?.toFixed(2)}%)`,
    delta2 !== undefined && approxEqual(delta2, -50),
    `Got ${delta2}`,
  );

  const delta3 = computeDelta(100, 0);
  assert(
    `Delta: 100 vs 0 = undefined (division by zero guard)`,
    delta3 === undefined,
    `Got ${delta3}`,
  );

  const delta4 = computeDelta(100, null);
  assert(
    `Delta: 100 vs null = undefined (no comparison data)`,
    delta4 === undefined,
    `Got ${delta4}`,
  );

  const delta5 = computeDelta(50, -100);
  assert(
    `Delta: 50 vs -100 = +150% (uses Math.abs for denominator, got ${delta5?.toFixed(2)}%)`,
    delta5 !== undefined && approxEqual(delta5, 150),
    `Got ${delta5}`,
  );

  // ─── Edge cases ───
  console.log("\n  --- Edge case tests ---");

  const zeroAff: MockAffiliateMonthly = {
    orderCount: 0, revenue: 0, subtotal: 0,
    affiliateDiscountTotal: 0, siteDiscountTotal: 0, commissionTotal: 0,
    uniqueCustomers: 0, newCustomers: 0, repeatCustomers: 0,
  };
  const zeroOrg: MockOrganicAgg = {
    orderCount: 0, revenue: 0, subtotal: 0,
    siteDiscountTotal: 0, uniqueCustomers: 0, repeatCustomers: 0,
  };
  const zeroKpi = computeKPIs(zeroAff, zeroOrg);

  assert("Zero data: total revenue = 0", zeroKpi.totalRevenue === 0);
  assert("Zero data: affiliate share = 0%", zeroKpi.affiliateSharePct === 0);
  assert("Zero data: AOV = 0", zeroKpi.affAOV === 0 && zeroKpi.orgAOV === 0);
  assert("Zero data: ROAS = 0", zeroKpi.affiliateROAS === 0);
  assert("Zero data: CAC = 0", zeroKpi.affiliateCAC === 0);
  assert("Zero data: margin = 0%", zeroKpi.affMarginPct === 0 && zeroKpi.orgMarginPct === 0);

  // LTV tests
  console.log("\n  --- LTV tests ---");
  assert(
    `Affiliate LTV = ${kpi.affiliateLTV.toFixed(2)} (expected ${(45000/120).toFixed(2)})`,
    approxEqual(kpi.affiliateLTV, 45000 / 120),
    `Got ${kpi.affiliateLTV}`,
  );
  assert(
    `Organic LTV = ${kpi.organicLTV.toFixed(2)} (expected ${(90000/250).toFixed(2)})`,
    approxEqual(kpi.organicLTV, 90000 / 250),
    `Got ${kpi.organicLTV}`,
  );

  console.log(`\n  KPI Logic: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

// Allow direct execution
const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`;
if (isMain) {
  runKpiLogicTests();
}
