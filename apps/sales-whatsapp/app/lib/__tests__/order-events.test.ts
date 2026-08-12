import { describe, expect, it } from "vitest";
import { resolveConversion, resolveReversalOrderGid } from "../order-events.js";

describe("resolveConversion", () => {
  it("matches a normal paid-intent order with a customer", () => {
    const match = resolveConversion({
      id: 123,
      admin_graphql_api_id: "gid://shopify/Order/123",
      customer: { id: 456, admin_graphql_api_id: "gid://shopify/Customer/456" },
    });
    expect(match).toEqual({ customerGid: "gid://shopify/Customer/456", orderGid: "gid://shopify/Order/123" });
  });

  it("falls back to constructing GIDs from numeric IDs if admin_graphql_api_id is missing", () => {
    const match = resolveConversion({ id: 123, customer: { id: 456 } });
    expect(match).toEqual({ customerGid: "gid://shopify/Customer/456", orderGid: "gid://shopify/Order/123" });
  });

  it("returns null for a guest order (no customer) — nothing to convert", () => {
    const match = resolveConversion({ id: 123, admin_graphql_api_id: "gid://shopify/Order/123", customer: null });
    expect(match).toBeNull();
  });

  it("returns null for an order that's already cancelled at creation time", () => {
    const match = resolveConversion({
      id: 123,
      admin_graphql_api_id: "gid://shopify/Order/123",
      cancelled_at: "2026-08-12T00:00:00Z",
      customer: { id: 456, admin_graphql_api_id: "gid://shopify/Customer/456" },
    });
    expect(match).toBeNull();
  });

  it("returns null for a voided order", () => {
    const match = resolveConversion({
      id: 123,
      admin_graphql_api_id: "gid://shopify/Order/123",
      financial_status: "voided",
      customer: { id: 456, admin_graphql_api_id: "gid://shopify/Customer/456" },
    });
    expect(match).toBeNull();
  });
});

describe("resolveReversalOrderGid", () => {
  it("resolves an orders/cancelled payload", () => {
    expect(resolveReversalOrderGid("ORDERS_CANCELLED", { admin_graphql_api_id: "gid://shopify/Order/123" })).toBe(
      "gid://shopify/Order/123",
    );
  });

  it("resolves a refunds/create payload via order_id (no admin_graphql_api_id on a refund's own order ref)", () => {
    expect(resolveReversalOrderGid("REFUNDS_CREATE", { order_id: 789 })).toBe("gid://shopify/Order/789");
  });

  it("returns null for an unrecognized topic — never guesses", () => {
    expect(resolveReversalOrderGid("SOME_OTHER_TOPIC", {})).toBeNull();
  });
});
