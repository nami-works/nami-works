import { createHash } from "node:crypto";
import { Prisma, type JustBoughtCreditIssuance } from "@prisma/client-connector";
import { getShopifyClient } from "../clients/shopify.js";
import type { AdminApiClient } from "@shopify/admin-api-client";
import { prisma } from "../db/prisma.js";
import { resolveForcedArmReason, FORCED_ARM_DAYS } from "./credit-arm-radius.js";

// Business logic ported verbatim from
// gebeauty/growth/retention-machine/issue_just_bought.py (committed 7d48318)
// per .claude/initiatives/realtime-credit-webhook.md — this is a re-hosting
// onto a real-time trigger + DB-backed idempotency, not a redesign.
const PCT = 0.2;
const CEIL = 120.0;
const FLOOR = 10.0;
const ARMS = [30, 45, 60] as const;
const ARM_TAG: Record<number, string> = {
  30: "just-bought-credit-30d",
  45: "just-bought-credit-45d",
  60: "just-bought-credit-60d",
};
// ctx stopgap (Lucas, 2026-08-08): goodwill copy is the closest existing fit
// for "you just bought, here's cashback"; tracked in gebeauty/pending-fixes.md.
const GOODWILL_TAG = "credit-goodwill";
const ARM_SALT = "|realtime-expiry-arm-2026-08"; // own salt, uncorrelated with other arm hashes

// 72h hold between order-confirmed (orders/paid) and actual credit issuance
// (Lucas, 2026-09-01). orders/paid below only computes the arm and writes a
// pending_hold row with holdUntil = now + this; process-pending-credit.ts's
// sweep is what actually calls Shopify once the hold has elapsed.
export const CREDIT_HOLD_HOURS = 72;

function armFor(customerGid: string): (typeof ARMS)[number] {
  const digest = createHash("md5").update(customerGid + ARM_SALT).digest("hex");
  const h = BigInt(`0x${digest}`);
  return ARMS[Number(h % 3n)] as (typeof ARMS)[number];
}

const Q_SHIPPING_ADDRESS = /* GraphQL */ `
  query OrderShippingAddressForArm($id: ID!) {
    order(id: $id) {
      shippingAddress {
        latitude
        longitude
      }
    }
  }
`;

const M_CREDIT = /* GraphQL */ `
  mutation JustBoughtCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
    storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
      storeCreditAccountTransaction {
        id
        amount { amount currencyCode }
      }
      userErrors { field message code }
    }
  }
`;

