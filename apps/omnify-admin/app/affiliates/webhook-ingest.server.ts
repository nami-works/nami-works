/**
 * Affiliates — webhook-path single-order ingest.
 *
 * Parity with the cron-path `backfillAffiliateOrders` in sync.server.ts, but
 * scoped to ONE order from a REST webhook payload. The full cron still runs
 * hourly to reconcile anything webhook-dropped or out-of-band edited.
 *
 * Called from app/routes/webhooks.orders.tsx behind the
 * AFFILIATES_WEBHOOK_WRITE kill-switch. Safe to call 2-3x for the same order
 * (ON CONFLICT upserts).
 */

import prisma from "../db.server";
import { computeDiscountSplit, toMonthKey } from "./sync.server";
import {
  IGLU_SOURCE_NAME,
  WHATSAPP_HEXAGON_SOURCE_NAME,
} from "./attribution.server";

// ─── Affiliate codes cache (10-min TTL, per shop) ───────────────────────────
// Mirrors retailLocationCache in webhooks.orders.tsx — avoids a Prisma query
// on every single webhook. Multi-instance safe: each ECS task keeps its own
// map; the TTL bounds cross-instance drift.

const codeCache = new Map<string, { codes: Set<string>; expires: number }>();
const AFFILIATE_CODES_TTL_MS = 10 * 60 * 1000;

export async function getAffiliateCodesCached(shop: string): Promise<Set<string>> {
  const cached = codeCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.codes;
  const profiles = await prisma.affiliateProfile.findMany({
    where: { shop },
    select: { code: true },
  });
  const codes = new Set(profiles.map((p) => p.code.toLowerCase()));
  codeCache.set(shop, {
    codes,
    expires: Date.now() + AFFILIATE_CODES_TTL_MS,
  });
  return codes;
}

/** Called by storage.server.ts whenever an AffiliateProfile row is written. */
export function invalidateAffiliateCodesCache(shop: string): void {
  codeCache.delete(shop);
}

// ─── REST → DiscountApp[] adapter ───────────────────────────────────────────
// Normalizes a REST webhook payload's `discount_applications` into the same
// shape the GraphQL-based `computeDiscountSplit` expects, so we share one
// discount-splitting implementation between webhook + cron paths.

type DiscountApp = {
  __typename?: string;
  code?: string;
  title?: string;
  value?: {
    __typename?: string;
    amount?: string;
    percentage?: number;
  };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRestDiscountApplications(payload: any): DiscountApp[] {
  const apps = Array.isArray(payload?.discount_applications)
    ? payload.discount_applications
    : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return apps.map((a: any) => {
    const type = String(a?.type ?? "").toLowerCase();
    const typename =
      type === "discount_code"
        ? "DiscountCodeApplication"
        : type === "manual"
          ? "ManualDiscountApplication"
          : type === "automatic"
            ? "AutomaticDiscountApplication"
            : "DiscountCodeApplication";
    const valueType = String(a?.value_type ?? "").toLowerCase();
    let value: DiscountApp["value"];
    if (valueType === "percentage") {
      value = {
        __typename: "PricingPercentageValue",
        percentage: Number(a?.value ?? 0),
      };
    } else {
      // default: fixed_amount
      value = {
        __typename: "MoneyV2",
        amount: String(a?.value ?? "0"),
      };
    }
    return {
      __typename: typename,
      code: typeof a?.code === "string" ? a.code : undefined,
      title: typeof a?.title === "string" ? a.title : undefined,
      value,
    };
  });
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type AffiliateRow = {
  id: string;
  shop: string;
  orderName: string | null;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  wasPreExistingCustomer: boolean;
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
};

export type OrganicRow = {
  id: string;
  shop: string;
  orderName: string | null;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  totalAmount: number;
  subtotalAmount: number;
  discountAmount: number;
  currencyCode: string | null;
  wasPreExistingCustomer: boolean;
  itemCount: number;
  orderDate: string | null;
};

export type ClassifyResult =
  | { kind: "affiliate"; monthKey: string | null; row: AffiliateRow }
  | { kind: "organic"; monthKey: string | null; row: OrganicRow }
  | { kind: "skip"; reason: string };

// ─── Classify a REST webhook payload ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stringOrNull = (v: any): string | null =>
  v == null ? null : typeof v === "string" ? v : String(v);

function buildCustomerName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customer: any,
): string | null {
  const first = stringOrNull(customer?.first_name) ?? "";
  const last = stringOrNull(customer?.last_name) ?? "";
  const joined = `${first} ${last}`.trim();
  if (joined) return joined;
  const display =
    stringOrNull(customer?.displayName) ??
    stringOrNull(customer?.display_name);
  return display;
}

function classifyPreExistingCustomer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  customer: any,
  orderCreatedAt: string | null,
): boolean {
  if (!customer?.id) return false;
  const custOrders = Number(
    customer.orders_count ??
      customer.ordersCount ??
      customer.numberOfOrders ??
      0,
  );
  if (custOrders <= 1) return false;
  const custCreatedRaw =
    stringOrNull(customer.created_at) ?? stringOrNull(customer.createdAt);
  const custCreated = custCreatedRaw ? new Date(custCreatedRaw).getTime() : 0;
  const orderCreated = orderCreatedAt ? new Date(orderCreatedAt).getTime() : 0;
  const ONE_HOUR = 60 * 60 * 1000;
  return (
    custCreated > 0 && orderCreated > 0 && orderCreated - custCreated > ONE_HOUR
  );
}

