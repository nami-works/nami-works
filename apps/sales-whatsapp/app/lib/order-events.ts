// Pure decision logic extracted out of the webhook routes so it's testable
// without mocking a live Shopify-authenticated request. The routes
// (webhooks.orders-create.tsx, webhooks.orders-reversal.tsx) are thin: parse
// payload -> call one of these -> write the Prisma update if non-null.

export type OrdersCreatePayload = {
  id?: number;
  admin_graphql_api_id?: string;
  cancelled_at?: string | null;
  financial_status?: string;
  customer?: { id?: number; admin_graphql_api_id?: string } | null;
};

export type ConversionMatch = { customerGid: string; orderGid: string };

export function resolveConversion(order: OrdersCreatePayload): ConversionMatch | null {
  const customerGid =
    order.customer?.admin_graphql_api_id ??
    (order.customer?.id ? `gid://shopify/Customer/${order.customer.id}` : null);
  const orderGid = order.admin_graphql_api_id ?? (order.id ? `gid://shopify/Order/${order.id}` : null);

  if (!customerGid || !orderGid) return null;
  if (order.cancelled_at || order.financial_status === "voided") return null;

  return { customerGid, orderGid };
}

export type OrdersCancelledPayload = { id?: number; admin_graphql_api_id?: string };
export type RefundsCreatePayload = { order_id?: number };

// FLAG (adversarial review, 2026-08-13): this treats ANY refund on the
// matched order as a full reversal, including a trivial partial refund
// (e.g. a shipping-fee adjustment on an otherwise-kept order) — re-opening
// a customer who legitimately bought. Determining "full vs. partial"
// correctly needs the order's total compared against cumulative refunded
// amount, which isn't on the refund payload itself and would need an
// extra Admin API call from inside the webhook. Left as the current
// (blunt but safe-direction) behavior rather than guessing an unverified
// heuristic — the cost of a false-positive re-open is a wasted future
// contact attempt, not a money-loss, unlike guessing wrong the other way.
export function resolveReversalOrderGid(
  topic: string,
  payload: OrdersCancelledPayload | RefundsCreatePayload,
): string | null {
  if (topic === "ORDERS_CANCELLED") {
    const p = payload as OrdersCancelledPayload;
    return p.admin_graphql_api_id ?? (p.id ? `gid://shopify/Order/${p.id}` : null);
  }
  if (topic === "REFUNDS_CREATE") {
    const p = payload as RefundsCreatePayload;
    return p.order_id ? `gid://shopify/Order/${p.order_id}` : null;
  }
  return null;
}
