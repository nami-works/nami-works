/**
 * Affiliates — Order sync pipeline
 *
 * Fetches all Shopify orders, matches discount codes against known affiliate
 * profiles, and populates AffiliateOrder + AffiliateOrganicAgg tables.
 */
import prisma from "../db.server";
import {
  writeAffiliateSyncMeta,
  writeAffiliateSyncProgress,
} from "./storage.server";
import {
  rebuildAffiliateMonthly,
  attributeFirstOrders,
} from "./analytics-queries.server";

// ─── Helpers ────────────────────────────────────────────────────────────────

const ANALYTICS_PAGE_SIZE = 250;
const MAX_THROTTLE_RETRIES = 5;
const BATCH_SIZE = 500;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const isThrottledGraphqlPayload = (json: any) => {
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  return errors.some((error: any) =>
    String(error?.message ?? "").toLowerCase().includes("throttl"),
  );
};

export const graphqlJsonWithRetry = async (
  admin: any,
  query: string,
  variables: Record<string, unknown>,
) => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_THROTTLE_RETRIES; attempt += 1) {
    try {
      const response = await admin.graphql(query, { variables });
      const json = await response.json();

      if (isThrottledGraphqlPayload(json)) {
        lastError = new Error("Throttled");
        if (attempt < MAX_THROTTLE_RETRIES) {
          console.warn(
            `[affiliates:sync] GraphQL throttled attempt=${attempt}/${MAX_THROTTLE_RETRIES} — retrying in ${300 * 2 ** (attempt - 1)}ms`,
          );
          await sleep(300 * 2 ** (attempt - 1));
          continue;
        }
        throw lastError;
      }

      if (Array.isArray(json?.errors) && json.errors.length > 0) {
        throw new Error(
          json.errors
            .map((error: any) =>
              String(error?.message ?? "Unknown GraphQL error"),
            )
            .join("; "),
        );
      }

      return json;
    } catch (error) {
      const message = String((error as Error)?.message ?? "");
      const throttled = message.toLowerCase().includes("throttl");
      lastError = error;
      if (throttled && attempt < MAX_THROTTLE_RETRIES) {
        console.warn(
          `[affiliates:sync] GraphQL throttled (catch) attempt=${attempt}/${MAX_THROTTLE_RETRIES} — retrying in ${300 * 2 ** (attempt - 1)}ms`,
        );
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      throw error;
    }
  }
  throw lastError ?? new Error("graphqlJsonWithRetry exhausted retries");
};

// ─── Discount attribution helpers ───────────────────────────────────────────

type DiscountApp = {
  __typename: string;
  code?: string;
  title?: string;
  value: {
    __typename: string;
    amount?: string;
    percentage?: number;
  };
};

function computeDiscountSplit(
  discountApplications: DiscountApp[],
  affiliateCode: string,
  subtotal: number,
): { affiliateDiscount: number; siteDiscount: number } {
  let affiliateDiscount = 0;
  let siteDiscount = 0;

  for (const app of discountApplications) {
    const isAffiliate =
      app.__typename === "DiscountCodeApplication" &&
      app.code?.toLowerCase() === affiliateCode.toLowerCase();

    let discountValue = 0;
    if (app.value.__typename === "MoneyV2" && app.value.amount) {
      discountValue = parseFloat(app.value.amount);
    } else if (
      app.value.__typename === "PricingPercentageValue" &&
      app.value.percentage
    ) {
      discountValue = (app.value.percentage / 100) * subtotal;
    }

    if (isAffiliate) {
      affiliateDiscount += discountValue;
    } else {
      siteDiscount += discountValue;
    }
  }

  return { affiliateDiscount, siteDiscount };
}

// ─── Month key helper ───────────────────────────────────────────────────────

