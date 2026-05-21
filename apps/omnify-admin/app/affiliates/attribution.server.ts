/**
 * Attribution Queue — detect IGLU POS / WhatsApp Hexagon orders with UGC
 * coupons that are missing from BixGrow, and manage the reconciliation loop
 * via user-claimed + pedidos.csv imports.
 *
 * Port of the BixGrow attribution sync (v0 Python; reference lives in nami-works/sandbox/gebeauty/).
 * Does NOT extend app/affiliates/sync.server.ts — lives entirely on-demand.
 */
import prisma from "../db.server";
import { parseCsvLine, readAffiliateProfiles } from "./storage.server";
import { graphqlJsonWithRetry } from "./sync.server";

// ─── Constants ──────────────────────────────────────────────────────────────

// Shopify source_name values BixGrow cannot see natively.
// v1 scope: IGLU POS + WhatsApp Hexagon.
export const IGLU_SOURCE_NAME = "206755758081";
export const WHATSAPP_HEXAGON_SOURCE_NAME = "316281618433";
export const DEFAULT_SCOPED_SOURCES = new Set<string>([
  IGLU_SOURCE_NAME,
  WHATSAPP_HEXAGON_SOURCE_NAME,
]);

export const DEFAULT_LOOKBACK_DAYS = 90;
export const FORGOTTEN_THRESHOLD_DAYS = 7;
export const PEDIDOS_STALE_THRESHOLD_DAYS = 7;

// ─── Types ──────────────────────────────────────────────────────────────────

export type IgluCandidateOrder = {
  orderGid: string;
  orderName: string;
  orderDate: string;
  subtotal: number;
  currencyCode: string;
  sourceName: string;
  locationLabel: string | null;
  couponCodes: string[];
};

export type QueueClassification = "pending" | "claimed" | "unknown";

export type AttributionQueueRow = {
  orderGid: string;
  orderName: string;
  orderDate: string;
  subtotal: number;
  currencyCode: string;
  sourceName: string;
  locationLabel: string | null;
  primaryCoupon: string;
  classification: QueueClassification;
  matchedProfile: {
    code: string;
    affiliateName: string;
    email: string | null;
  } | null;
  claim: {
    id: string;
    claimedAt: string;
    confirmedAt: string | null;
  } | null;
};

export type AttributionQueueSnapshot = {
  fetchedAt: string;
  lookbackDays: number;
  sinceDate: string;
  scannedCount: number;
  matchedCount: number;
  rows: AttributionQueueRow[];
  stats: {
    pending: number;
    claimed: number;
    unknown: number;
  };
};

export type ForgottenClaim = {
  id: string;
  orderName: string;
  orderGid: string | null;
  couponCode: string;
  affiliateCode: string | null;
  affiliateEmail: string | null;
  subtotal: number | null;
  currencyCode: string | null;
  sourceName: string | null;
  orderDate: string | null;
  claimedAt: string;
  daysSince: number;
};

export type AttributionTabLoaderData = {
  lastPedidosImport: {
    importedAt: string;
    maxOrderDate: string | null;
    rowCount: number;
    ageDays: number | null;
  } | null;
  claimedPendingCount: number;
  forgottenCount: number;
  totalConfirmed: number;
};

export type ImportPedidosResult = {
  importId: string;
  rowCount: number;
  maxOrderDate: string | null;
  claimsConfirmedNow: number;
  unmatchedOrderNamesCount: number;
};

// ─── Shopify live fetch ─────────────────────────────────────────────────────

