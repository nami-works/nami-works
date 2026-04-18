/**
 * Shop Ingest — canonical order write path.
 *
 * `ingestOrder` takes a Shopify order payload (webhook REST payload OR GraphQL
 * node) and upserts the canonical `ShopOrder` row. Phase 1 runs this in SHADOW
 * MODE alongside existing feature-specific upserts — no feature reads from
 * `ShopOrder` yet. Phase 3 flips features to read from projections of this
 * table.
 *
 * Accepts two payload shapes so webhook and reconcile cron share one code path:
 * - REST webhook payload (snake_case fields, `admin_graphql_api_id`)
 * - GraphQL node (camelCase fields, `id`)
 */

import prisma from "../../db.server";
import { toJsonInput, toJsonArrayInput } from "./json-helpers";

export type ShopOrderIngestSource = "webhook" | "reconcile" | "backfill";

type UnknownRecord = Record<string, unknown>;

const asString = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
};

const asNumber = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asDate = (v: unknown): Date | null => {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
};

const parseTags = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
};

const pickMoneyAmount = (obj: unknown): number | null => {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as UnknownRecord;
  // GraphQL currentTotalPriceSet.shopMoney.amount
  const shopMoney = record.shopMoney as UnknownRecord | undefined;
  if (shopMoney && shopMoney.amount != null) return asNumber(shopMoney.amount);
  // flat amount
  if (record.amount != null) return asNumber(record.amount);
  return null;
};

const pickCurrency = (obj: unknown): string | null => {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as UnknownRecord;
  const shopMoney = record.shopMoney as UnknownRecord | undefined;
  if (shopMoney && typeof shopMoney.currencyCode === "string") {
    return shopMoney.currencyCode;
  }
  if (typeof record.currencyCode === "string") return record.currencyCode;
  return null;
};

/**
 * Canonicalize a Shopify order payload — works for both REST webhook payloads
 * and GraphQL nodes. Returns a row ready for `prisma.shopOrder.upsert`, or
 * `null` if required fields are missing.
 */
