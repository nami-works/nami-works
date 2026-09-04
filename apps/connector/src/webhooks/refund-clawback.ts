import { getShopifyClient } from "../clients/shopify.js";
import { prisma } from "../db/prisma.js";

// Claws back just-bought credit when the underlying order is refunded after
// credit was already issued. Same idempotency shape as just-bought-credit.ts
// (Shopify webhooks are at-least-once) but the guard is a conditional UPDATE
// on reversedAt rather than an insert-unique-constraint, since the row this
// handler acts on already exists. Manual precedent for this exact correction:
// gebeauty/growth/retention-machine/learning/realtime-webhook-refund-corrections.jsonl
// (order #91638, 2026-08-11) — this automates that one-off fix.
const M_DEBIT = /* GraphQL */ `
  mutation JustBoughtCreditClawback($id: ID!, $debitInput: StoreCreditAccountDebitInput!) {
    storeCreditAccountDebit(id: $id, debitInput: $debitInput) {
      storeCreditAccountTransaction {
        id
        amount { amount currencyCode }
      }
      userErrors { field message code }
    }
  }
`;

type DebitMutationResponse = {
  storeCreditAccountDebit: {
    storeCreditAccountTransaction: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
  };
};

export type ShopifyRefundCreatePayload = {
  order_id?: number;
  admin_graphql_api_id?: string; // the refund's own gid, not the order's
};

export type RefundsCreateContext = {
  tenantId: string;
  ssmPrefix: string;
  shopifyShop: string;
  log: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    error: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

export async function handleRefundsCreateWebhook(
  refund: ShopifyRefundCreatePayload,
  ctx: RefundsCreateContext,
): Promise<void> {
  if (!refund.order_id) {
    ctx.log.info({}, "refunds/create: no order_id on refund, skipping");
    return;
  }
  const orderGid = `gid://shopify/Order/${refund.order_id}`;

  const issuance = await prisma.justBoughtCreditIssuance.findUnique({
    where: { tenantId_shopifyOrderId: { tenantId: ctx.tenantId, shopifyOrderId: orderGid } },
  });
  if (!issuance) return; // no webhook history for this order

  // Refunded during the 72h hold (2026-09-01): no Shopify credit was ever
  // granted, so there's nothing to debit — just cancel the pending row
  // before the sweep gets to it. Conditional update, same idempotency
  // shape as the "issued" clawback below.
  if (issuance.status === "pending_hold") {
    const { count } = await prisma.justBoughtCreditIssuance.updateMany({
      where: { tenantId: ctx.tenantId, shopifyOrderId: orderGid, status: "pending_hold" },
      data: { status: "cancelled_before_issuance" },
    });
    if (count > 0) {
      ctx.log.info({ orderGid }, "refunds/create: cancelled pending hold before issuance");
    }
    return;
  }

  if (issuance.status !== "issued" || issuance.reversedAt) {
    // Never issued for this order (below floor, cancelled hold), or
    // already clawed back by a prior delivery of this same refund event.
    return;
  }

  // Conditional update is the idempotency guard: if a concurrent/duplicate
  // refunds/create delivery already won this race, count is 0 and we no-op
  // instead of debiting twice.
  const { count } = await prisma.justBoughtCreditIssuance.updateMany({
    where: {
      tenantId: ctx.tenantId,
      shopifyOrderId: orderGid,
      status: "issued",
      reversedAt: null,
    },
    data: { reversedAt: new Date() },
  });
  if (count === 0) {
    ctx.log.info({ orderGid }, "refunds/create: already clawed back, no-op");
    return;
  }

  const client = await getShopifyClient({ ssmPrefix: ctx.ssmPrefix, shopifyShop: ctx.shopifyShop });

  const debitRes = await client.request<DebitMutationResponse>(M_DEBIT, {
    variables: {
      id: issuance.customerGid,
      debitInput: {
        debitAmount: { amount: issuance.creditAmount.toFixed(2), currencyCode: "BRL" },
      },
    },
  });

  const debitData = debitRes.data?.storeCreditAccountDebit;
  if (debitRes.errors || (debitData?.userErrors && debitData.userErrors.length > 0)) {
    throw new Error(
      `storeCreditAccountDebit failed for ${orderGid}: ${
        debitRes.errors?.message ?? JSON.stringify(debitData?.userErrors)
      }`,
    );
  }

  ctx.log.info(
    { orderGid, customerGid: issuance.customerGid, credit: issuance.creditAmount },
    "refunds/create: credit clawed back",
  );
}
