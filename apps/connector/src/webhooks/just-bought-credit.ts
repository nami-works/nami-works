import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client-connector";
import { getShopifyClient } from "../clients/shopify.js";
import { prisma } from "../db/prisma.js";

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

function armFor(customerGid: string): (typeof ARMS)[number] {
  const digest = createHash("md5").update(customerGid + ARM_SALT).digest("hex");
  const h = BigInt(`0x${digest}`);
  return ARMS[Number(h % 3n)] as (typeof ARMS)[number];
}

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

export type OrdersPaidContext = {
  tenantId: string;
  ssmPrefix: string;
  shopifyShop: string;
  log: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    error: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

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
  const arm = armFor(customerGid);
  const issue = credit >= FLOOR;
  const expiresAt = new Date(Date.now() + arm * 24 * 60 * 60 * 1000);

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
        status: issue ? "issued" : "skipped_floor",
        expiresAt: issue ? expiresAt : null,
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

  const client = await getShopifyClient({ ssmPrefix: ctx.ssmPrefix, shopifyShop: ctx.shopifyShop });

  const creditRes = await client.request<CreditMutationResponse>(M_CREDIT, {
    variables: {
      id: customerGid,
      creditInput: {
        creditAmount: { amount: credit.toFixed(2), currencyCode: "BRL" },
        expiresAt: expiresAt.toISOString(),
        notify: true,
      },
    },
  });

  const creditData = creditRes.data?.storeCreditAccountCredit;
  if (creditRes.errors || (creditData?.userErrors && creditData.userErrors.length > 0)) {
    throw new Error(
      `storeCreditAccountCredit failed for ${orderGid}: ${
        creditRes.errors?.message ?? JSON.stringify(creditData?.userErrors)
      }`,
    );
  }

  await client.request(M_TAG_ADD, {
    variables: { id: customerGid, tags: [ARM_TAG[arm], GOODWILL_TAG] },
  });

  ctx.log.info({ orderGid, customerGid, credit, arm }, "orders/paid: credit issued");
}
