/**
 * Affiliates — Programs registry & per-program code sync.
 *
 * A "program" is a registered Shopify code-discount node whose codes are
 * pulled into AffiliateCode every hour (via the cron) and on demand via the
 * Settings tab "Re-sync now" button. Multiple codes live under each discount
 * node — N codes → 1 discount.
 *
 * Pattern follows storage.server.ts and analytics-queries.server.ts —
 * narrow exports, plain async functions, structured logs prefixed
 * [affiliate-programs]. Bulk code upserts use raw SQL ON CONFLICT to stay
 * fast at hundreds of codes per program.
 */

import prisma from "../db.server";
import { graphqlJsonWithRetry } from "./sync.server";
import { invalidateAffiliateCodesCache } from "./webhook-ingest.server";
import type {
  AffiliateProgramSummary,
  AffiliateCronHealth,
  UnmappedCodeRow,
} from "./types";

// ─── Read ───────────────────────────────────────────────────────────────────

export async function listAffiliatePrograms(
  shop: string,
): Promise<AffiliateProgramSummary[]> {
  const rows = await prisma.affiliateProgram.findMany({
    where: { shop, status: "active" },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    discountNodeId: r.discountNodeId,
    discountTitle: r.discountTitle,
    status: r.status as "active" | "removed",
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    lastSyncStatus: (r.lastSyncStatus as "ok" | "failed" | null) ?? null,
    lastSyncError: r.lastSyncError ?? null,
    codesCount: r.codesCount,
    mappedCount: r.mappedCount,
  }));
}

// ─── Add / Remove / Update label ────────────────────────────────────────────

export async function addAffiliateProgram(
  shop: string,
  discountNodeId: string,
  label: string,
  discountTitle: string,
): Promise<{ programId: string }> {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new Error("Program label is required");
  }
  if (!discountNodeId.startsWith("gid://shopify/DiscountCodeNode/")) {
    throw new Error("Invalid discount node id");
  }

  // Manual unique-violation messages — Prisma's P2002 is generic.
  const existingByLabel = await prisma.affiliateProgram.findFirst({
    where: { shop, label: trimmedLabel, status: "active" },
    select: { id: true },
  });
  if (existingByLabel) {
    throw new Error(`A program with label "${trimmedLabel}" already exists`);
  }
  const existingByNode = await prisma.affiliateProgram.findFirst({
    where: { shop, discountNodeId, status: "active" },
    select: { id: true, label: true },
  });
  if (existingByNode) {
    throw new Error(
      `This Shopify discount is already registered as "${existingByNode.label}"`,
    );
  }

  // If a removed row exists for the same (shop, discountNodeId), reactivate
  // it instead of failing — the @@unique covers all statuses.
  const removedSameNode = await prisma.affiliateProgram.findUnique({
    where: { shop_discountNodeId: { shop, discountNodeId } },
    select: { id: true },
  });
  if (removedSameNode) {
    const updated = await prisma.affiliateProgram.update({
      where: { id: removedSameNode.id },
      data: {
        label: trimmedLabel,
        discountTitle,
        status: "active",
        lastSyncStatus: null,
        lastSyncError: null,
      },
    });
    console.info(
      `[affiliate-programs] reactivated shop=${shop} programId=${updated.id} label=${trimmedLabel}`,
    );
    return { programId: updated.id };
  }

  const created = await prisma.affiliateProgram.create({
    data: {
      shop,
      discountNodeId,
      label: trimmedLabel,
      discountTitle,
      status: "active",
    },
  });
  console.info(
    `[affiliate-programs] add OK shop=${shop} programId=${created.id} label=${trimmedLabel} discountNodeId=${discountNodeId}`,
  );
  return { programId: created.id };
}

/**
 * Soft-delete: status="removed" + dissociate codes from the program. Codes
 * remain in AffiliateCode (programId=null) so historical attribution data is
 * preserved.
 */
export async function removeAffiliateProgram(
  shop: string,
  programId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.affiliateCode.updateMany({
      where: { shop, programId },
      data: { programId: null },
    }),
    prisma.affiliateProgram.update({
      where: { id: programId },
      data: { status: "removed" },
    }),
  ]);
  console.info(
    `[affiliate-programs] remove OK shop=${shop} programId=${programId}`,
  );
}

