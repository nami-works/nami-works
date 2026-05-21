/**
 * Affiliates — Analytics queries
 *
 * Rebuilds monthly aggregates and computes dashboard stats from
 * the normalized AffiliateOrder / AffiliateOrganicAgg / AffiliateMonthly tables.
 */
import prisma from "../db.server";
import {
  FLAG_LEAKAGE_PCT,
  FLAG_LOYALTY_LIFT_PP,
  FLAG_MIN_CUSTOMERS,
} from "./classification-thresholds";

// ─── Rebuild monthly aggregates ─────────────────────────────────────────────

export async function rebuildAffiliateMonthly(shop: string): Promise<void> {
  const shopEsc = shop.replace(/'/g, "''");

  // Atomic DELETE + INSERT inside a transaction to prevent data loss on crash
  await prisma.$transaction(async (tx) => {
    // Delete existing
    await tx.$executeRawUnsafe(
      `DELETE FROM "AffiliateMonthly" WHERE "shop" = '${shopEsc}'`,
    );

    // Rebuild from AffiliateOrder joined with AffiliateProfile for commission.
    // newCustomers / repeatCustomers derive from wasPreExistingCustomer, which
    // is populated at sync time from Shopify's customer.firstOrder. A customer
    // whose globally-first order is this affiliate touchpoint counts as "new";
    // a customer with any prior order (organic or other-affiliate) counts as
    // "pre-existing" (repeat-in-the-leakage sense, not repeat-in-loyalty).
    //
    // Commission caveat: ap."commissionPct" is NEVER populated by the BixGrow
    // CSV importer (the export doesn't include it), so this falls back to a
    // 10% default for every affiliate. Margin / CAC / ROAS downstream are
    // therefore estimates, not truth. Labeled honestly in the UI.
    await tx.$executeRawUnsafe(`
      INSERT INTO "AffiliateMonthly" (
        "id", "shop", "affiliateCode", "month",
        "orderCount", "revenue", "subtotal",
        "affiliateDiscountTotal", "siteDiscountTotal",
        "commissionTotal", "uniqueCustomers",
        "newCustomers", "repeatCustomers",
        "avgOrderValue", "currencyCode"
      )
      SELECT
        gen_random_uuid()::text,
        ao."shop",
        ao."affiliateCode",
        TO_CHAR(ao."orderDate", 'YYYY-MM') as month,
        COUNT(*)::int as "orderCount",
        COALESCE(SUM(ao."totalAmount"), 0) as "revenue",
        COALESCE(SUM(ao."subtotalAmount"), 0) as "subtotal",
        COALESCE(SUM(ao."affiliateDiscount"), 0) as "affiliateDiscountTotal",
        COALESCE(SUM(ao."siteDiscount"), 0) as "siteDiscountTotal",
        COALESCE(SUM(ao."totalAmount") * COALESCE(MAX(ap."commissionPct"), 10) / 100, 0) as "commissionTotal",
        COUNT(DISTINCT ao."customerId")::int as "uniqueCustomers",
        COUNT(DISTINCT CASE WHEN ao."wasPreExistingCustomer" = false AND ao."customerId" IS NOT NULL THEN ao."customerId" END)::int as "newCustomers",
        COUNT(DISTINCT CASE WHEN ao."wasPreExistingCustomer" = true AND ao."customerId" IS NOT NULL THEN ao."customerId" END)::int as "repeatCustomers",
        CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(ao."totalAmount"), 0) / COUNT(*) ELSE 0 END as "avgOrderValue",
        MAX(ao."currencyCode") as "currencyCode"
      FROM "AffiliateOrder" ao
      LEFT JOIN "AffiliateProfile" ap ON ap."shop" = ao."shop" AND LOWER(ap."code") = LOWER(ao."affiliateCode")
      WHERE ao."shop" = '${shopEsc}' AND ao."orderDate" IS NOT NULL
      GROUP BY ao."shop", ao."affiliateCode", TO_CHAR(ao."orderDate", 'YYYY-MM')
    `);
  });

  console.info(`[affiliates] rebuildAffiliateMonthly OK shop=${shop}`);
}

// ─── Dashboard Stats ────────────────────────────────────────────────────────

export type AffiliateOverviewStats = {
  currencyCode: string;

  // Row 1: Acquisition & Economics
  revenueImpact: {
    affiliateRevenue: number;
    organicRevenue: number;
    affiliateOrders: number;
    organicOrders: number;
    affiliateSharePct: number;
    delta?: number;
  };
  marginAnalysis: {
    affiliateMarginPct: number;
    organicMarginPct: number;
    affiliateDiscountTotal: number;
    /** Total site discount across both cohorts (legacy) */
    siteDiscountTotal: number;
    commissionTotal: number;
    /** Site discount applied to affiliate-cohort orders only */
    affiliateSiteDiscountTotal: number;
    /** Affiliate-cohort gross sales (subtotal before any discount) */
    affiliateGrossSales: number;
    /** Affiliate-cohort net margin value (subtotal minus discounts minus commission) */
    affiliateNetMargin: number;
    /** Organic-cohort gross sales (subtotal before discount) */
    organicGrossSales: number;
    /** Organic-cohort site discount total */
    organicDiscountTotal: number;
    /** Organic-cohort net margin value */
    organicNetMargin: number;
    delta?: number;
  };
  cac: {
    affiliateCAC: number;
    totalSpent: number;
    newCustomersViaAffiliates: number;
    delta?: number;
  };

  // Row 2: Customer Quality
  ltv: {
    affiliateLTV: number;
    organicLTV: number;
    affiliateCustomers: number;
    organicCustomers: number;
    delta?: number;
  };
  repeatRate: {
    affiliateRepeatPct: number;
    organicRepeatPct: number;
    affiliateRepeat: number;
    affiliateTotal: number;
    delta?: number;
  };
  aov: {
    affiliateAOV: number;
    organicAOV: number;
    delta?: number;
  };

  // Row 3: Program Performance
  leaderboard: Array<{
    code: string;
    affiliateName: string;
    revenue: number;
    orders: number;
    commission: number;
    customers: number;
    // Extended columns for Profiles list quartile bands + row drill-through.
    repeatPct: number;
    aov: number;
    topProductTitle: string | null;
    topProductShare: number;
    instagram: string | null;
    tiktok: string | null;
  }>;
  productMix: Array<{
    title: string;
    productId: string | null;
    quantity: number;
    revenue: number;
  }>;
  roas: {
    affiliateROAS: number;
    totalRevenue: number;
    totalCost: number;
    delta?: number;
  };

  // Trend data
  trend: Array<{
    month: string;
    affiliateRevenue: number;
    organicRevenue: number;
    affiliateOrders: number;
    organicOrders: number;
  }>;
};

function monthBetween(start: string, end: string): string[] {
  const months: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

function toMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export async function getAffiliateDashboardStats(
  shop: string,
  startDate: string,
  endDate: string,
  compStart?: string | null,
  compEnd?: string | null,
  affiliateCode?: string | null,
): Promise<AffiliateOverviewStats> {
  const shopEsc = shop.replace(/'/g, "''");
  const startMonth = toMonthKey(startDate);
  const endMonth = toMonthKey(endDate);
  const monthsInRange = monthBetween(startMonth, endMonth);

  const codeFilter = affiliateCode && affiliateCode !== "all"
    ? `AND LOWER(am."affiliateCode") = '${affiliateCode.toLowerCase().replace(/'/g, "''")}'`
    : "";

  // ─── Current period: Affiliate monthly totals ───
  const affTotalsRows = await prisma.$queryRawUnsafe<
    Array<{
      orderCount: bigint;
      revenue: number;
      subtotal: number;
      affiliateDiscountTotal: number;
      siteDiscountTotal: number;
      commissionTotal: number;
      uniqueCustomers: bigint;
      newCustomers: bigint;
      repeatCustomers: bigint;
      currencyCode: string | null;
    }>
  >(`
    SELECT
      COALESCE(SUM(am."orderCount"), 0)::bigint as "orderCount",
      COALESCE(SUM(am."revenue"), 0) as "revenue",
      COALESCE(SUM(am."subtotal"), 0) as "subtotal",
      COALESCE(SUM(am."affiliateDiscountTotal"), 0) as "affiliateDiscountTotal",
      COALESCE(SUM(am."siteDiscountTotal"), 0) as "siteDiscountTotal",
      COALESCE(SUM(am."commissionTotal"), 0) as "commissionTotal",
      COALESCE(SUM(am."uniqueCustomers"), 0)::bigint as "uniqueCustomers",
      COALESCE(SUM(am."newCustomers"), 0)::bigint as "newCustomers",
      COALESCE(SUM(am."repeatCustomers"), 0)::bigint as "repeatCustomers",
      MAX(am."currencyCode") as "currencyCode"
    FROM "AffiliateMonthly" am
    WHERE am."shop" = '${shopEsc}'
      AND am."month" >= '${startMonth}' AND am."month" <= '${endMonth}'
      ${codeFilter}
  `);

  const aff = affTotalsRows[0] ?? {
    orderCount: BigInt(0),
    revenue: 0,
    subtotal: 0,
    affiliateDiscountTotal: 0,
    siteDiscountTotal: 0,
    commissionTotal: 0,
    uniqueCustomers: BigInt(0),
    newCustomers: BigInt(0),
    repeatCustomers: BigInt(0),
    currencyCode: null,
  };

  // ─── Organic totals ───
  const orgTotalsRows = await prisma.$queryRawUnsafe<
    Array<{
      orderCount: bigint;
      revenue: number;
      subtotal: number;
      siteDiscountTotal: number;
      uniqueCustomers: bigint;
      currencyCode: string | null;
    }>
  >(`
    SELECT
      COALESCE(SUM("orderCount"), 0)::bigint as "orderCount",
      COALESCE(SUM("revenue"), 0) as "revenue",
      COALESCE(SUM("subtotal"), 0) as "subtotal",
      COALESCE(SUM("siteDiscountTotal"), 0) as "siteDiscountTotal",
      COALESCE(SUM("uniqueCustomers"), 0)::bigint as "uniqueCustomers",
      MAX("currencyCode") as "currencyCode"
    FROM "AffiliateOrganicAgg"
    WHERE "shop" = '${shopEsc}'
      AND "month" >= '${startMonth}' AND "month" <= '${endMonth}'
  `);

  const org = orgTotalsRows[0] ?? {
    orderCount: BigInt(0),
    revenue: 0,
    subtotal: 0,
    siteDiscountTotal: 0,
    uniqueCustomers: BigInt(0),
    currencyCode: null,
  };

  const affOrders = Number(aff.orderCount);
  const orgOrders = Number(org.orderCount);
  const affRevenue = Number(aff.revenue);
  const orgRevenue = Number(org.revenue);
  const affCustomers = Number(aff.uniqueCustomers);
  const orgCustomers = Number(org.uniqueCustomers);
  const affNewCustomers = Number(aff.newCustomers);
  const affRepeatCustomers = Number(aff.repeatCustomers);
  const commissionTotal = Number(aff.commissionTotal);
  const affDiscountTotal = Number(aff.affiliateDiscountTotal);
  // Effective site portion derived from Shopify's totalDiscountsSet per
  // order (ao.discountAmount) minus the affiliate-code portion. This avoids
  // the waterfall double-counting the affiliate coupon if the per-order
  // siteDiscount split in sync.server.ts drifted or if Shopify returned
  // stacked applications whose values overlap. Guaranteed non-overlapping.
  const [ey, em] = endMonth.split("-").map(Number);
  const nextMonthStr =
    em === 12
      ? `${ey! + 1}-01-01`
      : `${ey}-${String(em! + 1).padStart(2, "0")}-01`;
  const affOrderFilter = affiliateCode && affiliateCode !== "all"
    ? `AND LOWER(ao."affiliateCode") = '${affiliateCode.toLowerCase().replace(/'/g, "''")}'`
    : `AND ao."affiliateCode" IS NOT NULL`;
  const affDiscountRows = await prisma.$queryRawUnsafe<
    Array<{ totalDiscount: number }>
  >(`
    SELECT COALESCE(SUM(ao."discountAmount"), 0) as "totalDiscount"
    FROM "AffiliateOrder" ao
    WHERE ao."shop" = '${shopEsc}'
      AND ao."orderDate" >= '${startMonth}-01'::timestamp
      AND ao."orderDate" < '${nextMonthStr}'::timestamp
      ${affOrderFilter}
  `);
  const affTotalDiscount = Number(affDiscountRows[0]?.totalDiscount ?? 0);
  const affSiteDiscountTotal = Math.max(0, affTotalDiscount - affDiscountTotal);
  const siteDiscountTotal = affSiteDiscountTotal + Number(org.siteDiscountTotal);
  const totalRevenue = affRevenue + orgRevenue;

  const currencyCode = (aff.currencyCode ?? org.currencyCode ?? "BRL");

  // ─── Comparison period (optional) ───
  let compAffRevenue: number | null = null;
  let compAffMarginPct: number | null = null;
  let compAffCAC: number | null = null;
  let compAffLTV: number | null = null;
  let compAffRepeatPct: number | null = null;
  let compAffAOV: number | null = null;
  let compROAS: number | null = null;

  if (compStart && compEnd) {
    const compStartMonth = toMonthKey(compStart);
    const compEndMonth = toMonthKey(compEnd);

    const compAffRows = await prisma.$queryRawUnsafe<
      Array<{
        orderCount: bigint;
        revenue: number;
        subtotal: number;
        commissionTotal: number;
        affiliateDiscountTotal: number;
        uniqueCustomers: bigint;
        newCustomers: bigint;
        repeatCustomers: bigint;
      }>
    >(`
      SELECT
        COALESCE(SUM(am."orderCount"), 0)::bigint as "orderCount",
        COALESCE(SUM(am."revenue"), 0) as "revenue",
        COALESCE(SUM(am."subtotal"), 0) as "subtotal",
        COALESCE(SUM(am."commissionTotal"), 0) as "commissionTotal",
        COALESCE(SUM(am."affiliateDiscountTotal"), 0) as "affiliateDiscountTotal",
        COALESCE(SUM(am."uniqueCustomers"), 0)::bigint as "uniqueCustomers",
        COALESCE(SUM(am."newCustomers"), 0)::bigint as "newCustomers",
        COALESCE(SUM(am."repeatCustomers"), 0)::bigint as "repeatCustomers"
      FROM "AffiliateMonthly" am
      WHERE am."shop" = '${shopEsc}'
        AND am."month" >= '${compStartMonth}' AND am."month" <= '${compEndMonth}'
        ${codeFilter}
    `);

    const compOrgRows = await prisma.$queryRawUnsafe<
      Array<{ revenue: number }>
    >(`
      SELECT COALESCE(SUM("revenue"), 0) as "revenue"
      FROM "AffiliateOrganicAgg"
      WHERE "shop" = '${shopEsc}'
        AND "month" >= '${compStartMonth}' AND "month" <= '${compEndMonth}'
    `);

    const ca = compAffRows[0];
    const co = compOrgRows[0];
    if (ca) {
      compAffRevenue = Number(ca.revenue);
      const _compOrgRevenue = co ? Number(co.revenue) : 0;
      void _compOrgRevenue; // reserved for future comparison display
      const compOrders = Number(ca.orderCount);
      const compSubtotal = Number(ca.subtotal);
      const compCommission = Number(ca.commissionTotal);
      const compAffDiscount = Number(ca.affiliateDiscountTotal);
      const compNewCust = Number(ca.newCustomers);
      const compRepeatCust = Number(ca.repeatCustomers);
      const compCust = Number(ca.uniqueCustomers);
      const compTotalCost = compCommission + compAffDiscount;

      compAffMarginPct = compSubtotal > 0 ? ((compSubtotal - compCommission - compAffDiscount) / compSubtotal) * 100 : 0;
      compAffCAC = compNewCust > 0 ? compTotalCost / compNewCust : 0;
      compAffLTV = compCust > 0 ? Number(ca.revenue) / compCust : 0;
      compAffRepeatPct = compCust > 0 ? (compRepeatCust / compCust) * 100 : 0;
      compAffAOV = compOrders > 0 ? Number(ca.revenue) / compOrders : 0;
      compROAS = compTotalCost > 0 ? Number(ca.revenue) / compTotalCost : 0;
    }
  }

  const computeDelta = (current: number, previous: number | null): number | undefined => {
    if (previous == null || previous === 0) return undefined;
    return ((current - previous) / Math.abs(previous)) * 100;
  };

  // ─── Margin ───
  const affSubtotal = Number(aff.subtotal);
  const affNetMarginValue =
    affSubtotal - commissionTotal - affDiscountTotal - affSiteDiscountTotal;
  const affMarginPct = affSubtotal > 0
    ? (affNetMarginValue / affSubtotal) * 100
    : 0;
  const orgSubtotal = Number(org.subtotal);
  const orgDiscountTotal = Number(org.siteDiscountTotal);
  const organicMarginPct = orgSubtotal > 0
    ? ((orgSubtotal - orgDiscountTotal) / orgSubtotal) * 100
    : 0;

  // ─── CAC ───
  const totalCost = commissionTotal + affDiscountTotal;
  const affiliateCAC = affNewCustomers > 0 ? totalCost / affNewCustomers : 0;

  // ─── LTV ───
  const affiliateLTV = affCustomers > 0 ? affRevenue / affCustomers : 0;
  const organicLTV = orgCustomers > 0 ? orgRevenue / orgCustomers : 0;

  // ─── Repeat rate ───
  const affRepeatPct = affCustomers > 0 ? (affRepeatCustomers / affCustomers) * 100 : 0;
  const orgRepeatRows = await prisma.$queryRawUnsafe<Array<{ repeat_pct: number }>>(`
    SELECT CASE WHEN SUM("uniqueCustomers") > 0
      THEN (SUM("repeatCustomers")::float / SUM("uniqueCustomers")) * 100
      ELSE 0 END as repeat_pct
    FROM "AffiliateOrganicAgg"
    WHERE "shop" = '${shopEsc}'
      AND "month" >= '${startMonth}' AND "month" <= '${endMonth}'
  `);
  const orgRepeatPct = orgRepeatRows[0]?.repeat_pct ?? 0;

  // ─── AOV ───
  const affAOV = affOrders > 0 ? affRevenue / affOrders : 0;
  const orgAOV = orgOrders > 0 ? orgRevenue / orgOrders : 0;

  // ─── ROAS ───
  const affiliateROAS = totalCost > 0 ? affRevenue / totalCost : 0;

  // ─── Leaderboard ───
  // Base aggregate per affiliate, incl. repeat customers + AOV inputs so
  // the Profiles list can render quartile bands without a second round-trip.
  const leaderboardRows = await prisma.$queryRawUnsafe<
    Array<{
      affiliateCode: string;
      revenue: number;
      orderCount: bigint;
      commissionTotal: number;
      uniqueCustomers: bigint;
      repeatCustomers: bigint;
    }>
  >(`
    SELECT
      am."affiliateCode",
      COALESCE(SUM(am."revenue"), 0) as "revenue",
      COALESCE(SUM(am."orderCount"), 0)::bigint as "orderCount",
      COALESCE(SUM(am."commissionTotal"), 0) as "commissionTotal",
      COALESCE(SUM(am."uniqueCustomers"), 0)::bigint as "uniqueCustomers",
      COALESCE(SUM(am."repeatCustomers"), 0)::bigint as "repeatCustomers"
    FROM "AffiliateMonthly" am
    WHERE am."shop" = '${shopEsc}'
      AND am."month" >= '${startMonth}' AND am."month" <= '${endMonth}'
    GROUP BY am."affiliateCode"
    ORDER BY SUM(am."revenue") DESC
    LIMIT 50
  `);

  // Fetch profile info for leaderboard
  const leaderboardCodes = leaderboardRows.map((r) => r.affiliateCode);
  const profilesMap = new Map<string, { affiliateName: string; instagram: string | null; tiktok: string | null }>();
  if (leaderboardCodes.length > 0) {
    const profiles = await prisma.affiliateProfile.findMany({
      where: { shop, code: { in: leaderboardCodes } },
      select: { code: true, affiliateName: true, instagram: true, tiktok: true },
    });
    for (const p of profiles) {
      profilesMap.set(p.code.toLowerCase(), { affiliateName: p.affiliateName, instagram: p.instagram, tiktok: p.tiktok });
    }
  }

  // Compute top product per leaderboard affiliate from lineItemsJson. One
  // query that scans the period-filtered AffiliateOrder rows for the top-20
  // codes only — same shape as getProductMixStats but grouped by affiliateCode.
  const topProductByAffiliate = new Map<string, { title: string; quantity: number; revenue: number; totalAffRevenue: number }>();
  if (leaderboardCodes.length > 0) {
    const rangeStart = `${startMonth}-01`;
    const [ey, em] = endMonth.split("-").map(Number);
    const nextMonth = em === 12 ? `${ey + 1}-01-01` : `${ey}-${String(em + 1).padStart(2, "0")}-01`;
    const codesInSql = leaderboardCodes
      .map((c) => `'${c.toLowerCase().replace(/'/g, "''")}'`)
      .join(",");

    const topProdRows = await prisma.$queryRawUnsafe<
      Array<{ affiliateCode: string; lineItemsJson: string | null }>
    >(`
      SELECT "affiliateCode", "lineItemsJson"
      FROM "AffiliateOrder"
      WHERE "shop" = '${shopEsc}'
        AND LOWER("affiliateCode") IN (${codesInSql})
        AND "orderDate" >= '${rangeStart}'::timestamp
        AND "orderDate" < '${nextMonth}'::timestamp
        AND "lineItemsJson" IS NOT NULL
    `);

    // Aggregate lineItems per affiliate, pick top by revenue, track total rev.
    const perAff = new Map<string, { totalRev: number; products: Map<string, { title: string; quantity: number; revenue: number }> }>();
    for (const row of topProdRows) {
      if (!row.lineItemsJson) continue;
      const codeKey = row.affiliateCode.toLowerCase();
      let bucket = perAff.get(codeKey);
      if (!bucket) {
        bucket = { totalRev: 0, products: new Map() };
        perAff.set(codeKey, bucket);
      }
      try {
        const items = JSON.parse(row.lineItemsJson) as Array<{
          title: string;
          quantity: number;
          amount: number;
          productId: string | null;
        }>;
        for (const item of items) {
          bucket.totalRev += item.amount;
          const key = item.productId ?? item.title;
          const existing = bucket.products.get(key);
          if (existing) {
            existing.quantity += item.quantity;
            existing.revenue += item.amount;
          } else {
            bucket.products.set(key, {
              title: item.title,
              quantity: item.quantity,
              revenue: item.amount,
            });
          }
        }
      } catch {
        // Skip malformed JSON
      }
    }

    for (const [codeKey, bucket] of perAff) {
      let top: { title: string; quantity: number; revenue: number } | null = null;
      for (const p of bucket.products.values()) {
        if (!top || p.revenue > top.revenue) top = p;
      }
      if (top) {
        topProductByAffiliate.set(codeKey, {
          title: top.title,
          quantity: top.quantity,
          revenue: top.revenue,
          totalAffRevenue: bucket.totalRev,
        });
      }
    }
  }

  const leaderboard = leaderboardRows.map((r) => {
    const profile = profilesMap.get(r.affiliateCode.toLowerCase());
    const rev = Number(r.revenue);
    const ord = Number(r.orderCount);
    const cust = Number(r.uniqueCustomers);
    const rep = Number(r.repeatCustomers);
    const topP = topProductByAffiliate.get(r.affiliateCode.toLowerCase()) ?? null;
    const topShare =
      topP && topP.totalAffRevenue > 0
        ? (topP.revenue / topP.totalAffRevenue) * 100
        : 0;
    return {
      code: r.affiliateCode,
      affiliateName: profile?.affiliateName ?? r.affiliateCode,
      revenue: rev,
      orders: ord,
      commission: Number(r.commissionTotal),
      customers: cust,
      repeatPct: cust > 0 ? (rep / cust) * 100 : 0,
      aov: ord > 0 ? rev / ord : 0,
      topProductTitle: topP?.title ?? null,
      topProductShare: Math.round(topShare * 10) / 10,
      instagram: profile?.instagram ?? null,
      tiktok: profile?.tiktok ?? null,
    };
  });

  // ─── Product mix ───
  const productMix = await getProductMixStats(shop, startMonth, endMonth, affiliateCode);

  // ─── Trend data ───
  const trendAffRows = await prisma.$queryRawUnsafe<
    Array<{ month: string; revenue: number; orderCount: bigint }>
  >(`
    SELECT am."month", COALESCE(SUM(am."revenue"), 0) as "revenue", COALESCE(SUM(am."orderCount"), 0)::bigint as "orderCount"
    FROM "AffiliateMonthly" am
    WHERE am."shop" = '${shopEsc}'
      AND am."month" >= '${startMonth}' AND am."month" <= '${endMonth}'
      ${codeFilter}
    GROUP BY am."month"
    ORDER BY am."month"
  `);

  const trendOrgRows = await prisma.$queryRawUnsafe<
    Array<{ month: string; revenue: number; orderCount: bigint }>
  >(`
    SELECT "month", COALESCE(SUM("revenue"), 0) as "revenue", COALESCE(SUM("orderCount"), 0)::bigint as "orderCount"
    FROM "AffiliateOrganicAgg"
    WHERE "shop" = '${shopEsc}'
      AND "month" >= '${startMonth}' AND "month" <= '${endMonth}'
    GROUP BY "month"
    ORDER BY "month"
  `);

  const trendAffMap = new Map(trendAffRows.map((r) => [r.month, r]));
  const trendOrgMap = new Map(trendOrgRows.map((r) => [r.month, r]));

  const trend = monthsInRange.map((month) => {
    const affData = trendAffMap.get(month);
    const orgData = trendOrgMap.get(month);
    return {
      month,
      affiliateRevenue: affData ? Number(affData.revenue) : 0,
      organicRevenue: orgData ? Number(orgData.revenue) : 0,
      affiliateOrders: affData ? Number(affData.orderCount) : 0,
      organicOrders: orgData ? Number(orgData.orderCount) : 0,
    };
  });

  return {
    currencyCode,
    revenueImpact: {
      affiliateRevenue: affRevenue,
      organicRevenue: orgRevenue,
      affiliateOrders: affOrders,
      organicOrders: orgOrders,
      affiliateSharePct: totalRevenue > 0 ? (affRevenue / totalRevenue) * 100 : 0,
      delta: computeDelta(affRevenue, compAffRevenue ?? null),
    },
    marginAnalysis: {
      affiliateMarginPct: Math.round(affMarginPct * 10) / 10,
      organicMarginPct: Math.round(organicMarginPct * 10) / 10,
      affiliateDiscountTotal: affDiscountTotal,
      siteDiscountTotal,
      commissionTotal,
      affiliateSiteDiscountTotal: affSiteDiscountTotal,
      affiliateGrossSales: affSubtotal,
      affiliateNetMargin: affNetMarginValue,
      organicGrossSales: orgSubtotal,
      organicDiscountTotal: orgDiscountTotal,
      organicNetMargin: orgSubtotal - orgDiscountTotal,
      delta: computeDelta(affMarginPct, compAffMarginPct ?? null),
    },
    cac: {
      affiliateCAC: Math.round(affiliateCAC * 100) / 100,
      totalSpent: totalCost,
      newCustomersViaAffiliates: affNewCustomers,
      delta: computeDelta(affiliateCAC, compAffCAC ?? null),
    },
    ltv: {
      affiliateLTV: Math.round(affiliateLTV * 100) / 100,
      organicLTV: Math.round(organicLTV * 100) / 100,
      affiliateCustomers: affCustomers,
      organicCustomers: orgCustomers,
      delta: computeDelta(affiliateLTV, compAffLTV ?? null),
    },
    repeatRate: {
      affiliateRepeatPct: Math.round(affRepeatPct * 10) / 10,
      organicRepeatPct: Math.round(orgRepeatPct * 10) / 10,
      affiliateRepeat: affRepeatCustomers,
      affiliateTotal: affCustomers,
      delta: computeDelta(affRepeatPct, compAffRepeatPct ?? null),
    },
    aov: {
      affiliateAOV: Math.round(affAOV * 100) / 100,
      organicAOV: Math.round(orgAOV * 100) / 100,
      delta: computeDelta(affAOV, compAffAOV ?? null),
    },
    leaderboard,
    productMix,
    roas: {
      affiliateROAS: Math.round(affiliateROAS * 100) / 100,
      totalRevenue: affRevenue,
      totalCost,
      delta: computeDelta(affiliateROAS, compROAS ?? null),
    },
    trend,
  };
}

// ─── Product mix from lineItemsJson ─────────────────────────────────────────

async function getProductMixStats(
  shop: string,
  startMonth: string,
  endMonth: string,
  affiliateCode?: string | null,
): Promise<Array<{
  title: string;
  productId: string | null;
  quantity: number;
  revenue: number;
  orderShare: number;
}>> {
  const shopEsc = shop.replace(/'/g, "''");
  const codeFilter = affiliateCode && affiliateCode !== "all"
    ? `AND LOWER("affiliateCode") = '${affiliateCode.toLowerCase().replace(/'/g, "''")}'`
    : "";

  // Use range-based date filtering so the @@index([shop, orderDate]) can be used
  // instead of TO_CHAR() which forces a sequential scan.
  const rangeStart = `${startMonth}-01`;
  // End of endMonth: first day of next month
  const [ey, em] = endMonth.split("-").map(Number);
  const nextMonth = em === 12 ? `${ey + 1}-01-01` : `${ey}-${String(em + 1).padStart(2, "0")}-01`;

  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; lineItemsJson: string | null }>
  >(`
    SELECT "id", "lineItemsJson"
    FROM "AffiliateOrder"
    WHERE "shop" = '${shopEsc}'
      AND "orderDate" >= '${rangeStart}'::timestamp
      AND "orderDate" < '${nextMonth}'::timestamp
      ${codeFilter}
      AND "lineItemsJson" IS NOT NULL
  `);

  // Total orders in period (denominator for orderShare). Each row IS one order.
  const totalOrders = rows.length;

  const productMap = new Map<string, { title: string; productId: string | null; quantity: number; revenue: number }>();
  // For each product, the set of order IDs that contained it — used to
  // compute %% of orders that included this product.
  const ordersPerProduct = new Map<string, Set<string>>();

  for (const row of rows) {
    if (!row.lineItemsJson) continue;
    try {
      const items = JSON.parse(row.lineItemsJson) as Array<{
        title: string;
        quantity: number;
        amount: number;
        productId: string | null;
      }>;
      // Track unique product keys in THIS order to avoid double-counting when
      // the same SKU appears as multiple line items.
      const keysInOrder = new Set<string>();
      for (const item of items) {
        const key = item.productId ?? item.title;
        keysInOrder.add(key);
        const existing = productMap.get(key);
        if (existing) {
          existing.quantity += item.quantity;
          existing.revenue += item.amount;
        } else {
          productMap.set(key, {
            title: item.title,
            productId: item.productId,
            quantity: item.quantity,
            revenue: item.amount,
          });
        }
      }
      for (const key of keysInOrder) {
        let set = ordersPerProduct.get(key);
        if (!set) {
          set = new Set();
          ordersPerProduct.set(key, set);
        }
        set.add(row.id);
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return Array.from(productMap.entries())
    .map(([key, p]) => {
      const orderCount = ordersPerProduct.get(key)?.size ?? 0;
      return {
        ...p,
        orderShare:
          totalOrders > 0
            ? Math.round((orderCount / totalOrders) * 1000) / 10
            : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20);
}

// ─── Per-affiliate detail ────────────────────────────────────────────────────

/**
 * Per-customer acquisition state. Powers the badge rendered in the
 * Customers drill table and the stacked bar above it.
 *   - "new":  wasPreExistingCustomer=false. Truly acquired by the affiliate.
 *   - "leak": wasPreExistingCustomer=true AND no trackable repeat signal.
 *             Margin-leak: we paid commission+discount on a sale that was
 *             going to happen anyway.
 *   - "lift": wasPreExistingCustomer=true AND trackable repeat signal
 *             (customer has 2+ affiliate-tracked orders in the window).
 *             Pre-existing customer who is actually buying more after the
 *             affiliate touch — reactivation defense holds for this row.
 */
export type AcquisitionState = "new" | "leak" | "lift";

export type AffiliateDetailStats = {
  identity: {
    code: string;
    affiliateName: string;
    instagram: string | null;
    tiktok: string | null;
    commissionPct: number;
    tier: string;
    status: string;
    firstOrderDate: string | null;
    lastOrderDate: string | null;
  };
  kpis: {
    revenue: {
      total: number;
      orderCount: number;
      /** Average order value: total / orderCount (0 when no orders). */
      aov: number;
      delta?: number;
    };
    customers: {
      total: number;
      newCustomers: number;
      repeatCustomers: number;
      repeatPct: number;
      delta?: number;
    };
    products: {
      distinctSkus: number;
      topTitle: string | null;
      topShare: number;
      /** Average total line-item quantity per order (sum qty / orderCount). */
      avgItemsPerOrder: number;
      delta?: number;
    };
  };
  /**
   * Per-affiliate classification — the margin-leakage verdict.
   * Flagging is an intersection: leakage must be high AND loyalty-lift must
   * fail to justify it, AND sample must exceed the noise floor. See
   * classification-thresholds.ts for the exact constants.
   */
  classification: {
    newCount: number;
    preCount: number;
    /** preCount / (newCount + preCount) * 100 */
    leakagePct: number;
    /** Average orders per pre-existing customer (affiliate-tracked only — lower bound). */
    preExistingDensity: number;
    /** Average orders per customer in the organic cohort for the same period. */
    organicDensity: number;
    /**
     * (preExistingDensity / organicDensity - 1) * 100 — relative percentage
     * lift (NOT percentage points). Positive = pre-existing customers of this
     * affiliate buy more than organic baseline; negative = pure leak. Uses
     * density (orders/customer), not rate.
     */
    loyaltyLiftPct: number;
    /** True when all three flag conditions hold (leakage high + lift low + sample material). */
    isFlagged: boolean;
    /** Diagnostic string shown in the alert ribbon. Empty when not flagged. */
    flagReason: string;
  };
  customers: Array<{
    customerId: string;
    customerName: string | null;
    customerEmail: string | null;
    orderCount: number;
    totalSpend: number;
    firstOrderDate: string | null;
    lastOrderDate: string | null;
    isRepeat: boolean;
    topProductTitle: string | null;
    acquisitionState: AcquisitionState;
  }>;
  productMix: Array<{
    title: string;
    productId: string | null;
    quantity: number;
    revenue: number;
    shareOfAffiliate: number;
    /** %% of this affiliate's orders that contained this product. */
    orderShare: number;
  }>;
  monthlyTrend: Array<{
    month: string;
    revenue: number;
    orders: number;
  }>;
  currencyCode: string;
};

export async function getAffiliateDetailStats(
  shop: string,
  code: string,
  startDate: string,
  endDate: string,
  compStart?: string | null,
  compEnd?: string | null,
): Promise<AffiliateDetailStats> {
  const shopEsc = shop.replace(/'/g, "''");
  const codeEsc = code.toLowerCase().replace(/'/g, "''");
  const startMonth = toMonthKey(startDate);
  const endMonth = toMonthKey(endDate);
  const monthsInRange = monthBetween(startMonth, endMonth);
  const rangeStart = `${startMonth}-01`;
  const [ey, em] = endMonth.split("-").map(Number);
  const nextMonth =
    em === 12 ? `${ey + 1}-01-01` : `${ey}-${String(em + 1).padStart(2, "0")}-01`;

  // ─── Identity ───
  const profile = await prisma.affiliateProfile.findFirst({
    where: { shop, code: { equals: code, mode: "insensitive" } },
    select: {
      code: true,
      affiliateName: true,
      instagram: true,
      tiktok: true,
      commissionPct: true,
      tier: true,
      status: true,
    },
  });

  // Order-date bounds across ALL time (identity is not period-scoped)
  const boundsRows = await prisma.$queryRawUnsafe<
    Array<{ firstOrderDate: Date | null; lastOrderDate: Date | null }>
  >(`
    SELECT
      MIN("orderDate") as "firstOrderDate",
      MAX("orderDate") as "lastOrderDate"
    FROM "AffiliateOrder"
    WHERE "shop" = '${shopEsc}' AND LOWER("affiliateCode") = '${codeEsc}'
  `);
  const bounds = boundsRows[0] ?? { firstOrderDate: null, lastOrderDate: null };

  // ─── Current-period aggregates from AffiliateMonthly ───
  const affRows = await prisma.$queryRawUnsafe<
    Array<{
      revenue: number;
      orderCount: bigint;
      uniqueCustomers: bigint;
      newCustomers: bigint;
      repeatCustomers: bigint;
      currencyCode: string | null;
    }>
  >(`
    SELECT
      COALESCE(SUM("revenue"), 0) as "revenue",
      COALESCE(SUM("orderCount"), 0)::bigint as "orderCount",
      COALESCE(SUM("uniqueCustomers"), 0)::bigint as "uniqueCustomers",
      COALESCE(SUM("newCustomers"), 0)::bigint as "newCustomers",
      COALESCE(SUM("repeatCustomers"), 0)::bigint as "repeatCustomers",
      MAX("currencyCode") as "currencyCode"
    FROM "AffiliateMonthly"
    WHERE "shop" = '${shopEsc}'
      AND LOWER("affiliateCode") = '${codeEsc}'
      AND "month" >= '${startMonth}' AND "month" <= '${endMonth}'
  `);
  const agg = affRows[0] ?? {
    revenue: 0,
    orderCount: BigInt(0),
    uniqueCustomers: BigInt(0),
    newCustomers: BigInt(0),
    repeatCustomers: BigInt(0),
    currencyCode: null,
  };

  const revenue = Number(agg.revenue);
  const orders = Number(agg.orderCount);
  const uniqueCust = Number(agg.uniqueCustomers);
  const newCust = Number(agg.newCustomers);
  const repeatCust = Number(agg.repeatCustomers);
  const repeatPct = uniqueCust > 0 ? (repeatCust / uniqueCust) * 100 : 0;
  const currencyCode = agg.currencyCode ?? "BRL";

  // ─── Comparison period (optional) ───
  let compRevenue: number | null = null;
  let compRepeatPct: number | null = null;
  let compDistinctSkus: number | null = null;
  if (compStart && compEnd) {
    const compStartMonth = toMonthKey(compStart);
    const compEndMonth = toMonthKey(compEnd);
    const compRows = await prisma.$queryRawUnsafe<
      Array<{
        revenue: number;
        uniqueCustomers: bigint;
        repeatCustomers: bigint;
      }>
    >(`
      SELECT
        COALESCE(SUM("revenue"), 0) as "revenue",
        COALESCE(SUM("uniqueCustomers"), 0)::bigint as "uniqueCustomers",
        COALESCE(SUM("repeatCustomers"), 0)::bigint as "repeatCustomers"
      FROM "AffiliateMonthly"
      WHERE "shop" = '${shopEsc}'
        AND LOWER("affiliateCode") = '${codeEsc}'
        AND "month" >= '${compStartMonth}' AND "month" <= '${compEndMonth}'
    `);
    const c = compRows[0];
    if (c) {
      compRevenue = Number(c.revenue);
      const cc = Number(c.uniqueCustomers);
      const cr = Number(c.repeatCustomers);
      compRepeatPct = cc > 0 ? (cr / cc) * 100 : 0;
    }

    // Comparison distinct SKUs from lineItems for that period
    const [cSy, cSm] = compStartMonth.split("-").map(Number);
    const compRangeStart = `${compStartMonth}-01`;
    const [cEy, cEm] = compEndMonth.split("-").map(Number);
    const compNextMonth =
      cEm === 12
        ? `${cEy + 1}-01-01`
        : `${cEy}-${String(cEm + 1).padStart(2, "0")}-01`;
    void cSy;
    void cSm;
    const compSkuRows = await prisma.$queryRawUnsafe<
      Array<{ lineItemsJson: string | null }>
    >(`
      SELECT "lineItemsJson"
      FROM "AffiliateOrder"
      WHERE "shop" = '${shopEsc}'
        AND LOWER("affiliateCode") = '${codeEsc}'
        AND "orderDate" >= '${compRangeStart}'::timestamp
        AND "orderDate" < '${compNextMonth}'::timestamp
        AND "lineItemsJson" IS NOT NULL
    `);
    const skus = new Set<string>();
    for (const row of compSkuRows) {
      if (!row.lineItemsJson) continue;
      try {
        const items = JSON.parse(row.lineItemsJson) as Array<{
          title: string;
          productId: string | null;
        }>;
        for (const it of items) {
          skus.add(it.productId ?? it.title);
        }
      } catch {
        /* skip */
      }
    }
    compDistinctSkus = skus.size;
  }

  const computeDelta = (current: number, previous: number | null): number | undefined => {
    if (previous == null || previous === 0) return undefined;
    return ((current - previous) / Math.abs(previous)) * 100;
  };

  // ─── Per-customer drilldown (the compiled customer list) ───
  const customerRows = await prisma.$queryRawUnsafe<
    Array<{
      customerId: string;
      customerName: string | null;
      customerEmail: string | null;
      orderCount: bigint;
      totalSpend: number;
      firstOrderDate: Date | null;
      lastOrderDate: Date | null;
      isRepeat: boolean;
      wasPreExisting: boolean;
    }>
  >(`
    SELECT
      "customerId",
      MAX("customerName") as "customerName",
      MAX("customerEmail") as "customerEmail",
      COUNT(*)::bigint as "orderCount",
      COALESCE(SUM("totalAmount"), 0) as "totalSpend",
      MIN("orderDate") as "firstOrderDate",
      MAX("orderDate") as "lastOrderDate",
      (COUNT(*) > 1) as "isRepeat",
      BOOL_OR("wasPreExistingCustomer") as "wasPreExisting"
    FROM "AffiliateOrder"
    WHERE "shop" = '${shopEsc}'
      AND LOWER("affiliateCode") = '${codeEsc}'
      AND "orderDate" >= '${rangeStart}'::timestamp
      AND "orderDate" < '${nextMonth}'::timestamp
      AND "customerId" IS NOT NULL
    GROUP BY "customerId"
    ORDER BY SUM("totalAmount") DESC
    LIMIT 200
  `);

  // ─── Per-customer top product (pulled from lineItemsJson for these customers) ───
  const customerTopProductMap = new Map<string, string>();
  if (customerRows.length > 0) {
    const custIdsInSql = customerRows
      .map((c) => `'${c.customerId.replace(/'/g, "''")}'`)
      .join(",");
    const perCustRows = await prisma.$queryRawUnsafe<
      Array<{ customerId: string; lineItemsJson: string | null }>
    >(`
      SELECT "customerId", "lineItemsJson"
      FROM "AffiliateOrder"
      WHERE "shop" = '${shopEsc}'
        AND LOWER("affiliateCode") = '${codeEsc}'
        AND "orderDate" >= '${rangeStart}'::timestamp
        AND "orderDate" < '${nextMonth}'::timestamp
        AND "customerId" IN (${custIdsInSql})
        AND "lineItemsJson" IS NOT NULL
    `);
    const perCust = new Map<string, Map<string, { title: string; revenue: number }>>();
    for (const row of perCustRows) {
      if (!row.lineItemsJson) continue;
      let products = perCust.get(row.customerId);
      if (!products) {
        products = new Map();
        perCust.set(row.customerId, products);
      }
      try {
        const items = JSON.parse(row.lineItemsJson) as Array<{
          title: string;
          productId: string | null;
          amount: number;
        }>;
        for (const item of items) {
          const key = item.productId ?? item.title;
          const existing = products.get(key);
          if (existing) {
            existing.revenue += item.amount;
          } else {
            products.set(key, { title: item.title, revenue: item.amount });
          }
        }
      } catch {
        /* skip */
      }
    }
    for (const [custId, products] of perCust) {
      let top: { title: string; revenue: number } | null = null;
      for (const p of products.values()) {
        if (!top || p.revenue > top.revenue) top = p;
      }
      if (top) customerTopProductMap.set(custId, top.title);
    }
  }

  // ─── Product mix for this affiliate (reuse getProductMixStats) ───
  const rawProductMix = await getProductMixStats(shop, startMonth, endMonth, code);
  const totalMixRevenue = rawProductMix.reduce((sum, p) => sum + p.revenue, 0);
  const totalMixQuantity = rawProductMix.reduce((sum, p) => sum + p.quantity, 0);
  const productMix = rawProductMix.map((p) => ({
    ...p,
    shareOfAffiliate:
      totalMixRevenue > 0
        ? Math.round((p.revenue / totalMixRevenue) * 1000) / 10
        : 0,
  }));

  const distinctSkus = productMix.length;
  const avgItemsPerOrder =
    orders > 0 ? Math.round((totalMixQuantity / orders) * 10) / 10 : 0;
  const topProduct = productMix[0] ?? null;
  const topShare = topProduct?.shareOfAffiliate ?? 0;

  // ─── Monthly trend for this affiliate ───
  const trendRows = await prisma.$queryRawUnsafe<
    Array<{ month: string; revenue: number; orderCount: bigint }>
  >(`
    SELECT "month",
           COALESCE(SUM("revenue"), 0) as "revenue",
           COALESCE(SUM("orderCount"), 0)::bigint as "orderCount"
    FROM "AffiliateMonthly"
    WHERE "shop" = '${shopEsc}'
      AND LOWER("affiliateCode") = '${codeEsc}'
      AND "month" >= '${startMonth}' AND "month" <= '${endMonth}'
    GROUP BY "month"
    ORDER BY "month"
  `);
  const trendMap = new Map(trendRows.map((r) => [r.month, r]));
  const monthlyTrend = monthsInRange.map((month) => {
    const t = trendMap.get(month);
    return {
      month,
      revenue: t ? Number(t.revenue) : 0,
      orders: t ? Number(t.orderCount) : 0,
    };
  });

  // ─── Classification (margin-leakage verdict) ───
  //
  // newCount = customers whose only history with us is this affiliate touch.
  // preCount = customers who were already ours before the affiliate touched them.
  // Note: customerRows LIMIT 200 so preCount/newCount are capped at 200. Raw
  // counts for the KPI primary come from `newCust` / `repeatCust` above, which
  // are from AffiliateMonthly aggregates and uncapped.
  //
  // preExistingDensity = avg affiliate-tracked orders per pre-existing customer.
  //   We can only see affiliate-tracked orders (AffiliateOrganicAgg has no
  //   customer IDs), so this is a LOWER BOUND on their true post-affiliate
  //   activity. Labeled honestly in the UI.
  // organicDensity = orders/customer in the organic cohort for the same window,
  //   derived from AffiliateOrganicAgg.
  // loyaltyLiftPct = (preExistingDensity / organicDensity - 1) * 100
  //   Relative %% lift, NOT percentage points.
  //   Positive = pre-existing customers buy more per head than organic baseline;
  //   negative = they buy less (pure leak, not even recovering organic activity).

  const newCountFromKpi = newCust;
  const preCountFromKpi = repeatCust;
  const totalClassified = newCountFromKpi + preCountFromKpi;
  const leakagePct =
    totalClassified > 0 ? (preCountFromKpi / totalClassified) * 100 : 0;

  // Sum of affiliate-tracked orders placed by pre-existing customers in-window.
  const preExistingOrdersRows = await prisma.$queryRawUnsafe<
    Array<{ preOrders: bigint }>
  >(`
    SELECT COALESCE(SUM(cnt), 0)::bigint as "preOrders" FROM (
      SELECT COUNT(*) as cnt
      FROM "AffiliateOrder"
      WHERE "shop" = '${shopEsc}'
        AND LOWER("affiliateCode") = '${codeEsc}'
        AND "orderDate" >= '${rangeStart}'::timestamp
        AND "orderDate" < '${nextMonth}'::timestamp
        AND "customerId" IS NOT NULL
        AND "wasPreExistingCustomer" = true
      GROUP BY "customerId"
    ) per_customer
  `);
  const preOrderTotal = Number(preExistingOrdersRows[0]?.preOrders ?? 0);
  const preExistingDensity =
    preCountFromKpi > 0 ? preOrderTotal / preCountFromKpi : 0;

  // Organic cohort density: orders per customer in AffiliateOrganicAgg for the
  // same months. Floor at 1.0 — if organic has any activity, every customer
  // placed at least one order by definition.
  const organicDensityRows = await prisma.$queryRawUnsafe<
    Array<{ orders: bigint; customers: bigint }>
  >(`
    SELECT
      COALESCE(SUM("orderCount"), 0)::bigint as "orders",
      COALESCE(SUM("uniqueCustomers"), 0)::bigint as "customers"
    FROM "AffiliateOrganicAgg"
    WHERE "shop" = '${shopEsc}'
      AND "month" >= '${startMonth}' AND "month" <= '${endMonth}'
  `);
  const organicOrders = Number(organicDensityRows[0]?.orders ?? 0);
  const organicCustomers = Number(organicDensityRows[0]?.customers ?? 0);
  const organicDensity =
    organicCustomers > 0 ? organicOrders / organicCustomers : 1;

  const loyaltyLiftPct =
    organicDensity > 0
      ? (preExistingDensity / organicDensity - 1) * 100
      : 0;

  const isFlagged =
    totalClassified >= FLAG_MIN_CUSTOMERS &&
    leakagePct >= FLAG_LEAKAGE_PCT &&
    loyaltyLiftPct < FLAG_LOYALTY_LIFT_PP;

  let flagReason = "";
  if (isFlagged) {
    flagReason = `${Math.round(leakagePct)}% of this affiliate's customers were already ours; their post-affiliate activity is ${loyaltyLiftPct >= 0 ? "+" : ""}${loyaltyLiftPct.toFixed(1)}% vs organic baseline — not materially above it.`;
  }

  // ─── Per-customer acquisitionState ───
  // new:  truly acquired (wasPreExisting = false)
  // leak: pre-existing AND no trackable repeat signal in window
  // lift: pre-existing AND 2+ affiliate orders in window (some retention signal)
  const classifyCustomer = (row: {
    wasPreExisting: boolean;
    orderCount: bigint;
  }): AcquisitionState => {
    if (!row.wasPreExisting) return "new";
    return Number(row.orderCount) > 1 ? "lift" : "leak";
  };

  return {
    identity: {
      code,
      affiliateName: profile?.affiliateName ?? code,
      instagram: profile?.instagram ?? null,
      tiktok: profile?.tiktok ?? null,
      commissionPct: profile?.commissionPct ?? 10,
      tier: profile?.tier ?? "standard",
      status: profile?.status ?? "active",
      firstOrderDate: bounds.firstOrderDate?.toISOString() ?? null,
      lastOrderDate: bounds.lastOrderDate?.toISOString() ?? null,
    },
    kpis: {
      revenue: {
        total: revenue,
        orderCount: orders,
        aov: orders > 0 ? Math.round((revenue / orders) * 100) / 100 : 0,
        delta: computeDelta(revenue, compRevenue),
      },
      customers: {
        total: uniqueCust,
        newCustomers: newCust,
        repeatCustomers: repeatCust,
        repeatPct: Math.round(repeatPct * 10) / 10,
        delta: computeDelta(repeatPct, compRepeatPct),
      },
      products: {
        distinctSkus,
        topTitle: topProduct?.title ?? null,
        topShare,
        avgItemsPerOrder,
        delta: computeDelta(distinctSkus, compDistinctSkus),
      },
    },
    classification: {
      newCount: newCountFromKpi,
      preCount: preCountFromKpi,
      leakagePct: Math.round(leakagePct * 10) / 10,
      preExistingDensity: Math.round(preExistingDensity * 100) / 100,
      organicDensity: Math.round(organicDensity * 100) / 100,
      loyaltyLiftPct: Math.round(loyaltyLiftPct * 10) / 10,
      isFlagged,
      flagReason,
    },
    customers: customerRows.map((c) => ({
      customerId: c.customerId,
      customerName: c.customerName,
      customerEmail: c.customerEmail,
      orderCount: Number(c.orderCount),
      totalSpend: Number(c.totalSpend),
      firstOrderDate: c.firstOrderDate?.toISOString() ?? null,
      lastOrderDate: c.lastOrderDate?.toISOString() ?? null,
      isRepeat: Boolean(c.isRepeat),
      topProductTitle: customerTopProductMap.get(c.customerId) ?? null,
      acquisitionState: classifyCustomer({
        wasPreExisting: Boolean(c.wasPreExisting),
        orderCount: c.orderCount,
      }),
    })),
    productMix,
    monthlyTrend,
    currencyCode,
  };
}

// ─── Cohort LTV curve (New / Lifted / N/A) ──────────────────────────────────

export type CohortWindow = "6mo" | "12mo" | "24mo" | "all";

export type LtvCohortPoint = {
  bucketIndex: number;
  new: number;
  lifted: number;
  na: number;
  newSampleSize: number;
  liftedSampleSize: number;
  naSampleSize: number;
};

export type LtvCohortCurve = {
  window: CohortWindow;
  bucketDays: number;
  bucketLabel: "week" | "month" | "bimonth" | "quarter";
  points: LtvCohortPoint[];
  totalCohortSizes: { new: number; lifted: number; na: number };
  currencyCode: string;
};

// Window-based bucket sizing. Tuned for ~10-16 data points across the chart.
function resolveBuckets(
  window: CohortWindow,
): {
  bucketDays: number;
  bucketLabel: LtvCohortCurve["bucketLabel"];
  numBuckets: number;
  cohortStart: Date | null; // null means "all time"
} {
  const now = new Date();
  switch (window) {
    case "6mo": {
      const cohortStart = new Date(now);
      cohortStart.setMonth(cohortStart.getMonth() - 6);
      return { bucketDays: 7, bucketLabel: "week", numBuckets: 10, cohortStart };
    }
    case "24mo": {
      const cohortStart = new Date(now);
      cohortStart.setMonth(cohortStart.getMonth() - 24);
      return { bucketDays: 60, bucketLabel: "bimonth", numBuckets: 12, cohortStart };
    }
    case "all":
      return { bucketDays: 90, bucketLabel: "quarter", numBuckets: 16, cohortStart: null };
    case "12mo":
    default: {
      const cohortStart = new Date(now);
      cohortStart.setMonth(cohortStart.getMonth() - 12);
      return { bucketDays: 30, bucketLabel: "month", numBuckets: 12, cohortStart };
    }
  }
}

type CohortBucketRow = {
  b: number;
  revenue: number;
  contributors: bigint;
};

type CohortAnchorRow = {
  customerId: string;
  anchor: Date;
};

/**
 * Runs a bucketed follow-up query for a given cohort definition (passed as a
 * CTE alias that yields customerId + anchor). Returns the raw bucket rows.
 */
async function runCohortBucketQuery(
  shop: string,
  anchorCte: string,
  bucketDays: number,
  numBuckets: number,
): Promise<CohortBucketRow[]> {
  const shopEsc = shop.replace(/'/g, "''");
  return await prisma.$queryRawUnsafe<CohortBucketRow[]>(`
    WITH anchor AS (${anchorCte}),
    all_orders AS (
      SELECT "customerId", "orderDate", "totalAmount"
      FROM "AffiliateOrder"
      WHERE "shop" = '${shopEsc}' AND "customerId" IS NOT NULL
      UNION ALL
      SELECT "customerId", "orderDate", "totalAmount"
      FROM "OrganicOrder"
      WHERE "shop" = '${shopEsc}' AND "customerId" IS NOT NULL
    ),
    follow_ups AS (
      SELECT a."customerId",
             FLOOR(EXTRACT(EPOCH FROM (o."orderDate" - a.anchor)) / (${bucketDays} * 86400))::int AS b,
             o."totalAmount"
      FROM anchor a
      JOIN all_orders o USING ("customerId")
      WHERE o."orderDate" >= a.anchor
        AND o."orderDate" <  a.anchor + make_interval(days => ${bucketDays * numBuckets})
    )
    SELECT b,
           COALESCE(SUM("totalAmount"), 0) AS "revenue",
           COUNT(DISTINCT "customerId")::bigint AS "contributors"
    FROM follow_ups
    WHERE b >= 0 AND b < ${numBuckets}
    GROUP BY b
    ORDER BY b
  `);
}

/**
 * For a given cohort anchor CTE, returns one row per cohort member so we can
 * compute the per-bucket denominator (count of customers with ≥ k buckets of
 * follow-up available). Uses NOW() as the truncation horizon.
 */
async function runCohortAnchors(
  shop: string,
  anchorCte: string,
): Promise<CohortAnchorRow[]> {
  void shop; // anchor CTE already filters by shop
  return await prisma.$queryRawUnsafe<CohortAnchorRow[]>(
    `WITH anchor AS (${anchorCte}) SELECT "customerId", anchor FROM anchor`,
  );
}

/** Computes how many customers have ≥ k buckets of follow-up available. */
function buildDenominators(
  anchors: CohortAnchorRow[],
  bucketDays: number,
  numBuckets: number,
): number[] {
  const now = Date.now();
  const bucketMs = bucketDays * 86400 * 1000;
  const denom = new Array(numBuckets).fill(0);
  for (const a of anchors) {
    const anchorMs = new Date(a.anchor).getTime();
    const availableBuckets = Math.floor((now - anchorMs) / bucketMs) + 1;
    const cap = Math.min(availableBuckets, numBuckets);
    for (let i = 0; i < cap; i++) denom[i] += 1;
  }
  return denom;
}

/** Rolls per-bucket revenue into cumulative R$/customer using the denominator. */
function buildCumulative(
  rows: CohortBucketRow[],
  denominators: number[],
): number[] {
  const byBucket = new Map<number, number>();
  for (const r of rows) byBucket.set(r.b, Number(r.revenue));
  const out = new Array(denominators.length).fill(0);
  let cum = 0;
  for (let i = 0; i < denominators.length; i++) {
    cum += byBucket.get(i) ?? 0;
    out[i] = denominators[i] > 0 ? cum / denominators[i] : 0;
  }
  return out;
}

export async function getLtvCohortCurve(
  shop: string,
  window: CohortWindow,
): Promise<LtvCohortCurve> {
  const { bucketDays, bucketLabel, numBuckets, cohortStart } = resolveBuckets(window);
  const shopEsc = shop.replace(/'/g, "''");
  const startClause = cohortStart
    ? `AND MIN("orderDate") >= '${cohortStart.toISOString()}'::timestamp`
    : "";

  // New cohort: first ever order used an affiliate coupon.
  const newAnchorCte = `
    SELECT ao."customerId", MIN(ao."orderDate") AS anchor
    FROM "AffiliateOrder" ao
    WHERE ao."shop" = '${shopEsc}'
      AND ao."wasPreExistingCustomer" = false
      AND ao."customerId" IS NOT NULL
    GROUP BY ao."customerId"
    HAVING MIN(ao."orderDate") IS NOT NULL
      ${startClause.replace(/"orderDate"/g, 'ao."orderDate"')}
  `;

  // Lifted cohort: already a customer, anchor = first affiliate order.
  const liftedAnchorCte = `
    SELECT ao."customerId", MIN(ao."orderDate") AS anchor
    FROM "AffiliateOrder" ao
    WHERE ao."shop" = '${shopEsc}'
      AND ao."wasPreExistingCustomer" = true
      AND ao."customerId" IS NOT NULL
    GROUP BY ao."customerId"
    HAVING MIN(ao."orderDate") IS NOT NULL
      ${startClause.replace(/"orderDate"/g, 'ao."orderDate"')}
  `;

  // N/A cohort: customer has no affiliate orders at all. Anchor = first ever
  // organic order, only counted if it was their true first (wasPreExisting=false).
  const naAnchorCte = `
    SELECT oo."customerId", MIN(oo."orderDate") AS anchor
    FROM "OrganicOrder" oo
    WHERE oo."shop" = '${shopEsc}'
      AND oo."wasPreExistingCustomer" = false
      AND oo."customerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "AffiliateOrder" ao2
        WHERE ao2."shop" = '${shopEsc}' AND ao2."customerId" = oo."customerId"
      )
    GROUP BY oo."customerId"
    HAVING MIN(oo."orderDate") IS NOT NULL
      ${startClause.replace(/"orderDate"/g, 'oo."orderDate"')}
  `;

  const [
    newRows,
    liftedRows,
    naRows,
    newAnchors,
    liftedAnchors,
    naAnchors,
    currencyRow,
  ] = await Promise.all([
    runCohortBucketQuery(shop, newAnchorCte, bucketDays, numBuckets),
    runCohortBucketQuery(shop, liftedAnchorCte, bucketDays, numBuckets),
    runCohortBucketQuery(shop, naAnchorCte, bucketDays, numBuckets),
    runCohortAnchors(shop, newAnchorCte),
    runCohortAnchors(shop, liftedAnchorCte),
    runCohortAnchors(shop, naAnchorCte),
    prisma.$queryRawUnsafe<Array<{ currencyCode: string | null }>>(
      `SELECT MAX("currencyCode") AS "currencyCode" FROM "AffiliateOrder" WHERE "shop" = '${shopEsc}'`,
    ),
  ]);

  const newDenom = buildDenominators(newAnchors, bucketDays, numBuckets);
  const liftedDenom = buildDenominators(liftedAnchors, bucketDays, numBuckets);
  const naDenom = buildDenominators(naAnchors, bucketDays, numBuckets);

  const newCum = buildCumulative(newRows, newDenom);
  const liftedCum = buildCumulative(liftedRows, liftedDenom);
  const naCum = buildCumulative(naRows, naDenom);

  const points: LtvCohortPoint[] = [];
  for (let i = 0; i < numBuckets; i++) {
    points.push({
      bucketIndex: i,
      new: Math.round(newCum[i]! * 100) / 100,
      lifted: Math.round(liftedCum[i]! * 100) / 100,
      na: Math.round(naCum[i]! * 100) / 100,
      newSampleSize: newDenom[i]!,
      liftedSampleSize: liftedDenom[i]!,
      naSampleSize: naDenom[i]!,
    });
  }

  return {
    window,
    bucketDays,
    bucketLabel,
    points,
    totalCohortSizes: {
      new: newAnchors.length,
      lifted: liftedAnchors.length,
      na: naAnchors.length,
    },
    currencyCode: currencyRow[0]?.currencyCode ?? "BRL",
  };
}
