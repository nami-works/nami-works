import type { ActionFunctionArgs } from "react-router";
import { normalizeWebhookTopic, verifyWebhookRequest } from "../webhooks.server";
import { upsertRetailCustomers } from "../retail-footprint/analytics-queries.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const verified = await verifyWebhookRequest(request);
  if (verified.response) return verified.response;

  const { topic, payload, shop } = verified.result;
  const normalizedTopic = normalizeWebhookTopic(String(topic));
  console.info(`[webhooks:customers] received topic=${normalizedTopic} shop=${shop}`);

  if (!["CUSTOMERS_CREATE", "CUSTOMERS_UPDATE", "CUSTOMERS_DELETE"].includes(normalizedTopic)) {
    console.warn(`[webhooks:customers] unsupported topic SKIP shop=${shop} topic=${normalizedTopic}`);
    return new Response("Unsupported webhook topic.", { status: 400 });
  }

  if (normalizedTopic === "CUSTOMERS_DELETE") {
    const customerId = String(payload?.admin_graphql_api_id ?? payload?.id ?? "?");
    await prisma.retailCustomer.deleteMany({ where: { id: customerId, shop } }).catch(() => {});
    console.info(`[webhooks:customers] delete customer OK shop=${shop} customerId=${customerId}`);
  } else {
    const customer = toCustomerRow(payload);
    if (customer) {
      await upsertRetailCustomers(shop, [customer]).catch((err) => {
        console.warn(`[webhooks:customers] upsertRetailCustomers SKIP shop=${shop}`, err);
      });
      console.info(`[webhooks:customers] upsert customer OK shop=${shop} customerId=${customer.id} topic=${normalizedTopic}`);
    } else {
      console.warn(`[webhooks:customers] toCustomerRow SKIP shop=${shop} reason=no address with coords or city`);
    }
  }

  return new Response();
};

const toCustomerRow = (payload: any) => {
  const address = payload?.default_address ?? null;
  const latitude = address?.latitude != null ? Number(address.latitude) : null;
  const longitude = address?.longitude != null ? Number(address.longitude) : null;
  const city = typeof address?.city === "string" ? address.city.trim() : null;
  if (!latitude && !longitude && !city) return null;
  return {
    id: String(payload.admin_graphql_api_id ?? payload.id),
    city,
    latitude,
    longitude,
    createdAt: typeof payload?.created_at === "string" ? payload.created_at : null,
  };
};
