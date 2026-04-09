import type { ActionFunctionArgs } from "react-router";
import { normalizeWebhookTopic, verifyWebhookRequest } from "../webhooks.server";
import {
  upsertRetailOrders,
  normalizeCityKey,
} from "../retail-footprint/analytics-queries.server";
import prisma from "../db.server";
import { autoAssignOrderToRoute } from "../services/auto-routing.server";
import { getAppIdentity } from "../utils/app-identity.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { topic, payload, shop } = verified.result;
  const normalizedTopic = normalizeWebhookTopic(String(topic));
  if (!["ORDERS_CREATE", "ORDERS_UPDATE", "ORDERS_DELETE"].includes(normalizedTopic)) {
    return new Response("Unsupported webhook topic.", { status: 400 });
  }

  const identity = getAppIdentity();
  const runAnalytics = identity === "cpg-labs" || identity === "omnify";
  const runAutoRouting = identity === "cpg-labs" || identity === "omnify";

  // Analytics: upsert/delete in normalized RetailOrder table
  if (runAnalytics) {
    if (normalizedTopic === "ORDERS_DELETE") {
      const orderId = String(payload?.admin_graphql_api_id ?? payload?.id ?? "");
      if (orderId) {
        await prisma.retailOrder.deleteMany({ where: { id: orderId, shop } }).catch(() => {});
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
    }
  }

  // Fire-and-forget auto-routing on new LOCAL delivery orders (omnify + cpg-labs)
  if (runAutoRouting && normalizedTopic === "ORDERS_CREATE") {
    console.info(`[local-delivery:webhook] orders/create auto-routing triggered shop=${shop} orderId=${payload?.id}`);
    const { admin } = verified.result;
    autoAssignOrderToRoute(shop, payload as any, admin).catch((err) =>
      console.error(`[local-delivery:webhook] auto-routing fire-and-forget error shop=${shop} orderId=${payload?.id}`, err),
    );
  }

  return new Response();
};

const toOrderRow = (payload: any, shop: string) => {
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