export function canonicalizeOrderPayload(
  shop: string,
  payload: UnknownRecord,
  source: ShopOrderIngestSource,
): {
  shop: string;
  id: string;
  legacyId: string | null;
  name: string | null;
  sourceName: string | null;
  status: string | null;
  orderDate: Date;
  createdAt: Date;
  shopifyUpdatedAt: Date;
  cancelledAt: Date | null;
  closedAt: Date | null;
  customerId: string | null;
  currencyCode: string | null;
  currentTotalPrice: number;
  currentTotalDiscounts: number;
  currentTotalRefunded: number;
  locationId: string | null;
  shippingAddressJson: UnknownRecord | null;
  billingAddressJson: UnknownRecord | null;
  customerJson: UnknownRecord | null;
  tagsJson: string[];
  refundsJson: UnknownRecord[] | null;
  lineItemsJson: UnknownRecord[] | null;
  staffMemberId: string | null;
  staffMemberName: string | null;
  ingestedVia: ShopOrderIngestSource;
} | null {
  // GID resolution — webhook REST uses `admin_graphql_api_id`, GraphQL uses `id`.
  const idRaw = payload.admin_graphql_api_id ?? payload.id;
  const id = asString(idRaw);
  if (!id) return null;
  // If it's a numeric legacy id (REST), wrap to a GID.
  const gid = id.startsWith("gid://shopify/Order/")
    ? id
    : `gid://shopify/Order/${id}`;

  const legacyId = payload.id != null ? asString(payload.id) : null;

  const name = asString(payload.name);

  const sourceName = asString(
    (payload as UnknownRecord).source_name ??
      (payload as UnknownRecord).sourceName,
  );

  // Status: Shopify REST uses cancelled_at + closed_at + financial_status; we
  // derive a coarse high-level status here.
  const cancelledAt = asDate(
    (payload as UnknownRecord).cancelled_at ??
      (payload as UnknownRecord).cancelledAt,
  );
  const closedAt = asDate(
    (payload as UnknownRecord).closed_at ??
      (payload as UnknownRecord).closedAt,
  );
  let status: string | null = null;
  if (cancelledAt) status = "cancelled";
  else if (closedAt) status = "closed";
  else status = "open";

  const orderDateSource =
    asDate(
      (payload as UnknownRecord).processed_at ??
        (payload as UnknownRecord).processedAt,
    ) ??
    asDate(
      (payload as UnknownRecord).created_at ??
        (payload as UnknownRecord).createdAt,
    );
  const createdAt =
    asDate(
      (payload as UnknownRecord).created_at ??
        (payload as UnknownRecord).createdAt,
    ) ?? orderDateSource;
  const shopifyUpdatedAt =
    asDate(
      (payload as UnknownRecord).updated_at ??
        (payload as UnknownRecord).updatedAt,
    ) ?? createdAt;
  if (!orderDateSource || !createdAt || !shopifyUpdatedAt) return null;

  // Customer — REST payload has `customer` object with admin_graphql_api_id,
  // GraphQL has `customer { id, displayName, email, phone }`.
  const customer = (payload as UnknownRecord).customer as
    | UnknownRecord
    | null
    | undefined;
  let customerId: string | null = null;
  let customerJson: UnknownRecord | null = null;
  if (customer && typeof customer === "object") {
    const cid = asString(customer.admin_graphql_api_id ?? customer.id);
    if (cid) {
      customerId = cid.startsWith("gid://shopify/Customer/")
        ? cid
        : `gid://shopify/Customer/${cid}`;
    }
    customerJson = {
      id: customerId,
      email: asString(customer.email),
      displayName: asString(
        (customer as UnknownRecord).displayName ??
          (customer as UnknownRecord).display_name,
      ),
      firstName: asString(
        (customer as UnknownRecord).first_name ??
          (customer as UnknownRecord).firstName,
      ),
      lastName: asString(
        (customer as UnknownRecord).last_name ??
          (customer as UnknownRecord).lastName,
      ),
      phone: asString(customer.phone),
    };
  }

  const currentTotalPrice =
    asNumber((payload as UnknownRecord).current_total_price) ??
    pickMoneyAmount((payload as UnknownRecord).currentTotalPriceSet) ??
    asNumber((payload as UnknownRecord).total_price) ??
    0;

  const currentTotalDiscounts =
    asNumber((payload as UnknownRecord).current_total_discounts) ??
    pickMoneyAmount((payload as UnknownRecord).currentTotalDiscountsSet) ??
    asNumber((payload as UnknownRecord).total_discounts) ??
    0;

  // Total refunded — REST provides refunds[].transactions[].amount; GraphQL
  // provides totalRefundedSet.shopMoney.amount.
  let currentTotalRefunded =
    pickMoneyAmount((payload as UnknownRecord).totalRefundedSet) ?? 0;
  const refundsArray = Array.isArray((payload as UnknownRecord).refunds)
    ? ((payload as UnknownRecord).refunds as UnknownRecord[])
    : null;
  if (refundsArray && currentTotalRefunded === 0) {
    for (const refund of refundsArray) {
      const txs = Array.isArray(refund.transactions)
        ? (refund.transactions as UnknownRecord[])
        : [];
      for (const tx of txs) {
        const amt = asNumber(tx.amount);
        if (amt != null) currentTotalRefunded += amt;
      }
    }
  }

  const currencyCode =
    asString((payload as UnknownRecord).currency) ??
    pickCurrency((payload as UnknownRecord).currentTotalPriceSet);

  // Location — REST uses legacy numeric `location_id`; GraphQL uses
  // `physicalLocation { id, name }`.
  let locationId: string | null = null;
  const legacyLocationId = (payload as UnknownRecord).location_id;
  if (legacyLocationId != null) {
    locationId = `gid://shopify/Location/${asString(legacyLocationId)}`;
  } else {
    const physicalLocation = (payload as UnknownRecord).physicalLocation as
      | UnknownRecord
      | null
      | undefined;
    if (physicalLocation && typeof physicalLocation === "object") {
      locationId = asString(physicalLocation.id);
    }
  }

  const shippingAddressJson =
    ((payload as UnknownRecord).shipping_address as UnknownRecord | null) ??
    ((payload as UnknownRecord).shippingAddress as UnknownRecord | null) ??
    null;
  const billingAddressJson =
    ((payload as UnknownRecord).billing_address as UnknownRecord | null) ??
    ((payload as UnknownRecord).billingAddress as UnknownRecord | null) ??
    null;

  const tagsJson = parseTags((payload as UnknownRecord).tags);

  const lineItemsRaw =
    (payload as UnknownRecord).line_items ??
    (payload as UnknownRecord).lineItems;
  const lineItemsJson = Array.isArray(lineItemsRaw)
    ? (lineItemsRaw as UnknownRecord[])
    : null;

  // Staff member — REST payload has `staff_member { id, name }` on POS orders.
  const staffMember = (payload as UnknownRecord).staff_member as
    | UnknownRecord
    | null
    | undefined;
  const staffMemberId = staffMember
    ? asString(staffMember.id ?? staffMember.admin_graphql_api_id)
    : null;
  const staffMemberName = staffMember
    ? asString(staffMember.name ?? staffMember.displayName)
    : null;

  return {
    shop,
    id: gid,
    legacyId,
    name,
    sourceName,
    status,
    orderDate: orderDateSource,
    createdAt,
    shopifyUpdatedAt,
    cancelledAt,
    closedAt,
    customerId,
    currencyCode,
    currentTotalPrice,
    currentTotalDiscounts,
    currentTotalRefunded,
    locationId,
    shippingAddressJson,
    billingAddressJson,
    customerJson,
    tagsJson,
    refundsJson: refundsArray,
    lineItemsJson,
    staffMemberId,
    staffMemberName,
    ingestedVia: source,
  };
}

