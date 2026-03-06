import type { ActionFunctionArgs } from "react-router";
import { normalizeWebhookTopic, verifyWebhookRequest } from "../webhooks.server";
import {
  readAnalyticsCache,
  writeAnalyticsCache,
  type CustomerGeo,
} from "../retail-expansion/storage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { topic, payload, shop } = verified.result;
  const normalizedTopic = normalizeWebhookTopic(String(topic));
  if (!["CUSTOMERS_CREATE", "CUSTOMERS_UPDATE", "CUSTOMERS_DELETE"].includes(normalizedTopic)) {
    return new Response("Unsupported webhook topic.", { status: 400 });
  }
  const cache = await readAnalyticsCache(shop);

  if (normalizedTopic === "CUSTOMERS_DELETE") {
    const customerId = String(payload?.id ?? "");
    cache.customers = cache.customers.filter(
      (customer) => customer.id !== customerId,
    );
  } else {
    const next = toCustomerGeo(payload);
    if (next) {
      const index = cache.customers.findIndex((item) => item.id === next.id);
      if (index >= 0) {
        cache.customers[index] = next;
      } else {
        cache.customers.push(next);
      }
    }
  }

  cache.updatedAt = new Date().toISOString();
  await writeAnalyticsCache(cache, shop);
  return new Response();
};

const toCustomerGeo = (payload: any): CustomerGeo | null => {
  const address = payload?.default_address ?? null;
  const latitude = address?.latitude;
  const longitude = address?.longitude;
  if (latitude == null || longitude == null) return null;
  return {
    id: String(payload.id),
    name:
      payload?.name ??
      [payload?.first_name, payload?.last_name].filter(Boolean).join(" ") ??
      null,
    latitude: Number(latitude),
    longitude: Number(longitude),
    createdAt:
      typeof payload?.created_at === "string" ? payload.created_at : null,
  };
};