function toMonthKey(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// ─── Organic accumulator ────────────────────────────────────────────────────

type OrganicBucket = {
  orderCount: number;
  revenue: number;
  subtotal: number;
  siteDiscountTotal: number;
  customerIds: Set<string>;
  currencyCode: string | null;
};

// ─── Main backfill ──────────────────────────────────────────────────────────

export async function backfillAffiliateOrders(
  admin: any,
  shop: string,
  _fullResync?: boolean, // eslint-disable-line @typescript-eslint/no-unused-vars
) {
  const syncStart = Date.now();
  console.info(
    `[affiliates:sync] === backfillAffiliateOrders START shop=${shop} ===`,
  );

  try {
    await writeAffiliateSyncMeta(shop, "running", { phase: "loading profiles" });

    // 1. Load all known affiliate codes
    const profiles = await prisma.affiliateProfile.findMany({
      where: { shop },
      select: { code: true },
    });
    const affiliateCodes = new Set(
      profiles.map((p) => p.code.toLowerCase()),
    );
    console.info(
      `[affiliates:sync] loaded ${affiliateCodes.size} affiliate codes shop=${shop}`,
    );

    if (affiliateCodes.size === 0) {
      await writeAffiliateSyncMeta(shop, "failed", {
        errorMessage:
          "No affiliate profiles found. Import affiliates first.",
      });
      return;
    }

    // 2. Paginate orders
    await writeAffiliateSyncMeta(shop, "running", { phase: "fetching orders" });

    const affiliateRows: Array<{
      id: string;
      shop: string;
      orderName: string | null;
      customerId: string | null;
      affiliateCode: string;
      discountAmount: number;
      affiliateDiscount: number;
      siteDiscount: number;
      totalAmount: number;
      subtotalAmount: number;
      currencyCode: string | null;
      itemCount: number;
      lineItemsJson: string | null;
      orderDate: string | null;
    }> = [];

    const organicMap = new Map<string, OrganicBucket>();

    let hasNextPage = true;
    let cursor: string | null = null;
    let pageCount = 0;
    let totalOrders = 0;

    while (hasNextPage) {
      const json = await graphqlJsonWithRetry(
        admin,
        `#graphql
          query AffOrders($first: Int!, $after: String) {
            orders(first: $first, after: $after, sortKey: CREATED_AT) {
              nodes {
                id
                name
                createdAt
                customer { id }
                currentTotalPriceSet { shopMoney { amount currencyCode } }
                subtotalPriceSet { shopMoney { amount } }
                totalDiscountsSet { shopMoney { amount } }
                discountCodes
                discountApplications(first: 10) {
                  nodes {
                    __typename
                    ... on DiscountCodeApplication {
                      code
                      value {
                        __typename
                        ... on MoneyV2 { amount }
                        ... on PricingPercentageValue { percentage }
                      }
                    }
                    ... on AutomaticDiscountApplication {
                      title
                      value {
                        __typename
                        ... on MoneyV2 { amount }
                        ... on PricingPercentageValue { percentage }
                      }
                    }
                  }
                }
                lineItems(first: 50) {
                  nodes {
                    title
                    quantity
                    originalTotalSet { shopMoney { amount } }
                    product { id }
                  }
                }
              }
              pageInfo { hasNextPage endCursor }
            }
          }`,
        { first: ANALYTICS_PAGE_SIZE, after: cursor },
      );

      const nodes = json.data.orders.nodes as any[];
      totalOrders += nodes.length;

      for (const order of nodes) {
        const discountCodes: string[] = Array.isArray(order.discountCodes)
          ? order.discountCodes
          : [];
        const matchedCode = discountCodes.find((c: string) =>
          affiliateCodes.has(c.toLowerCase()),
        );

        const total = order.currentTotalPriceSet
          ? parseFloat(order.currentTotalPriceSet.shopMoney.amount)
          : 0;
        const subtotal = order.subtotalPriceSet
          ? parseFloat(order.subtotalPriceSet.shopMoney.amount)
          : 0;
        const discountTotal = order.totalDiscountsSet
          ? parseFloat(order.totalDiscountsSet.shopMoney.amount)
          : 0;
        const currencyCode =
          order.currentTotalPriceSet?.shopMoney?.currencyCode ?? null;
        const orderDate = order.createdAt ?? null;

        if (matchedCode) {
          // Affiliate order
          const discountApps = (
            order.discountApplications?.nodes ?? []
          ) as DiscountApp[];
          const { affiliateDiscount, siteDiscount } = computeDiscountSplit(
            discountApps,
            matchedCode,
            subtotal,
          );

          const lineItems = (order.lineItems?.nodes ?? []).map((li: any) => ({
            title: li.title,
            quantity: li.quantity,
            amount: li.originalTotalSet
              ? parseFloat(li.originalTotalSet.shopMoney.amount)
              : 0,
            productId: li.product?.id ?? null,
          }));

          affiliateRows.push({
            id: order.id,
            shop,
            orderName: order.name ?? null,
            customerId: order.customer?.id ?? null,
            affiliateCode: matchedCode,
            discountAmount: discountTotal,
            affiliateDiscount,
            siteDiscount,
            totalAmount: total,
            subtotalAmount: subtotal,
            currencyCode,
            itemCount: lineItems.reduce(
              (sum: number, li: any) => sum + li.quantity,
              0,
            ),
            lineItemsJson: JSON.stringify(lineItems),
            orderDate,
          });
        } else {
          // Organic order
          if (orderDate) {
            const month = toMonthKey(orderDate);
            let bucket = organicMap.get(month);
            if (!bucket) {
              bucket = {
                orderCount: 0,
                revenue: 0,
                subtotal: 0,
                siteDiscountTotal: 0,
                customerIds: new Set<string>(),
                currencyCode,
              };
              organicMap.set(month, bucket);
            }
            bucket.orderCount++;
            bucket.revenue += total;
            bucket.subtotal += subtotal;
            bucket.siteDiscountTotal += discountTotal;
            if (order.customer?.id) {
              bucket.customerIds.add(order.customer.id);
            }
          }
        }
      }

      hasNextPage = json.data.orders.pageInfo.hasNextPage;
      cursor = json.data.orders.pageInfo.endCursor;
      pageCount++;

      const elapsed = ((Date.now() - syncStart) / 1000).toFixed(1);
      console.info(
        `[affiliates:sync] page=${pageCount} pageNodes=${nodes.length} totalOrders=${totalOrders} affiliateRows=${affiliateRows.length} elapsed=${elapsed}s shop=${shop}`,
      );

      if (pageCount % 3 === 0) {
        await writeAffiliateSyncProgress(shop, "fetching orders", totalOrders);
      }
    }

    // 3. Bulk upsert affiliate orders
    await writeAffiliateSyncProgress(shop, "saving affiliate orders", affiliateRows.length);
    console.info(
      `[affiliates:sync] upserting ${affiliateRows.length} affiliate orders shop=${shop}`,
    );

    for (let start = 0; start < affiliateRows.length; start += BATCH_SIZE) {
      const batch = affiliateRows.slice(start, start + BATCH_SIZE);
      const values = batch.map((o) => {
        const esc = (v: string | null) =>
          v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`;
        const orderDateSql = o.orderDate
          ? `'${new Date(o.orderDate).toISOString()}'::timestamp`
          : "NULL";
        return `(${esc(o.id)}, ${esc(o.shop)}, ${esc(o.orderName)}, ${esc(o.customerId)}, ${esc(o.affiliateCode)}, ${o.discountAmount}, ${o.affiliateDiscount}, ${o.siteDiscount}, ${o.totalAmount}, ${o.subtotalAmount}, ${esc(o.currencyCode)}, false, ${o.itemCount}, ${esc(o.lineItemsJson)}, ${orderDateSql}, NOW())`;
      });

      await prisma.$executeRawUnsafe(`
        INSERT INTO "AffiliateOrder" ("id", "shop", "orderName", "customerId", "affiliateCode", "discountAmount", "affiliateDiscount", "siteDiscount", "totalAmount", "subtotalAmount", "currencyCode", "isFirstOrder", "itemCount", "lineItemsJson", "orderDate", "syncedAt")
        VALUES ${values.join(",\n")}
        ON CONFLICT ("id") DO UPDATE SET
          "orderName" = EXCLUDED."orderName",
          "customerId" = EXCLUDED."customerId",
          "affiliateCode" = EXCLUDED."affiliateCode",
          "discountAmount" = EXCLUDED."discountAmount",
          "affiliateDiscount" = EXCLUDED."affiliateDiscount",
          "siteDiscount" = EXCLUDED."siteDiscount",
          "totalAmount" = EXCLUDED."totalAmount",
          "subtotalAmount" = EXCLUDED."subtotalAmount",
          "currencyCode" = EXCLUDED."currencyCode",
          "itemCount" = EXCLUDED."itemCount",
          "lineItemsJson" = EXCLUDED."lineItemsJson",
          "orderDate" = EXCLUDED."orderDate",
          "syncedAt" = NOW()
      `);
    }

    // 4. Bulk upsert organic aggs
    await writeAffiliateSyncProgress(shop, "saving organic data", organicMap.size);
    console.info(
      `[affiliates:sync] upserting ${organicMap.size} organic monthly buckets shop=${shop}`,
    );

    if (organicMap.size > 0) {
      const shopEscOrg = shop.replace(/'/g, "''");

      const organicValues: string[] = [];
      for (const [month, bucket] of organicMap) {
        const esc = (v: string | null) =>
          v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`;
        const aov =
          bucket.orderCount > 0
            ? bucket.revenue / bucket.orderCount
            : 0;
        const orgRowId = `oag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}_${organicValues.length}`;
        organicValues.push(
          `(${esc(orgRowId)}, ${esc(shop)}, ${esc(month)}, ${bucket.orderCount}, ${bucket.revenue}, ${bucket.subtotal}, ${bucket.siteDiscountTotal}, ${bucket.customerIds.size}, 0, 0, ${aov}, ${esc(bucket.currencyCode)})`,
        );
      }

      // Atomic DELETE + INSERT inside a transaction to prevent data loss on crash
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `DELETE FROM "AffiliateOrganicAgg" WHERE "shop" = '${shopEscOrg}'`,
        );

        for (
          let start = 0;
          start < organicValues.length;
          start += BATCH_SIZE
        ) {
          const batch = organicValues.slice(start, start + BATCH_SIZE);
          await tx.$executeRawUnsafe(`
            INSERT INTO "AffiliateOrganicAgg" ("id", "shop", "month", "orderCount", "revenue", "subtotal", "siteDiscountTotal", "uniqueCustomers", "newCustomers", "repeatCustomers", "avgOrderValue", "currencyCode")
            VALUES ${batch.join(",\n")}
            ON CONFLICT ("shop", "month") DO UPDATE SET
              "orderCount" = EXCLUDED."orderCount",
              "revenue" = EXCLUDED."revenue",
              "subtotal" = EXCLUDED."subtotal",
              "siteDiscountTotal" = EXCLUDED."siteDiscountTotal",
              "uniqueCustomers" = EXCLUDED."uniqueCustomers",
              "avgOrderValue" = EXCLUDED."avgOrderValue",
              "currencyCode" = EXCLUDED."currencyCode"
          `);
        }
      });
    }

    // 5. Attribute first orders and rebuild monthly aggregates
    await writeAffiliateSyncProgress(shop, "computing first orders", 0);
    await attributeFirstOrders(shop);

    await writeAffiliateSyncProgress(shop, "rebuilding monthly", 0);
    await rebuildAffiliateMonthly(shop);

    // 6. Done
    await writeAffiliateSyncMeta(shop, "idle", {
      totalOrders,
      totalAffiliateOrders: affiliateRows.length,
    });

    const totalSec = ((Date.now() - syncStart) / 1000).toFixed(1);
    console.info(
      `[affiliates:sync] === backfillAffiliateOrders DONE shop=${shop} totalOrders=${totalOrders} affiliateOrders=${affiliateRows.length} organicMonths=${organicMap.size} duration=${totalSec}s ===`,
    );
  } catch (error) {
    console.error(`[affiliates:sync] backfillAffiliateOrders FAILED shop=${shop}`, error);
    await writeAffiliateSyncMeta(shop, "failed", {
      errorMessage: String((error as Error)?.message ?? "Unknown sync error"),
    });
  }
}