/**
 * Upsert a single order into `ShopOrder`. Idempotent — safe to call from
 * webhooks, reconcile cron, or backfill. On conflict, preserves `ingestedAt`
 * but updates every other field.
 */
export async function ingestOrder(
  shop: string,
  payload: UnknownRecord,
  source: ShopOrderIngestSource,
): Promise<{ ok: boolean; id: string | null; reason?: string }> {
  const row = canonicalizeOrderPayload(shop, payload, source);
  if (!row) {
    return { ok: false, id: null, reason: "canonicalize-failed" };
  }

  try {
    const jsonFields = {
      shippingAddressJson: toJsonInput(row.shippingAddressJson),
      billingAddressJson: toJsonInput(row.billingAddressJson),
      customerJson: toJsonInput(row.customerJson),
      tagsJson: toJsonArrayInput(row.tagsJson) ?? [],
      refundsJson: toJsonArrayInput(row.refundsJson),
      lineItemsJson: toJsonArrayInput(row.lineItemsJson),
    };
    await prisma.shopOrder.upsert({
      where: { shop_id: { shop: row.shop, id: row.id } },
      create: {
        shop: row.shop,
        id: row.id,
        legacyId: row.legacyId,
        name: row.name,
        sourceName: row.sourceName,
        status: row.status,
        orderDate: row.orderDate,
        createdAt: row.createdAt,
        shopifyUpdatedAt: row.shopifyUpdatedAt,
        cancelledAt: row.cancelledAt,
        closedAt: row.closedAt,
        customerId: row.customerId,
        currencyCode: row.currencyCode,
        currentTotalPrice: row.currentTotalPrice,
        currentTotalDiscounts: row.currentTotalDiscounts,
        currentTotalRefunded: row.currentTotalRefunded,
        locationId: row.locationId,
        staffMemberId: row.staffMemberId,
        staffMemberName: row.staffMemberName,
        ingestedVia: row.ingestedVia,
        ...jsonFields,
      },
      update: {
        legacyId: row.legacyId,
        name: row.name,
        sourceName: row.sourceName,
        status: row.status,
        orderDate: row.orderDate,
        createdAt: row.createdAt,
        shopifyUpdatedAt: row.shopifyUpdatedAt,
        cancelledAt: row.cancelledAt,
        closedAt: row.closedAt,
        customerId: row.customerId,
        currencyCode: row.currencyCode,
        currentTotalPrice: row.currentTotalPrice,
        currentTotalDiscounts: row.currentTotalDiscounts,
        currentTotalRefunded: row.currentTotalRefunded,
        locationId: row.locationId,
        staffMemberId: row.staffMemberId,
        staffMemberName: row.staffMemberName,
        ingestedVia: row.ingestedVia,
        ...jsonFields,
      },
    });

    // Bump watermark — used by the hourly reconcile cron to skip quiet shops.
    await prisma.shopIngestMeta.upsert({
      where: { shop },
      create: {
        shop,
        ordersLastSeenUpdatedAt: row.shopifyUpdatedAt,
      },
      update: {
        ordersLastSeenUpdatedAt: row.shopifyUpdatedAt,
      },
    });

    return { ok: true, id: row.id };
  } catch (err) {
    console.error(
      `[shop-ingest:orders] upsert FAILED shop=${shop} orderId=${row.id}`,
      err,
    );
    return { ok: false, id: row.id, reason: "db-error" };
  }
}

/** Delete a ShopOrder by id (for ORDERS_DELETE webhook). */
export async function deleteIngestedOrder(
  shop: string,
  orderId: string,
): Promise<void> {
  const gid = orderId.startsWith("gid://shopify/Order/")
    ? orderId
    : `gid://shopify/Order/${orderId}`;
  await prisma.shopOrder
    .delete({ where: { shop_id: { shop, id: gid } } })
    .catch(() => {
      // swallow — delete-on-missing is fine
    });
}