export function classifyWebhookOrder(
  shop: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  affiliateCodes: Set<string>,
): ClassifyResult {
  const idRaw = payload?.admin_graphql_api_id ?? payload?.id;
  if (!idRaw) return { kind: "skip", reason: "no-id" };
  const orderGid = String(idRaw).startsWith("gid://shopify/Order/")
    ? String(idRaw)
    : `gid://shopify/Order/${idRaw}`;

  const customer = payload?.customer ?? null;
  const customerId = customer?.admin_graphql_api_id
    ? String(customer.admin_graphql_api_id)
    : customer?.id
      ? `gid://shopify/Customer/${customer.id}`
      : null;

  const subtotal = Number(payload?.subtotal_price ?? 0);
  const total = Number(
    payload?.current_total_price ?? payload?.total_price ?? 0,
  );
  const discountTotal = Number(
    payload?.current_total_discounts ?? payload?.total_discounts ?? 0,
  );
  const currencyCode = stringOrNull(payload?.currency);
  const orderDate = stringOrNull(payload?.created_at);

  const wasPreExistingCustomer = classifyPreExistingCustomer(
    customer,
    orderDate,
  );

  // REST webhook puts discount codes in two places:
  //   - discount_codes[]: [{code, amount, type}]
  //   - discount_applications[]: the split-ready list
  const discountCodeStrings: string[] = Array.isArray(payload?.discount_codes)
    ? payload.discount_codes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((d: any) => stringOrNull(d?.code) ?? "")
        .filter((s: string) => s.length > 0)
    : [];

  const matchedCode = discountCodeStrings.find((c: string) =>
    affiliateCodes.has(c.toLowerCase()),
  );

  const lineItems = Array.isArray(payload?.line_items)
    ? payload.line_items
    : [];
  const itemCount = lineItems.reduce(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sum: number, li: any) => sum + Number(li?.quantity ?? 0),
    0,
  );

  if (matchedCode) {
    const apps = normalizeRestDiscountApplications(payload);
    const { affiliateDiscount, siteDiscount } = computeDiscountSplit(
      apps,
      matchedCode,
      subtotal,
    );
    const lineItemsJson = JSON.stringify(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lineItems.map((li: any) => ({
        title: stringOrNull(li?.title) ?? "",
        quantity: Number(li?.quantity ?? 0),
        amount: Number(li?.price ?? 0) * Number(li?.quantity ?? 0),
        productId: li?.product_id
          ? `gid://shopify/Product/${li.product_id}`
          : null,
      })),
    );

    const row: AffiliateRow = {
      id: orderGid,
      shop,
      orderName: stringOrNull(payload?.name),
      customerId,
      customerName: buildCustomerName(customer),
      customerEmail: stringOrNull(customer?.email),
      wasPreExistingCustomer,
      affiliateCode: matchedCode,
      discountAmount: discountTotal,
      affiliateDiscount,
      siteDiscount,
      totalAmount: total,
      subtotalAmount: subtotal,
      currencyCode,
      itemCount,
      lineItemsJson,
      orderDate,
    };
    return {
      kind: "affiliate",
      monthKey: orderDate ? toMonthKey(orderDate) : null,
      row,
    };
  }

  const row: OrganicRow = {
    id: orderGid,
    shop,
    orderName: stringOrNull(payload?.name),
    customerId,
    customerName: buildCustomerName(customer),
    customerEmail: stringOrNull(customer?.email),
    totalAmount: total,
    subtotalAmount: subtotal,
    discountAmount: discountTotal,
    currencyCode,
    wasPreExistingCustomer,
    itemCount,
    orderDate,
  };
  return {
    kind: "organic",
    monthKey: orderDate ? toMonthKey(orderDate) : null,
    row,
  };
}