export async function updateAffiliateProgramLabel(
  shop: string,
  programId: string,
  label: string,
): Promise<void> {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new Error("Program label is required");
  }
  const conflict = await prisma.affiliateProgram.findFirst({
    where: {
      shop,
      label: trimmedLabel,
      status: "active",
      NOT: { id: programId },
    },
    select: { id: true },
  });
  if (conflict) {
    throw new Error(`A program with label "${trimmedLabel}" already exists`);
  }
  await prisma.affiliateProgram.update({
    where: { id: programId },
    data: { label: trimmedLabel },
  });
  console.info(
    `[affiliate-programs] updateLabel OK shop=${shop} programId=${programId} label=${trimmedLabel}`,
  );
}

// ─── Sync codes from Shopify ────────────────────────────────────────────────

const GET_DISCOUNT_CODES_QUERY = /* GraphQL */ `
  query GetDiscountCodes($id: ID!, $first: Int!, $after: String) {
    codeDiscountNode(id: $id) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic {
          title
          status
          codesCount {
            count
          }
          codes(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              code
              asyncUsageCount
            }
          }
        }
        ... on DiscountCodeBxgy {
          title
          status
          codesCount {
            count
          }
          codes(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              code
              asyncUsageCount
            }
          }
        }
        ... on DiscountCodeFreeShipping {
          title
          status
          codesCount {
            count
          }
          codes(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              code
              asyncUsageCount
            }
          }
        }
        ... on DiscountCodeApp {
          title
          status
          codesCount {
            count
          }
          codes(first: $first, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              code
              asyncUsageCount
            }
          }
        }
      }
    }
  }
`;

type FetchedCode = {
  code: string;
  shopifyCodeId: string;
  asyncUsageCount: number;
};

type DiscountFetchResult = {
  title: string;
  codes: FetchedCode[];
};

async function fetchAllDiscountCodes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  discountNodeId: string,
): Promise<DiscountFetchResult> {
  const PAGE_SIZE = 250;
  let after: string | null = null;
  let title = "";
  const allCodes: FetchedCode[] = [];

  const MAX_PAGES = 100;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const pageStart = Date.now();
    const json = await graphqlJsonWithRetry(admin, GET_DISCOUNT_CODES_QUERY, {
      id: discountNodeId,
      first: PAGE_SIZE,
      after,
    });
    const node = json?.data?.codeDiscountNode;
    if (!node) {
      // Shopify returns null when the discount has been deleted upstream.
      throw new Error(
        `Discount not found in Shopify (was it deleted?): ${discountNodeId}`,
      );
    }
    const cd = node.codeDiscount;
    if (!cd) {
      throw new Error(`Discount has no codeDiscount payload`);
    }
    title = String(cd.title ?? "");
    const codesPage = cd.codes;
    if (!codesPage) break;
    const nodes: Array<{
      id?: string;
      code?: string;
      asyncUsageCount?: number;
    }> = Array.isArray(codesPage.nodes) ? codesPage.nodes : [];
    for (const n of nodes) {
      if (!n?.code) continue;
      allCodes.push({
        code: String(n.code),
        shopifyCodeId: String(n.id ?? ""),
        asyncUsageCount: Number(n.asyncUsageCount ?? 0),
      });
    }
    console.info(
      `[affiliate-programs:fetch] page=${page + 1} codes=${nodes.length} total=${allCodes.length} discountNodeId=${discountNodeId} durationMs=${Date.now() - pageStart}`,
    );
    if (!codesPage.pageInfo?.hasNextPage) break;
    after = codesPage.pageInfo.endCursor ?? null;
    if (!after) break;
    if (page === MAX_PAGES - 1) {
      console.warn(
        `[affiliate-programs:fetch] hit MAX_PAGES=${MAX_PAGES} — bailing to avoid runaway loop discountNodeId=${discountNodeId} total=${allCodes.length}`,
      );
    }
  }

  return { title, codes: allCodes };
}

export type SyncProgramResult = {
  codesCount: number;
  mappedCount: number;
  ok: boolean;
  error?: string;
};