const IGLU_ORDERS_QUERY = /* GraphQL */ `
  query AttributionIgluOrders($cursor: String, $q: String) {
    orders(
      first: 100
      after: $cursor
      sortKey: CREATED_AT
      reverse: false
      query: $q
    ) {
      edges {
        node {
          id
          name
          sourceName
          createdAt
          subtotalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customAttributes {
            key
            value
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

function extractCouponCodes(
  customAttributes: Array<{ key: string; value: string | null }>,
): string[] {
  for (const attr of customAttributes) {
    if (attr.key !== "order_discounts_info") continue;
    const raw = attr.value || "[]";
    try {
      const arr: unknown = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      const codes: string[] = [];
      for (const item of arr) {
        if (
          item &&
          typeof item === "object" &&
          (item as { type?: string }).type === "coupon"
        ) {
          const val = String((item as { value?: unknown }).value ?? "")
            .trim()
            .toUpperCase();
          if (val) codes.push(val);
        }
      }
      return codes;
    } catch {
      return [];
    }
  }
  return [];
}

function customAttr(
  customAttributes: Array<{ key: string; value: string | null }>,
  key: string,
): string | null {
  for (const attr of customAttributes) {
    if (attr.key === key) return attr.value || null;
  }
  return null;
}

export async function fetchIgluCandidateOrders(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
  sinceDate: Date,
  sourceNames: Set<string>,
): Promise<{ scanned: number; candidates: IgluCandidateOrder[] }> {
  const sinceIso = sinceDate.toISOString().slice(0, 10);
  const q = `created_at:>=${sinceIso}`;
  let cursor: string | null = null;
  let scanned = 0;
  let page = 0;
  let hasNextPage = true;
  const candidates: IgluCandidateOrder[] = [];

  console.info(
    `[attribution] fetch START shop=${shop} since=${sinceIso} sources=${[...sourceNames].join(",")}`,
  );

  while (hasNextPage) {
    page += 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await graphqlJsonWithRetry(admin, IGLU_ORDERS_QUERY, {
      cursor,
      q,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edges: any[] = json?.data?.orders?.edges ?? [];
    scanned += edges.length;

    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      const sn = String(node.sourceName ?? "");
      if (!sourceNames.has(sn)) continue;

      const customAttributes: Array<{ key: string; value: string | null }> =
        node.customAttributes ?? [];
      const couponCodes = extractCouponCodes(customAttributes);
      if (couponCodes.length === 0) continue;

      const subtotalRaw =
        node.subtotalPriceSet?.shopMoney?.amount ?? "0";
      const subtotal = Number.parseFloat(String(subtotalRaw)) || 0;
      const currencyCode =
        String(node.subtotalPriceSet?.shopMoney?.currencyCode ?? "BRL");

      candidates.push({
        orderGid: String(node.id),
        orderName: String(node.name).replace(/^#/, ""),
        orderDate: String(node.createdAt),
        subtotal,
        currencyCode,
        sourceName: sn,
        locationLabel: customAttr(customAttributes, "location_name"),
        couponCodes,
      });
    }

    const pageInfo = json?.data?.orders?.pageInfo;
    hasNextPage = Boolean(pageInfo?.hasNextPage);
    if (page % 10 === 0 || !hasNextPage) {
      console.info(
        `[attribution] fetch page=${page} scanned=${scanned} candidates=${candidates.length} shop=${shop}`,
      );
    }
    cursor = hasNextPage ? pageInfo.endCursor : null;
  }

  console.info(
    `[attribution] fetch OK shop=${shop} scanned=${scanned} candidates=${candidates.length}`,
  );
  return { scanned, candidates };
}

// ─── Snapshot assembly ──────────────────────────────────────────────────────

export async function buildAttributionQueueSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
  opts: { lookbackDays?: number; sourceNames?: Set<string> } = {},
): Promise<AttributionQueueSnapshot> {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const sourceNames = opts.sourceNames ?? DEFAULT_SCOPED_SOURCES;
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const [{ scanned, candidates }, profiles, attributedRows, claimRows] =
    await Promise.all([
      fetchIgluCandidateOrders(admin, shop, since, sourceNames),
      readAffiliateProfiles(shop),
      prisma.bixgrowAttributedOrder.findMany({
        where: { shop },
        select: { orderName: true },
      }),
      prisma.attributionClaim.findMany({
        where: { shop },
        select: {
          id: true,
          orderName: true,
          claimedAt: true,
          confirmedAt: true,
        },
      }),
    ]);

  const profileByCode = new Map<
    string,
    { code: string; affiliateName: string; email: string | null }
  >();
  for (const p of profiles) {
    profileByCode.set(p.code.toUpperCase(), {
      code: p.code,
      affiliateName: p.affiliateName,
      email: p.email ?? null,
    });
  }

  const attributedSet = new Set(attributedRows.map((r) => r.orderName));
  const claimByOrder = new Map<
    string,
    { id: string; claimedAt: Date; confirmedAt: Date | null }
  >();
  for (const c of claimRows) {
    claimByOrder.set(c.orderName, {
      id: c.id,
      claimedAt: c.claimedAt,
      confirmedAt: c.confirmedAt,
    });
  }

  const rows: AttributionQueueRow[] = [];
  const stats = { pending: 0, claimed: 0, unknown: 0 };

  for (const c of candidates) {
    if (attributedSet.has(c.orderName)) continue;

    const existingClaim = claimByOrder.get(c.orderName);
    if (existingClaim?.confirmedAt) continue;

    const primaryCoupon = c.couponCodes[0];
    const matchedProfile = profileByCode.get(primaryCoupon) ?? null;

    let classification: QueueClassification;
    if (existingClaim) {
      classification = "claimed";
      stats.claimed += 1;
    } else if (matchedProfile) {
      classification = "pending";
      stats.pending += 1;
    } else {
      classification = "unknown";
      stats.unknown += 1;
    }

    rows.push({
      orderGid: c.orderGid,
      orderName: c.orderName,
      orderDate: c.orderDate,
      subtotal: c.subtotal,
      currencyCode: c.currencyCode,
      sourceName: c.sourceName,
      locationLabel: c.locationLabel,
      primaryCoupon,
      classification,
      matchedProfile,
      claim: existingClaim
        ? {
            id: existingClaim.id,
            claimedAt: existingClaim.claimedAt.toISOString(),
            confirmedAt: existingClaim.confirmedAt
              ? existingClaim.confirmedAt.toISOString()
              : null,
          }
        : null,
    });
  }

  rows.sort((a, b) => (a.orderDate < b.orderDate ? 1 : -1));

  return {
    fetchedAt: new Date().toISOString(),
    lookbackDays,
    sinceDate: since.toISOString().slice(0, 10),
    scannedCount: scanned,
    matchedCount: candidates.length,
    rows,
    stats,
  };
}

// ─── Claim CRUD ─────────────────────────────────────────────────────────────

export async function createAttributionClaim(
  shop: string,
  input: {
    orderName: string;
    orderGid?: string | null;
    couponCode: string;
    affiliateCode?: string | null;
    affiliateEmail?: string | null;
    subtotal?: number | null;
    currencyCode?: string | null;
    sourceName?: string | null;
    orderDate?: Date | null;
    claimedBy?: string | null;
  },
): Promise<{ id: string; alreadyExisted: boolean }> {
  const orderName = input.orderName.replace(/^#/, "").trim();
  const couponCode = input.couponCode.trim().toUpperCase();
  const existing = await prisma.attributionClaim.findUnique({
    where: { shop_orderName: { shop, orderName } },
    select: { id: true },
  });
  if (existing) {
    console.info(
      `[attribution] claim SKIP existing shop=${shop} order=${orderName}`,
    );
    return { id: existing.id, alreadyExisted: true };
  }
  const row = await prisma.attributionClaim.create({
    data: {
      shop,
      orderName,
      orderGid: input.orderGid ?? null,
      couponCode,
      affiliateCode: input.affiliateCode ?? null,
      affiliateEmail: input.affiliateEmail ?? null,
      subtotal: input.subtotal ?? null,
      currencyCode: input.currencyCode ?? null,
      sourceName: input.sourceName ?? null,
      orderDate: input.orderDate ?? null,
      claimedBy: input.claimedBy ?? null,
    },
    select: { id: true },
  });
  console.info(
    `[attribution] claim OK shop=${shop} order=${orderName} coupon=${couponCode} by=${input.claimedBy ?? "?"}`,
  );
  return { id: row.id, alreadyExisted: false };
}

export async function deleteAttributionClaim(
  shop: string,
  orderName: string,
): Promise<{ deleted: boolean }> {
  const name = orderName.replace(/^#/, "").trim();
  const result = await prisma.attributionClaim.deleteMany({
    where: { shop, orderName: name, confirmedAt: null },
  });
  console.info(
    `[attribution] unclaim shop=${shop} order=${name} deleted=${result.count}`,
  );
  return { deleted: result.count > 0 };
}

// ─── Forgotten claims ───────────────────────────────────────────────────────

export async function listForgottenClaims(
  shop: string,
  thresholdDays: number = FORGOTTEN_THRESHOLD_DAYS,
): Promise<ForgottenClaim[]> {
  const cutoff = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
  const attributedRows = await prisma.bixgrowAttributedOrder.findMany({
    where: { shop },
    select: { orderName: true },
  });
  const attributedSet = new Set(attributedRows.map((r) => r.orderName));

  const rows = await prisma.attributionClaim.findMany({
    where: {
      shop,
      confirmedAt: null,
      claimedAt: { lt: cutoff },
    },
    orderBy: { claimedAt: "asc" },
  });

  const now = Date.now();
  return rows
    .filter((r) => !attributedSet.has(r.orderName))
    .map((r) => ({
      id: r.id,
      orderName: r.orderName,
      orderGid: r.orderGid,
      couponCode: r.couponCode,
      affiliateCode: r.affiliateCode,
      affiliateEmail: r.affiliateEmail,
      subtotal: r.subtotal,
      currencyCode: r.currencyCode,
      sourceName: r.sourceName,
      orderDate: r.orderDate ? r.orderDate.toISOString() : null,
      claimedAt: r.claimedAt.toISOString(),
      daysSince: Math.floor(
        (now - r.claimedAt.getTime()) / (24 * 60 * 60 * 1000),
      ),
    }));
}

// ─── Pedidos CSV import + reconciliation ────────────────────────────────────

function parseBrazilianDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // BixGrow format: "2025-10-15 16:50:58" or just "2025-10-15"
  const normalized = trimmed.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function importPedidosCsv(
  shop: string,
  csvText: string,
  opts: { importedBy?: string | null; fileName?: string | null } = {},
): Promise<ImportPedidosResult> {
  const lines = csvText.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error("pedidos.csv is empty");
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const orderIdx = header.findIndex((h) => h.toLowerCase() === "order");
  const dateIdx = header.findIndex((h) => h.toLowerCase() === "date");
  if (orderIdx === -1) {
    throw new Error(
      `pedidos.csv header missing "Order" column. Found: ${header.join(", ")}`,
    );
  }

  type Row = { orderName: string; orderDate: Date | null };
  const rows: Row[] = [];
  let maxOrderDate: Date | null = null;
  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    const rawName = (fields[orderIdx] || "").trim().replace(/^#/, "");
    if (!rawName) continue;
    const rawDate = dateIdx >= 0 ? fields[dateIdx] || "" : "";
    const d = rawDate ? parseBrazilianDate(rawDate) : null;
    if (d && (!maxOrderDate || d > maxOrderDate)) maxOrderDate = d;
    rows.push({ orderName: rawName, orderDate: d });
  }

  const orderNames = new Set(rows.map((r) => r.orderName));
  console.info(
    `[attribution] pedidos import START shop=${shop} rows=${rows.length} maxDate=${maxOrderDate?.toISOString() ?? "?"}`,
  );

  const result = await prisma.$transaction(async (tx) => {
    const imp = await tx.pedidosImport.create({
      data: {
        shop,
        importedBy: opts.importedBy ?? null,
        rowCount: rows.length,
        maxOrderDate,
        fileName: opts.fileName ?? null,
      },
      select: { id: true },
    });

    await tx.bixgrowAttributedOrder.deleteMany({ where: { shop } });
    if (rows.length > 0) {
      await tx.bixgrowAttributedOrder.createMany({
        data: rows.map((r) => ({
          shop,
          orderName: r.orderName,
          orderDate: r.orderDate,
          importId: imp.id,
        })),
        skipDuplicates: true,
      });
    }

    const confirmResult = await tx.attributionClaim.updateMany({
      where: {
        shop,
        confirmedAt: null,
        orderName: { in: [...orderNames] },
      },
      data: {
        confirmedAt: new Date(),
        confirmedVia: "pedidos-csv",
      },
    });

    await tx.pedidosImport.update({
      where: { id: imp.id },
      data: { claimsConfirmed: confirmResult.count },
    });

    // unmatched = orders in pedidos.csv that never had a claim
    const claimedNames = await tx.attributionClaim.findMany({
      where: { shop, orderName: { in: [...orderNames] } },
      select: { orderName: true },
    });
    const claimedSet = new Set(claimedNames.map((c) => c.orderName));
    const unmatched = [...orderNames].filter((n) => !claimedSet.has(n)).length;

    return {
      importId: imp.id,
      claimsConfirmedNow: confirmResult.count,
      unmatchedOrderNamesCount: unmatched,
    };
  });

  console.info(
    `[attribution] pedidos import OK shop=${shop} rows=${rows.length} confirmed=${result.claimsConfirmedNow} unmatched=${result.unmatchedOrderNamesCount}`,
  );

  return {
    importId: result.importId,
    rowCount: rows.length,
    maxOrderDate: maxOrderDate ? maxOrderDate.toISOString() : null,
    claimsConfirmedNow: result.claimsConfirmedNow,
    unmatchedOrderNamesCount: result.unmatchedOrderNamesCount,
  };
}

// ─── Loader aggregate ───────────────────────────────────────────────────────

export async function readAttributionTabLoaderData(
  shop: string,
): Promise<AttributionTabLoaderData> {
  const [lastImport, claimedPendingCount, totalConfirmed, forgotten] =
    await Promise.all([
      prisma.pedidosImport.findFirst({
        where: { shop },
        orderBy: { importedAt: "desc" },
      }),
      prisma.attributionClaim.count({
        where: { shop, confirmedAt: null },
      }),
      prisma.attributionClaim.count({
        where: { shop, confirmedAt: { not: null } },
      }),
      listForgottenClaims(shop),
    ]);

  return {
    lastPedidosImport: lastImport
      ? {
          importedAt: lastImport.importedAt.toISOString(),
          maxOrderDate: lastImport.maxOrderDate
            ? lastImport.maxOrderDate.toISOString()
            : null,
          rowCount: lastImport.rowCount,
          ageDays: Math.floor(
            (Date.now() - lastImport.importedAt.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        }
      : null,
    claimedPendingCount,
    forgottenCount: forgotten.length,
    totalConfirmed,
  };
}