// ─── Single-row upserts (same ON CONFLICT shape as sync.server.ts batches) ──

export async function upsertAffiliateOrderFromWebhook(
  row: AffiliateRow,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "AffiliateOrder" (
      "id", "shop", "orderName", "customerId", "customerName", "customerEmail",
      "wasPreExistingCustomer", "affiliateCode", "discountAmount",
      "affiliateDiscount", "siteDiscount", "totalAmount", "subtotalAmount",
      "currencyCode", "itemCount", "lineItemsJson", "orderDate", "syncedAt"
    ) VALUES (
      ${row.id}, ${row.shop}, ${row.orderName}, ${row.customerId},
      ${row.customerName}, ${row.customerEmail}, ${row.wasPreExistingCustomer},
      ${row.affiliateCode}, ${row.discountAmount}, ${row.affiliateDiscount},
      ${row.siteDiscount}, ${row.totalAmount}, ${row.subtotalAmount},
      ${row.currencyCode}, ${row.itemCount}, ${row.lineItemsJson},
      ${row.orderDate ? new Date(row.orderDate) : null}, NOW()
    )
    ON CONFLICT ("id") DO UPDATE SET
      "orderName" = EXCLUDED."orderName",
      "customerId" = EXCLUDED."customerId",
      "customerName" = EXCLUDED."customerName",
      "customerEmail" = EXCLUDED."customerEmail",
      "wasPreExistingCustomer" = EXCLUDED."wasPreExistingCustomer",
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
  `;
}

export async function upsertOrganicOrderFromWebhook(
  row: OrganicRow,
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "OrganicOrder" (
      "id", "shop", "orderName", "customerId", "customerName", "customerEmail",
      "totalAmount", "subtotalAmount", "discountAmount", "currencyCode",
      "wasPreExistingCustomer", "itemCount", "orderDate", "syncedAt"
    ) VALUES (
      ${row.id}, ${row.shop}, ${row.orderName}, ${row.customerId},
      ${row.customerName}, ${row.customerEmail}, ${row.totalAmount},
      ${row.subtotalAmount}, ${row.discountAmount}, ${row.currencyCode},
      ${row.wasPreExistingCustomer}, ${row.itemCount},
      ${row.orderDate ? new Date(row.orderDate) : null}, NOW()
    )
    ON CONFLICT ("id") DO UPDATE SET
      "orderName" = EXCLUDED."orderName",
      "customerId" = EXCLUDED."customerId",
      "customerName" = EXCLUDED."customerName",
      "customerEmail" = EXCLUDED."customerEmail",
      "totalAmount" = EXCLUDED."totalAmount",
      "subtotalAmount" = EXCLUDED."subtotalAmount",
      "discountAmount" = EXCLUDED."discountAmount",
      "currencyCode" = EXCLUDED."currencyCode",
      "wasPreExistingCustomer" = EXCLUDED."wasPreExistingCustomer",
      "itemCount" = EXCLUDED."itemCount",
      "orderDate" = EXCLUDED."orderDate",
      "syncedAt" = NOW()
  `;
}