export async function syncProgramCodes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
  programId: string,
): Promise<SyncProgramResult> {
  const program = await prisma.affiliateProgram.findUnique({
    where: { id: programId },
  });
  if (!program || program.shop !== shop) {
    throw new Error("Program not found");
  }
  if (program.status !== "active") {
    return { codesCount: 0, mappedCount: 0, ok: false, error: "Program is not active" };
  }

  const start = Date.now();
  console.info(
    `[affiliate-programs] sync START shop=${shop} programId=${programId} discountNodeId=${program.discountNodeId}`,
  );

  let fetched: DiscountFetchResult;
  try {
    fetched = await fetchAllDiscountCodes(admin, program.discountNodeId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const truncated = message.length > 480 ? message.slice(0, 480) + "…" : message;
    await prisma.affiliateProgram.update({
      where: { id: programId },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: "failed",
        lastSyncError: truncated,
      },
    });
    console.error(
      `[affiliate-programs] sync FAILED shop=${shop} programId=${programId}`,
      err,
    );
    return { codesCount: 0, mappedCount: 0, ok: false, error: truncated };
  }

  // Bulk upsert via raw SQL — INSERT … ON CONFLICT DO UPDATE.
  const codesUpper = fetched.codes.map((c) => ({
    code: c.code.toUpperCase(),
    shopifyCodeId: c.shopifyCodeId,
    asyncUsageCount: c.asyncUsageCount,
  }));

  if (codesUpper.length > 0) {
    // Batch in chunks of 500 to stay well under PostgreSQL's 65535 parameter
    // ceiling (per row: 3 params; per batch: 2 constants + 500*3 = 1502).
    // gen_random_uuid()::text gives us a collision-free PK without app-side
    // ID generation. Parameterized values prevent SQL injection from
    // Shopify-supplied code strings or shopifyCodeId GIDs.
    const BATCH_SIZE = 500;
    for (let i = 0; i < codesUpper.length; i += BATCH_SIZE) {
      const batch = codesUpper.slice(i, i + BATCH_SIZE);
      const params: (string | number | null)[] = [shop, programId];
      const tuples: string[] = [];
      for (const c of batch) {
        const codeIdx = params.length + 1;
        const usageIdx = params.length + 2;
        const gidIdx = params.length + 3;
        params.push(c.code, c.asyncUsageCount, c.shopifyCodeId || null);
        tuples.push(
          `(gen_random_uuid()::text, $1, $${codeIdx}, $2, $${usageIdx}, $${gidIdx}, NOW(), NOW())`,
        );
      }
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "AffiliateCode" ("id", "shop", "code", "programId", "asyncUsageCount", "shopifyCodeId", "firstSeenAt", "lastSeenAt")
        VALUES ${tuples.join(",\n")}
        ON CONFLICT ("shop", "code") DO UPDATE SET
          "programId" = EXCLUDED."programId",
          "asyncUsageCount" = EXCLUDED."asyncUsageCount",
          "shopifyCodeId" = EXCLUDED."shopifyCodeId",
          "lastSeenAt" = NOW()
        `,
        ...params,
      );
    }
  }

  // Fold profileId mapping in a single update — match by (shop, code).
  // Some codes already had a profileId from BixGrow CSV; AffiliateCode.code
  // is uppercased, AffiliateProfile.code is whatever BixGrow gave us, so
  // upper-case both for matching.
  await prisma.$executeRawUnsafe(`
    UPDATE "AffiliateCode" ac
    SET "profileId" = ap."id"
    FROM "AffiliateProfile" ap
    WHERE ac."shop" = $1
      AND ac."programId" = $2
      AND ap."shop" = ac."shop"
      AND UPPER(ap."code") = ac."code"
      AND (ac."profileId" IS NULL OR ac."profileId" <> ap."id")
  `, shop, programId);

  // Recount.
  const [codesCountRow, mappedCountRow] = await Promise.all([
    prisma.affiliateCode.count({
      where: { shop, programId },
    }),
    prisma.affiliateCode.count({
      where: { shop, programId, profileId: { not: null } },
    }),
  ]);

  await prisma.affiliateProgram.update({
    where: { id: programId },
    data: {
      lastSyncedAt: new Date(),
      lastSyncStatus: "ok",
      lastSyncError: null,
      codesCount: codesCountRow,
      mappedCount: mappedCountRow,
      discountTitle: fetched.title || program.discountTitle,
    },
  });

  // Invalidate the webhook cache so newly added codes match on next webhook.
  invalidateAffiliateCodesCache(shop);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.info(
    `[affiliate-programs] sync OK shop=${shop} programId=${programId} codes=${codesCountRow} mapped=${mappedCountRow} elapsed=${elapsed}s`,
  );

  return {
    codesCount: codesCountRow,
    mappedCount: mappedCountRow,
    ok: true,
  };
}

// ─── Cron health helper ─────────────────────────────────────────────────────

const FRESH_CUTOFF_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function getAffiliateCronHealth(
  shop: string,
): Promise<AffiliateCronHealth> {
  const [snapshot, syncMeta] = await Promise.all([
    prisma.attributionQueueSnapshot.findUnique({ where: { shop } }),
    prisma.affiliateSyncMeta.findUnique({ where: { shop } }),
  ]);

  if (!snapshot?.fetchedAt) {
    return {
      status: "unknown",
      lastSuccessAt: null,
      lastFailureMessage: null,
      ageMinutes: null,
    };
  }

  const fetchedAt = snapshot.fetchedAt;
  const ageMs = Date.now() - fetchedAt.getTime();
  const ageMinutes = Math.max(0, Math.floor(ageMs / 60000));
  const fresh = ageMs < FRESH_CUTOFF_MS;

  // Surface a failure only when it's the LAST event — i.e. the failed run was
  // not followed by a successful one. AffiliateSyncMeta.lastSyncedAt only
  // updates on success (see writeAffiliateSyncMeta), so failure is "last"
  // when status === "failed" AND (lastSyncedAt missing OR < fetchedAt).
  let lastFailureMessage: string | null = null;
  if (
    syncMeta?.status === "failed" &&
    syncMeta?.errorMessage &&
    (!syncMeta.lastSyncedAt || syncMeta.lastSyncedAt < fetchedAt)
  ) {
    lastFailureMessage = syncMeta.errorMessage;
  }

  return {
    status: fresh ? "fresh" : "stale",
    lastSuccessAt: fetchedAt.toISOString(),
    lastFailureMessage,
    ageMinutes,
  };
}

// ─── Unmapped codes (for onboarding placeholder route) ──────────────────────

export async function listUnmappedCodes(
  shop: string,
): Promise<UnmappedCodeRow[]> {
  // Codes synced from Shopify with no profile, plus orders aggregate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = await prisma.$queryRawUnsafe(
    `
      SELECT
        ac."code"          AS code,
        ac."firstSeenAt"   AS "firstSeenAt",
        COALESCE(ord_agg.order_count, 0)::int  AS "ordersCount",
        COALESCE(ord_agg.revenue, 0)::float    AS revenue,
        ord_agg.currency_code                  AS "currencyCode",
        prog."label"                           AS "programLabel"
      FROM "AffiliateCode" ac
      LEFT JOIN "AffiliateProgram" prog ON prog."id" = ac."programId"
      LEFT JOIN (
        SELECT
          "shop",
          UPPER("affiliateCode")           AS code_upper,
          COUNT(*)                         AS order_count,
          SUM("totalAmount")               AS revenue,
          MAX("currencyCode")              AS currency_code
        FROM "AffiliateOrder"
        WHERE "shop" = $1
        GROUP BY "shop", UPPER("affiliateCode")
      ) ord_agg ON ord_agg."shop" = ac."shop" AND ord_agg.code_upper = ac."code"
      WHERE ac."shop" = $1
        AND ac."profileId" IS NULL
      ORDER BY ord_agg.order_count DESC NULLS LAST, ac."firstSeenAt" DESC
      LIMIT 500
    `,
    shop,
  );
  return rows.map((r) => ({
    code: String(r.code),
    firstSeenAt:
      r.firstSeenAt instanceof Date
        ? r.firstSeenAt.toISOString()
        : String(r.firstSeenAt ?? ""),
    ordersCount: Number(r.ordersCount ?? 0),
    revenue: Number(r.revenue ?? 0),
    currencyCode: r.currencyCode ?? null,
    programLabel: r.programLabel ?? null,
  }));
}
