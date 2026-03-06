import type { ActionFunctionArgs } from "react-router";
import { normalizeWebhookTopic, verifyWebhookRequest } from "../webhooks.server";
import {
  readAnalyticsCache,
  writeAnalyticsCache,
  type OrderGeo,
} from "../retail-expansion/storage.server";
import { autoAssignOrderToRoute } from "../services/auto-routing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { topic, payload, shop } = verified.result;
  const normalizedTopic = normalizeWebhookTopic(String(topic));
  if (!["ORDERS_CREATE", "ORDERS_UPDATE", "ORDERS_DELETE"].includes(normalizedTopic)) {
    return new Response("Unsupported webhook topic.", { status: 400 });
  }
  const cache = await readAnalyticsCache(shop);

  if (normalizedTopic === "ORDERS_DELETE") {
    const orderId = String(payload?.id ?? "");
    cache.orders = cache.orders.filter((order) => order.id !== orderId);
  } else {
    const next = toOrderGeo(payload);
    if (next) {
      const index = cache.orders.findIndex((item) => item.id === next.id);
      if (index >= 0) {
        cache.orders[index] = next;
      } else {
        cache.orders.push(next);
      }
    }
  }

  cache.updatedAt = new Date().toISOString();
  await writeAnalyticsCache(cache, shop);

  // Fire-and-forget auto-routing on new LOCAL delivery orders — must not block the webhook response
  if (normalizedTopic === "ORDERS_CREATE") {
    const { admin } = verified.result;
    autoAssignOrderToRoute(shop, payload as any, admin).catch((err) =>
      console.error("[webhooks.orders] Auto-routing fire-and-forget error:", err),
    );
  }

  return new Response();
};

const toOrderGeo = (payload: any): OrderGeo | null => {
  const address = payload?.shipping_address ?? null;
  const latitude = address?.latitude;
  const longitude = address?.longitude;
  return {
    id: String(payload.id),
    name: payload?.name ?? String(payload?.order_number ?? ""),
    customerId: payload?.customer?.id ? String(payload.customer.id) : null,
    customerName: payload?.customer?.first_name
      ? `${payload.customer.first_name} ${payload.customer.last_name ?? ""}`.trim()
      : null,
    city: typeof address?.city === "string" ? address.city : null,
    latitude: latitude == null ? null : Number(latitude),
    longitude: longitude == null ? null : Number(longitude),
    totalAmount: payload?.current_total_price
      ? Number(payload.current_total_price)
      : null,
    currencyCode: payload?.currency ?? null,
    createdAt:
      typeof payload?.created_at === "string" ? payload.created_at : null,
  };
};