/**
 * Delete an order from whichever affiliate/organic table it lives in. Called
 * from the ORDERS_DELETE webhook branch. `deleteMany` instead of `delete` so
 * "not found" is not an error — another webhook replay or cron run may have
 * already removed the row.
 */
export async function deleteAffiliateOrOrganicOrder(
  shop: string,
  orderIdRaw: string,
): Promise<void> {
  const orderGid = orderIdRaw.startsWith("gid://shopify/Order/")
    ? orderIdRaw
    : `gid://shopify/Order/${orderIdRaw}`;
  await prisma.$transaction([
    prisma.affiliateOrder.deleteMany({ where: { id: orderGid, shop } }),
    prisma.organicOrder.deleteMany({ where: { id: orderGid, shop } }),
  ]);
}

// ─── Attribution candidate flagger (gated to gebeauty) ──────────────────────

const GEBEAUTY_SHOP = "ge-beauty-cosmeticos.myshopify.com";

/**
 * Creates an AttributionCandidate row when an IGLU POS / WhatsApp Hexagon
 * order arrives with a UGC coupon. Gated to gebeauty — the source-name
 * constants are GE-Beauty-specific app IDs. Other shops can share the same
 * numeric source names with different meanings; flagging them would pollute
 * the tab.
 */
export async function flagAttributionCandidateFromWebhook(
  shop: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
): Promise<{ flagged: boolean; reason?: string }> {
  if (shop !== GEBEAUTY_SHOP) {
    return { flagged: false, reason: "shop-not-gated" };
  }
  const sourceName = stringOrNull(payload?.source_name);
  if (sourceName !== IGLU_SOURCE_NAME && sourceName !== WHATSAPP_HEXAGON_SOURCE_NAME) {
    return { flagged: false, reason: "source-not-eligible" };
  }

  const attrs = Array.isArray(payload?.note_attributes)
    ? payload.note_attributes
    : [];
  const discountsInfoAttr = attrs.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (a: any) => a?.name === "order_discounts_info",
  );
  if (!discountsInfoAttr?.value) {
    return { flagged: false, reason: "no-discounts-info" };
  }
  let primaryCoupon: string | null = null;
  try {
    const parsed = JSON.parse(String(discountsInfoAttr.value));
    const items = Array.isArray(parsed) ? parsed : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coupons = items.filter((i: any) => i?.type === "coupon");
    const first = coupons[0];
    if (first?.code) primaryCoupon = String(first.code).toLowerCase();
  } catch {
    return { flagged: false, reason: "bad-discounts-info-json" };
  }
  if (!primaryCoupon) {
    return { flagged: false, reason: "no-coupon" };
  }

  const orderGid = payload?.admin_graphql_api_id
    ? String(payload.admin_graphql_api_id)
    : payload?.id
      ? `gid://shopify/Order/${payload.id}`
      : null;
  if (!orderGid) return { flagged: false, reason: "no-id" };

  const orderDate = payload?.created_at ? new Date(payload.created_at) : null;
  const orderName = stringOrNull(payload?.name);

  await prisma.attributionCandidate.upsert({
    where: { shop_orderGid: { shop, orderGid } },
    create: {
      shop,
      orderGid,
      orderName,
      sourceName,
      primaryCoupon,
      orderDate,
      discoveredVia: "webhook",
    },
    update: {
      orderName,
      sourceName,
      primaryCoupon,
      orderDate,
      // preserve discoveredVia/discoveredAt from the initial discovery
    },
  });
  return { flagged: true };
}