const M_TAG_ADD = /* GraphQL */ `
  mutation JustBoughtTagAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

type CreditMutationResponse = {
  storeCreditAccountCredit: {
    storeCreditAccountTransaction: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
  };
};

export type ShopifyOrderPaidPayload = {
  id: number;
  admin_graphql_api_id?: string;
  cancelled_at?: string | null;
  financial_status?: string;
  current_total_price?: string;
  total_price?: string;
  customer?: { id?: number; admin_graphql_api_id?: string } | null;
};

export type WebhookLog = {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
};

export type OrdersPaidContext = {
  tenantId: string;
  ssmPrefix: string;
  shopifyShop: string;
  log: WebhookLog;
};

// orders/paid: decide the arm and record the hold. Never calls Shopify to
// grant credit — that's process-pending-credit.ts's job, 72h later.
export async function handleOrdersPaidWebhook(
  order: ShopifyOrderPaidPayload,
  ctx: OrdersPaidContext,
): Promise<void> {
  const orderGid = order.admin_graphql_api_id ?? `gid://shopify/Order/${order.id}`;
  const customerGid =
    order.customer?.admin_graphql_api_id ??
    (order.customer?.id ? `gid://shopify/Customer/${order.customer.id}` : null);

  if (!customerGid) {
    ctx.log.info({ orderGid }, "orders/paid: no customer on order, skipping");
    return;
  }
  if (
    order.cancelled_at ||
    order.financial_status === "refunded" ||
    order.financial_status === "voided"
  ) {
    ctx.log.info({ orderGid }, "orders/paid: order cancelled/refunded, skipping");
    return;
  }

  const amount = Number(order.current_total_price ?? order.total_price ?? "0");
  const credit = Math.round(Math.min(CEIL, PCT * amount) * 100) / 100;
  const issue = credit >= FLOOR;

  let armForcedReason: string | null = null;
  if (issue) {
    // Only needed when credit will actually be issued eventually — the
    // shipping-address lookup is a real API call, skip it for floor-skips.
    const client = await getShopifyClient({ ssmPrefix: ctx.ssmPrefix, shopifyShop: ctx.shopifyShop });
    try {
      const addrRes = await client.request<{
        order: { shippingAddress: { latitude: number | null; longitude: number | null } | null } | null;
      }>(Q_SHIPPING_ADDRESS, { variables: { id: orderGid } });
      armForcedReason = resolveForcedArmReason(addrRes.data?.order?.shippingAddress ?? null);
    } catch (err) {
      // Non-fatal: worst case this order stays in the random 3-arm draw
      // instead of getting the radius override.
      ctx.log.error(
        { orderGid, err },
        "orders/paid: shipping-address lookup for arm override failed, falling back to random arm",
      );
    }
  }

  const arm = armForcedReason ? FORCED_ARM_DAYS : armFor(customerGid);
  const now = new Date();
  const holdUntil = issue ? new Date(now.getTime() + CREDIT_HOLD_HOURS * 60 * 60 * 1000) : null;

  try {
    await prisma.justBoughtCreditIssuance.create({
      data: {
        tenantId: ctx.tenantId,
        shopifyOrderId: orderGid,
        customerGid,
        orderTotal: amount,
        creditAmount: issue ? credit : 0,
        armDays: arm,
        armTag: ARM_TAG[arm] as string,
        armForcedReason,
        status: issue ? "pending_hold" : "skipped_floor",
        createdAt: now,
        holdUntil,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      ctx.log.info({ orderGid }, "orders/paid: duplicate delivery, already handled, no-op");
      return;
    }
    throw err;
  }

  if (!issue) {
    ctx.log.info({ orderGid, amount, credit }, "orders/paid: below floor, skipped");
    return;
  }

  ctx.log.info(
    { orderGid, customerGid, credit, arm, armForcedReason, holdUntil },
    "orders/paid: credit held, will issue after 72h",
  );
}

// The actual Shopify grant — called only by process-pending-credit.ts's
// sweep once holdUntil has elapsed, never from orders/paid directly anymore.
export async function issuePendingCredit(
  issuance: JustBoughtCreditIssuance,
  client: AdminApiClient,
  log: WebhookLog,
): Promise<void> {
  const expiresAt = new Date(Date.now() + issuance.armDays * 24 * 60 * 60 * 1000);

  const creditRes = await client.request<CreditMutationResponse>(M_CREDIT, {
    variables: {
      id: issuance.customerGid,
      creditInput: {
        creditAmount: { amount: issuance.creditAmount.toFixed(2), currencyCode: "BRL" },
        expiresAt: expiresAt.toISOString(),
        notify: true,
      },
    },
  });

  const creditData = creditRes.data?.storeCreditAccountCredit;
  if (creditRes.errors || (creditData?.userErrors && creditData.userErrors.length > 0)) {
    throw new Error(
      `storeCreditAccountCredit failed for ${issuance.shopifyOrderId}: ${
        creditRes.errors?.message ?? JSON.stringify(creditData?.userErrors)
      }`,
    );
  }

  await client.request(M_TAG_ADD, {
    variables: { id: issuance.customerGid, tags: [issuance.armTag, GOODWILL_TAG] },
  });

  await prisma.justBoughtCreditIssuance.update({
    where: { id: issuance.id },
    data: { status: "issued", issuedAt: new Date(), expiresAt },
  });

  log.info(
    { orderGid: issuance.shopifyOrderId, customerGid: issuance.customerGid, credit: issuance.creditAmount, arm: issuance.armDays },
    "process-pending-credit: credit issued after hold",
  );
}
