import type { ActionFunctionArgs } from "react-router";
import { normalizeWebhookTopic, verifyWebhookRequest } from "../webhooks.server";
import { upsertRetailOrders } from "../retail-footprint/analytics-queries.server";
import {
  upsertSalesOrders,
  recomputeMonthly,
  deleteSalesOrder,
} from "../sales-goals/analytics-queries.server";
import { fetchRetailLocations } from "../sales-goals/sync.server";
import { evaluateCampaignMatches } from "../campaign-goals/match.server";
import {
  resolveOrderLocation,
  monthKey,
  type OrderForResolution,
  type RetailLocation,
} from "../sales-goals/classification";
import prisma from "../db.server";
import { autoAssignOrderToRoute } from "../services/auto-routing.server";
import { getAppIdentity } from "../utils/app-identity.server";
import {
  ingestOrder,
  deleteIngestedOrder,
} from "../services/shop-ingest/orders.server";

// Module-level cache for retail locations per shop (10-minute TTL).
// Avoids a Shopify GraphQL call on every order webhook.
const retailLocationCache = new Map<
  string,
  { locations: RetailLocation[]; expires: number }
>();

const RETAIL_LOCATIONS_TTL_MS = 10 * 60 * 1000;

const getRetailLocationsCached = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  shop: string,
): Promise<RetailLocation[]> => {
  const cached = retailLocationCache.get(shop);
  if (cached && cached.expires > Date.now()) return cached.locations;
  const fresh = await fetchRetailLocations(admin);
  retailLocationCache.set(shop, {
    locations: fresh,
    expires: Date.now() + RETAIL_LOCATIONS_TTL_MS,
  });
  return fresh;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseTags = (raw: any): string[] => {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { topic, payload, shop } = verified.result;
  const normalizedTopic = normalizeWebhookTopic(String(topic));
  // Shopify sends `orders/updated` (past tense) → normalizes to ORDERS_UPDATED.
  // ORDERS_UPDATE kept for back-compat with any older subscription.
  if (
    !["ORDERS_CREATE", "ORDERS_UPDATE", "ORDERS_UPDATED", "ORDERS_DELETE"].includes(
      normalizedTopic,
    )
  ) {
    return new Response("Unsupported webhook topic.", { status: 400 });
  }

  const identity = getAppIdentity();
  const runAnalytics = identity === "cpg-labs" || identity === "omnify";
  const runAutoRouting = identity === "cpg-labs" || identity === "omnify";

  // Shadow-mode: write to canonical ShopOrder table alongside feature tables.
  // This is additive — existing code below still runs unchanged. Phase 3 flips
  // feature reads to project from ShopOrder.
  if (runAnalytics) {
    if (normalizedTopic === "ORDERS_DELETE") {
      const orderId = String(payload?.admin_graphql_api_id ?? payload?.id ?? "");
      if (orderId) {
        await deleteIngestedOrder(shop, orderId).catch((err) =>
          console.warn(
            `[shop-ingest:orders] delete SKIP shop=${shop} orderId=${orderId}`,
            err,
          ),
        );
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await ingestOrder(shop, payload as any, "webhook").catch((err) =>
        console.warn(
          `[shop-ingest:orders] ingest SKIP shop=${shop} orderId=${payload?.id}`,
          err,
        ),
      );
    }
  }

  // Analytics: upsert/delete in normalized RetailOrder + SalesOrder tables
  if (runAnalytics) {
    if (normalizedTopic === "ORDERS_DELETE") {
      const orderId = String(payload?.admin_graphql_api_id ?? payload?.id ?? "");
      if (orderId) {
        await prisma.retailOrder.deleteMany({ where: { id: orderId, shop } }).catch(() => {});
        // Look up the sales-order row first so we know which monthly bucket to recompute.
        const existing = await prisma.salesOrder.findUnique({
          where: { id: orderId },
          select: { locationId: true, orderDate: true },
        });
        await deleteSalesOrder(shop, orderId).catch(() => {});
        if (existing) {
          await recomputeMonthly(shop, existing.locationId, monthKey(existing.orderDate)).catch(
            () => {},
          );
        }
        console.info(`[webhooks:orders] delete order OK shop=${shop} orderId=${orderId}`);
      }
    } else {
      const order = toOrderRow(payload, shop);
      if (order) {
        await upsertRetailOrders(shop, [order]).catch((err) => {
          console.warn(`[webhooks:orders] upsertRetailOrders SKIP shop=${shop}`, err);
        });
        console.info(`[webhooks:orders] upsert order OK shop=${shop} orderId=${order.id} topic=${normalizedTopic}`);
      }

      // Sales-goals: POS orders only — resolve location via tags / physicalLocation.
      try {
        const { admin } = verified.result;
        const retailLocations = await getRetailLocationsCached(admin, shop);
        const salesRow = toSalesOrderRowFromWebhook(payload, retailLocations);
        if (salesRow) {
          await upsertSalesOrders(shop, [salesRow]);
          await recomputeMonthly(
            shop,
            salesRow.locationId,
            monthKey(salesRow.orderDate),
          );
          console.info(
            `[webhooks:orders:sales-goals] upsert OK shop=${shop} orderId=${salesRow.id} source=${salesRow.source} location=${salesRow.locationName}`,
          );
          // Campaign-goals match evaluation. Skips the line-item fetch if no
          // active campaign covers orderDate — near-zero cost most of the year.
          try {
            const { admin } = verified.result;
            const staffMemberId =
              typeof payload?.staff_member?.id === "string"
                ? payload.staff_member.id
                : payload?.staff_member?.id != null
                  ? String(payload.staff_member.id)
                  : null;
            await evaluateCampaignMatches({
              admin,
              shop,
              orderId: salesRow.id,
              orderDate: salesRow.orderDate,
              locationId: salesRow.locationId,
              staffMemberId,
            });
          } catch (err) {
            console.warn(
              `[webhooks:orders:campaign-goals] SKIP shop=${shop} orderId=${salesRow.id}`,
              err,
            );
          }
        } else {
          console.info(
            `[webhooks:orders:sales-goals] SKIP shop=${shop} orderId=${payload?.id} reason=not-pos-or-unmatched`,
          );
        }
      } catch (err) {
        console.warn(
          `[webhooks:orders:sales-goals] upsert SKIP shop=${shop} orderId=${payload?.id}`,
          err,
        );
      }
    }
  }

  // Fire-and-forget auto-routing on new LOCAL delivery orders (omnify + cpg-labs)
  if (runAutoRouting && normalizedTopic === "ORDERS_CREATE") {
    console.info(`[local-delivery:webhook] orders/create auto-routing triggered shop=${shop} orderId=${payload?.id}`);
    const { admin } = verified.result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    autoAssignOrderToRoute(shop, payload as any, admin).catch((err) =>
      console.error(`[local-delivery:webhook] auto-routing fire-and-forget error shop=${shop} orderId=${payload?.id}`, err),
    );
  }

  return new Response();
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const toOrderRow = (payload: any, _shop: string) => {
  const address = payload?.shipping_address ?? null;
  const city = typeof address?.city === "string" ? address.city.trim() : null;
  if (!city) return null;
  return {
    id: String(payload.admin_graphql_api_id ?? payload.id),
    customerId: payload?.customer?.admin_graphql_api_id
      ? String(payload.customer.admin_graphql_api_id)
      : payload?.customer?.id
        ? String(payload.customer.id)
        : null,
    city,
    latitude: address?.latitude != null ? Number(address.latitude) : null,
    longitude: address?.longitude != null ? Number(address.longitude) : null,
    totalAmount: payload?.current_total_price ? Number(payload.current_total_price) : null,
    currencyCode: payload?.currency ?? null,
    createdAt: typeof payload?.created_at === "string" ? payload.created_at : null,
  };
};

/**
 * Converts a Shopify order webhook payload into a SalesOrderRow, or returns
 * null if the order isn't POS or doesn't match any retail location.
 */
const toSalesOrderRowFromWebhook = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
  retailLocations: RetailLocation[],
) => {
  const id = payload?.admin_graphql_api_id
    ? String(payload.admin_graphql_api_id)
    : payload?.id
      ? `gid://shopify/Order/${payload.id}`
      : null;
  if (!id) return null;

  const tags = parseTags(payload?.tags);
  const sourceName: string | null = payload?.source_name ?? null;

  // Shopify POS webhook payload uses `location_id` (numeric legacy ID).
  const legacyLocationId = payload?.location_id;
  const physicalLocation = legacyLocationId
    ? {
        id: `gid://shopify/Location/${legacyLocationId}`,
        name: "",
      }
    : null;

  const forResolution: OrderForResolution = {
    name: String(payload?.name ?? ""),
    sourceName,
    tags,
    physicalLocation,
  };
  const resolved = resolveOrderLocation(forResolution, retailLocations);
  if (!resolved) return null;

  const currentTotal = payload?.current_total_price
    ? Number(payload.current_total_price)
    : payload?.total_price
      ? Number(payload.total_price)
      : 0;
  // REST webhook exposes refunds[].transactions[].amount; sum across all
  // refunds to get total refunded. Match the sync's `max(0, current - refunded)`
  // clamp so admin-reported "Total sales" matches to the cent.
  const refundsArray = Array.isArray(payload?.refunds) ? payload.refunds : [];
  let totalRefunded = 0;
  for (const refund of refundsArray) {
    const txs = Array.isArray(refund?.transactions) ? refund.transactions : [];
    for (const tx of txs) {
      const amt = Number(tx?.amount ?? 0);
      if (Number.isFinite(amt)) totalRefunded += amt;
    }
  }
  const totalAmount = Math.max(0, currentTotal - totalRefunded);
  // Shopify REST webhook: current_total_discounts reflects the post-edit amount.
  const discountAmount = payload?.current_total_discounts
    ? Number(payload.current_total_discounts)
    : payload?.total_discounts
      ? Number(payload.total_discounts)
      : 0;
  const currencyCode: string | null = payload?.currency ?? null;
  const orderDateSource: string | null =
    typeof payload?.processed_at === "string"
      ? payload.processed_at
      : typeof payload?.created_at === "string"
        ? payload.created_at
        : null;
  if (!orderDateSource) return null;

  return {
    id,
    source: resolved.source,
    locationId: resolved.locationId,
    locationName: resolved.locationName,
    orderDate: new Date(orderDateSource),
    totalAmount,
    discountAmount,
    currencyCode,
  };
};
