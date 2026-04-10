/**
 * Affiliates — Analytics queries
 *
 * Rebuilds monthly aggregates and computes dashboard stats from
 * the normalized AffiliateOrder / AffiliateOrganicAgg / AffiliateMonthly tables.
 */
import prisma from "../db.server";

// ─── Rebuild monthly aggregates ─────────────────────────────────────────────

export async function attributeFirstOrders(shop: string): Promise<void> {
  const shopEsc = shop.replace(/'/g, "''");

  // Reset all
  await prisma.$executeRawUnsafe(
    `UPDATE "AffiliateOrder" SET "isFirstOrder" = false WHERE "shop" = '${shopEsc}'`,
  );

  // Mark first order per customer (earliest orderDate)
  await prisma.$executeRawUnsafe(`
    UPDATE "AffiliateOrder" ao
    SET "isFirstOrder" = true
    FROM (
      SELECT DISTINCT ON ("customerId") "id"
      FROM "AffiliateOrder"
      WHERE "shop" = '${shopEsc}' AND "customerId" IS NOT NULL
      ORDER BY "customerId", "orderDate" ASC
    ) first_orders
    WHERE ao."id" = first_orders."id"
  `);

  console.info(`[affiliates] attributeFirstOrders OK shop=${shop}`);
}

export async function rebuildAffiliateMonthly(shop: string): Promise<void> {
  const shopEsc = shop.replace(/'/g, "''");

  // Atomic DELETE + INSERT inside a transaction to prevent data loss on crash
  await prisma.$transaction(async (tx) => {
    // Delete existing
    await tx.$executeRawUnsafe(
      `DELETE FROM "AffiliateMonthly" WHERE "shop" = '${shopEsc}'`,
    );

    // Rebuild from AffiliateOrder joined with AffiliateProfile for commission.
    // Use MAX(ap."commissionPct") to pick a single commission rate per affiliate
    // without splitting months when the rate changes (@@unique is shop+code+month).
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
        COUNT(DISTINCT CASE WHEN ao."isFirstOrder" = true THEN ao."customerId" END)::int as "newCustomers",
        COUNT(DISTINCT CASE WHEN ao."isFirstOrder" = false AND ao."customerId" IS NOT NULL THEN ao."customerId" END)::int as "repeatCustomers",
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
    siteDiscountTotal: number;
    commissionTotal: number;
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
  const siteDiscountTotal = Number(aff.siteDiscountTotal) + Number(org.siteDiscountTotal);
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
        COALESCE(SUM("orderCount"), 0)::bigint as "orderCount",
        COALESCE(SUM("revenue"), 0) as "revenue",
        COALESCE(SUM("subtotal"), 0) as "subtotal",
        COALESCE(SUM("commissionTotal"), 0) as "commissionTotal",
        COALESCE(SUM("affiliateDiscountTotal"), 0) as "affiliateDiscountTotal",
        COALESCE(SUM("uniqueCustomers"), 0)::bigint as "uniqueCustomers",
        COALESCE(SUM("newCustomers"), 0)::bigint as "newCustomers",
        COALESCE(SUM("repeatCustomers"), 0)::bigint as "repeatCustomers"
      FROM "AffiliateMonthly"
      WHERE "shop" = '${shopEsc}'
        AND "month" >= '${compStartMonth}' AND "month" <= '${compEndMonth}'
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
  const affMarginPct = affSubtotal > 0
    ? ((affSubtotal - commissionTotal - affDiscountTotal) / affSubtotal) * 100
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
  const leaderboardRows = await prisma.$queryRawUnsafe<
    Array<{
      affiliateCode: string;
      revenue: number;
      orderCount: bigint;
      commissionTotal: number;
      uniqueCustomers: bigint;
    }>
  >(`
    SELECT
      am."affiliateCode",
      COALESCE(SUM(am."revenue"), 0) as "revenue",
      COALESCE(SUM(am."orderCount"), 0)::bigint as "orderCount",
      COALESCE(SUM(am."commissionTotal"), 0) as "commissionTotal",
      COALESCE(SUM(am."uniqueCustomers"), 0)::bigint as "uniqueCustomers"
    FROM "AffiliateMonthly" am
    WHERE am."shop" = '${shopEsc}'
      AND am."month" >= '${startMonth}' AND am."month" <= '${endMonth}'
    GROUP BY am."affiliateCode"
    ORDER BY SUM(am."revenue") DESC
    LIMIT 20
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

  const leaderboard = leaderboardRows.map((r) => {
    const profile = profilesMap.get(r.affiliateCode.toLowerCase());
    return {
      code: r.affiliateCode,
      affiliateName: profile?.affiliateName ?? r.affiliateCode,
      revenue: Number(r.revenue),
      orders: Number(r.orderCount),
      commission: Number(r.commissionTotal),
      customers: Number(r.uniqueCustomers),
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
    SELECT "month", COALESCE(SUM("revenue"), 0) as "revenue", COALESCE(SUM("orderCount"), 0)::bigint as "orderCount"
    FROM "AffiliateMonthly"
    WHERE "shop" = '${shopEsc}'
      AND "month" >= '${startMonth}' AND "month" <= '${endMonth}'
      ${codeFilter}
    GROUP BY "month"
    ORDER BY "month"
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
): Promise<Array<{ title: string; productId: string | null; quantity: number; revenue: number }>> {
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
    Array<{ lineItemsJson: string | null }>
  >(`
    SELECT "lineItemsJson"
    FROM "AffiliateOrder"
    WHERE "shop" = '${shopEsc}'
      AND "orderDate" >= '${rangeStart}'::timestamp
      AND "orderDate" < '${nextMonth}'::timestamp
      ${codeFilter}
      AND "lineItemsJson" IS NOT NULL
  `);

  const productMap = new Map<string, { title: string; productId: string | null; quantity: number; revenue: number }>();

  for (const row of rows) {
    if (!row.lineItemsJson) continue;
    try {
      const items = JSON.parse(row.lineItemsJson) as Array<{
        title: string;
        quantity: number;
        amount: number;
        productId: string | null;
      }>;
      for (const item of items) {
        const key = item.productId ?? item.title;
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
    } catch {
      // Skip malformed JSON
    }
  }

  return Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 20);
}
