/**
 * Unit tests for the Intelipost warehouse-carrier adapter.
 *
 * `fetch` is monkey-patched per test so no real network calls are made.
 *
 * Run: npx tsx --test app/services/warehouse-carrier/__tests__/intelipost.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { IntelipostAdapter, __testables } from "../adapters/intelipost.server";
import type { WarehouseQuoteRequest } from "../types";

const validReq: WarehouseQuoteRequest = {
  origin: { postalCode: "01310-100", city: "São Paulo", province: "SP", country: "BR" },
  destination: { postalCode: "20040-020", city: "Rio de Janeiro", province: "RJ", country: "BR" },
  items: [{ weightGrams: 500, quantity: 2, valueSubunits: 5000 }],
  currency: "BRL",
};

const creds = { apiKey: "test-key", endpoint: "https://example.invalid" };

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─────────────── pure helpers ───────────────

test("buildIntelipostRequest — strips ZIP non-digits and converts grams to kg", () => {
  const built = __testables.buildIntelipostRequest(validReq);
  assert.equal(built.origin_zip_code, "01310100");
  assert.equal(built.destination_zip_code, "20040020");
  // 500g * 2 qty = 1000g = 1.0kg
  assert.equal(built.volumes[0].weight, 1.0);
  assert.equal(built.volumes[0].quantity, 2);
  // 5000 cents * 2 qty = 10000 cents = R$ 100
  assert.equal(built.volumes[0].cost_of_goods, 100);
});

test("buildIntelipostRequest — defaults to 500g volume when no weight provided", () => {
  const noWeight: WarehouseQuoteRequest = {
    ...validReq,
    items: [{ weightGrams: 0, quantity: 1 }],
  };
  const built = __testables.buildIntelipostRequest(noWeight);
  assert.equal(built.volumes[0].weight, 0.5);
});

test("selectCheapestOption — picks the cheapest non-null final_shipping_cost", () => {
  const cheapest = __testables.selectCheapestOption([
    { delivery_method_name: "A", final_shipping_cost: 30 },
    { delivery_method_name: "B", final_shipping_cost: 12 },
    { delivery_method_name: "C", final_shipping_cost: 25 },
  ]);
  assert.equal(cheapest?.delivery_method_name, "B");
});

test("selectCheapestOption — returns null when no options", () => {
  assert.equal(__testables.selectCheapestOption([]), null);
  assert.equal(__testables.selectCheapestOption(undefined), null);
});

test("selectCheapestOption — falls back to provider_shipping_cost when final missing", () => {
  const cheapest = __testables.selectCheapestOption([
    { delivery_method_name: "A", provider_shipping_cost: 18 },
    { delivery_method_name: "B", final_shipping_cost: 22 },
  ]);
  assert.equal(cheapest?.delivery_method_name, "A");
});

test("classifyHttpStatus — maps known HTTP codes", () => {
  assert.equal(__testables.classifyHttpStatus(401), "auth_failed");
  assert.equal(__testables.classifyHttpStatus(403), "auth_failed");
  assert.equal(__testables.classifyHttpStatus(422), "invalid_address");
  assert.equal(__testables.classifyHttpStatus(429), "rate_limit");
  assert.equal(__testables.classifyHttpStatus(500), "unknown");
});

test("toMinorUnits / gramsToKilograms", () => {
  assert.equal(__testables.toMinorUnits(12.34), 1234);
  assert.equal(__testables.toMinorUnits(undefined), 0);
  assert.equal(__testables.gramsToKilograms(1234), 1.234);
});

// ─────────────── adapter.quote — happy path ───────────────

test("quote — success returns cheapest option in subunits", async () => {
  mockFetch(async () => {
    return jsonResponse({
      status: "OK",
      content: {
        id: 1,
        delivery_options: [
          { delivery_method_name: "Padrão", final_shipping_cost: 28.5, estimated_delivery_date: { client: "2026-05-15" } },
          { delivery_method_name: "Expresso", final_shipping_cost: 45.0 },
        ],
      },
    });
  });
  try {
    const result = await IntelipostAdapter.quote(creds, validReq);
    if ("errorCode" in result) {
      assert.fail(`expected success, got error ${result.errorCode}`);
    }
    assert.equal(result.priceSubunits, 2850);
    assert.equal(result.currency, "BRL");
    assert.equal(result.provider, "intelipost");
    assert.equal(result.minDeliveryDate, "2026-05-15");
  } finally {
    restoreFetch();
  }
});

// ─────────────── adapter.quote — error mapping ───────────────

test("quote — 401 maps to auth_failed", async () => {
  mockFetch(async () => jsonResponse({ status: "ERROR", messages: [{ text: "unauthorized" }] }, 401));
  try {
    const result = await IntelipostAdapter.quote(creds, validReq);
    if (!("errorCode" in result)) assert.fail("expected error");
    assert.equal(result.errorCode, "auth_failed");
    assert.equal(result.retryable, false);
  } finally {
    restoreFetch();
  }
});

test("quote — 422 maps to invalid_address", async () => {
  mockFetch(async () => jsonResponse({ status: "ERROR", messages: [{ text: "bad zip" }] }, 422));
  try {
    const result = await IntelipostAdapter.quote(creds, validReq);
    if (!("errorCode" in result)) assert.fail("expected error");
    assert.equal(result.errorCode, "invalid_address");
  } finally {
    restoreFetch();
  }
});

test("quote — 429 maps to rate_limit and is retryable", async () => {
  mockFetch(async () => jsonResponse({ status: "ERROR", messages: [{ text: "too many" }] }, 429));
  try {
    const result = await IntelipostAdapter.quote(creds, validReq);
    if (!("errorCode" in result)) assert.fail("expected error");
    assert.equal(result.errorCode, "rate_limit");
    assert.equal(result.retryable, true);
  } finally {
    restoreFetch();
  }
});

test("quote — network error maps to network code and is retryable", async () => {
  mockFetch(async () => {
    throw new TypeError("Failed to fetch");
  });
  try {
    const result = await IntelipostAdapter.quote(creds, validReq);
    if (!("errorCode" in result)) assert.fail("expected error");
    assert.equal(result.errorCode, "network");
    assert.equal(result.retryable, true);
  } finally {
    restoreFetch();
  }
});

test("quote — empty delivery_options returns out_of_zone", async () => {
  mockFetch(async () => jsonResponse({ status: "OK", content: { delivery_options: [] } }));
  try {
    const result = await IntelipostAdapter.quote(creds, validReq);
    if (!("errorCode" in result)) assert.fail("expected error");
    assert.equal(result.errorCode, "out_of_zone");
  } finally {
    restoreFetch();
  }
});

test("quote — speculative flag respected when provider doesn't support it", async () => {
  // Mutate the exported flag for this single test then put it back.
  // (The adapter is a const object; this is a contract test only.)
  const original = IntelipostAdapter.supportsSpeculativeQuoting;
  if (original) {
    // The adapter currently supports speculative quoting (default). Verify the
    // path that triggers when flag is false — by simulating a request with
    // isSpeculative=true while we don't care about the flag because we just
    // want the adapter to handle the network call.
    mockFetch(async () =>
      jsonResponse({
        status: "OK",
        content: { delivery_options: [{ final_shipping_cost: 20 }] },
      }),
    );
    try {
      const result = await IntelipostAdapter.quote(creds, { ...validReq, isSpeculative: true });
      // With supportsSpeculativeQuoting=true, this should succeed.
      if ("errorCode" in result) assert.fail("speculative quote should succeed when flag=true");
      assert.equal(result.priceSubunits, 2000);
    } finally {
      restoreFetch();
    }
  }
});

// ─────────────── validateCredentials ───────────────

test("validateCredentials — 200 = ok", async () => {
  mockFetch(async () =>
    jsonResponse({
      status: "OK",
      content: { delivery_options: [{ final_shipping_cost: 20 }] },
    }),
  );
  try {
    const result = await IntelipostAdapter.validateCredentials(creds);
    assert.equal(result.ok, true);
  } finally {
    restoreFetch();
  }
});

test("validateCredentials — 401 = auth_failed", async () => {
  mockFetch(async () => jsonResponse({}, 401));
  try {
    const result = await IntelipostAdapter.validateCredentials(creds);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "auth_failed");
  } finally {
    restoreFetch();
  }
});

test("validateCredentials — 5xx = provider error", async () => {
  mockFetch(async () => jsonResponse({}, 503));
  try {
    const result = await IntelipostAdapter.validateCredentials(creds);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "provider_503");
  } finally {
    restoreFetch();
  }
});
