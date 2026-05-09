import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";

const SECRET = "test-secret";
const SHOP = "test-shop.myshopify.com";

const buildHeaders = (topic: string, body: string, hmac?: string) => {
  const signature =
    hmac ??
    createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
  return new Headers({
    "Content-Type": "application/json",
    "X-Shopify-Topic": topic,
    "X-Shopify-Shop-Domain": SHOP,
    "X-Shopify-Hmac-Sha256": signature,
    "X-Shopify-Webhook-Id": "test-webhook-id",
    "X-Shopify-Api-Version": "2026-04",
  });
};

process.env.SHOPIFY_API_KEY = "test-key";
process.env.SHOPIFY_API_SECRET = SECRET;
process.env.SHOPIFY_APP_URL = "https://example.com";
process.env.SCOPES = "read_orders";

test("accepts valid compliance webhook", async () => {
  const body = JSON.stringify({
    shop_id: 123,
    shop_domain: SHOP,
    customer: { id: 456 },
    orders_to_redact: [789],
  });
  const headers = buildHeaders("customers/data_request", body);
  const request = new Request("https://example.com/webhooks", {
    method: "POST",
    headers,
    body,
  });

  const { action } = await import("../app/routes/webhooks");
  const response = await action({ request } as unknown as ActionFunctionArgs);

  assert.equal(response.status, 200);
});

test("returns 400 for unsupported compliance topic", async () => {
  const body = JSON.stringify({ shop_id: 1, shop_domain: SHOP });
  const headers = buildHeaders("products/create", body);
  const request = new Request("https://example.com/webhooks", {
    method: "POST",
    headers,
    body,
  });

  const { action } = await import("../app/routes/webhooks");
  const response = await action({ request } as unknown as ActionFunctionArgs);

  assert.equal(response.status, 400);
});

test("rejects compliance webhook with invalid HMAC", async () => {
  const body = JSON.stringify({ shop_id: 1, shop_domain: SHOP });
  const headers = buildHeaders("shop/redact", body, "invalid");
  const request = new Request("https://example.com/webhooks", {
    method: "POST",
    headers,
    body,
  });

  const { action } = await import("../app/routes/webhooks");
  const response = await action({ request } as unknown as ActionFunctionArgs);

  assert.equal(response.status, 401);
});

test("rejects compliance webhook with missing HMAC", async () => {
  const body = JSON.stringify({ shop_id: 1, shop_domain: SHOP });
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Shopify-Topic": "shop/redact",
    "X-Shopify-Shop-Domain": SHOP,
    "X-Shopify-Webhook-Id": "test-webhook-id",
    "X-Shopify-Api-Version": "2026-04",
  });
  const request = new Request("https://example.com/webhooks", {
    method: "POST",
    headers,
    body,
  });

  const { action } = await import("../app/routes/webhooks");
  const response = await action({ request } as unknown as ActionFunctionArgs);

  assert.equal(response.status, 401);
});

test("returns 405 for non-POST webhook requests", async () => {
  const request = new Request("https://example.com/webhooks", {
    method: "GET",
  });
  const { action } = await import("../app/routes/webhooks");
  const response = await action({ request } as unknown as ActionFunctionArgs);
  assert.equal(response.status, 405);
});

test("accepts valid non-compliance webhook", async () => {
  const body = JSON.stringify({
    id: 101,
    name: "#101",
    shipping_address: { latitude: -15.78, longitude: -47.93 },
    current_total_price: "10.00",
    currency: "BRL",
  });
  const headers = buildHeaders("orders/create", body);
  const request = new Request("https://example.com/webhooks/orders", {
    method: "POST",
    headers,
    body,
  });

  const { action } = await import("../app/routes/webhooks.orders");
  const response = await action({ request } as unknown as ActionFunctionArgs);

  assert.equal(response.status, 200);
});

test("returns 400 for unsupported non-compliance topic", async () => {
  const body = JSON.stringify({ id: 303 });
  const headers = buildHeaders("orders/fulfilled", body);
  const request = new Request("https://example.com/webhooks/orders", {
    method: "POST",
    headers,
    body,
  });

  const { action } = await import("../app/routes/webhooks.orders");
  const response = await action({ request } as unknown as ActionFunctionArgs);

  assert.equal(response.status, 400);
});

test("rejects non-compliance webhook before side effects", async () => {
  const body = JSON.stringify({
    id: 202,
    name: "#202",
    shipping_address: { latitude: -15.78, longitude: -47.93 },
  });
  const headers = buildHeaders("orders/create", body, "invalid");
  const request = new Request("https://example.com/webhooks/orders", {
    method: "POST",
    headers,
    body,
  });

  const { action } = await import("../app/routes/webhooks.orders");
  const response = await action({ request } as unknown as ActionFunctionArgs);

  assert.equal(response.status, 401);
});
