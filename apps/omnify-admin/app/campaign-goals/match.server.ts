// Campaign match evaluation pipeline.
//
// Three layers:
//   1. `matchRuleApplies` — pure predicate over OrderSnapshotForMatching.
//   2. `fetchOrderLineItems` — pulls line-item tags + SKUs + properties from Shopify
//      for a given order (GraphQL). Called on demand, only for orders in an active
//      campaign window.
//   3. `evaluateCampaignMatches` — orchestrator. Given an order + shop, fetches
//      line items (if needed), iterates every active campaign that covers the
//      orderDate, applies its matchRule, upserts CampaignOrderMatch rows for
//      matches.

import prisma from "../db.server";
import type {
  CampaignMatchRule,
  OrderSnapshotForMatching,
} from "./types";

// ─── Pure predicate ──────────────────────────────────────────────────────────

export function matchRuleApplies(
  rule: CampaignMatchRule,
  order: OrderSnapshotForMatching,
): boolean {
  switch (rule.type) {
    case "orderTag": {
      const set = new Set(rule.values);
      return order.orderTags.some((t) => set.has(t));
    }
    case "lineItemTag": {
      const set = new Set(rule.values);
      return order.lineItems.some((li) =>
        li.productTags.some((t) => set.has(t)),
      );
    }
    case "lineItemSku": {
      const set = new Set(rule.values);
      return order.lineItems.some((li) => li.sku != null && set.has(li.sku));
    }
    case "lineItemProductId": {
      const set = new Set(rule.values);
      return order.lineItems.some(
        (li) => li.productId != null && set.has(li.productId),
      );
    }
    case "lineItemProperty": {
      return order.lineItems.some((li) =>
        li.properties.some(
          (p) =>
            p.name === rule.key &&
            (rule.value === undefined || p.value === rule.value),
        ),
      );
    }
    case "any":
      return rule.rules.some((r) => matchRuleApplies(r, order));
    case "all":
      return rule.rules.every((r) => matchRuleApplies(r, order));
    default: {
      // Exhaustiveness guard — future variants must be added above.
      const _exhaustive: never = rule;
      void _exhaustive;
      return false;
    }
  }
}

// ─── Shopify line-item fetcher ───────────────────────────────────────────────

const ORDER_LINE_ITEMS_QUERY = `#graphql
  query OrderLineItemsForCampaignMatch($id: ID!) {
    order(id: $id) {
      id
      tags
      lineItems(first: 100) {
        nodes {
          sku
          customAttributes { key value }
          product {
            id
            tags
          }
        }
      }
    }
  }
`;

/**
 * Fetches the line-item shape needed for campaign matching from Shopify.
 * Returns null if the order can't be loaded.
 */
export async function fetchOrderLineItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  orderId: string,
): Promise<OrderSnapshotForMatching | null> {
  try {
    const response = await admin.graphql(ORDER_LINE_ITEMS_QUERY, {
      variables: { id: orderId },
    });
    const json = await response.json();
    const order = json?.data?.order;
    if (!order) return null;

    const tags: string[] = Array.isArray(order.tags) ? order.tags : [];
    const nodes = order.lineItems?.nodes ?? [];
    const lineItems = nodes.map(
      (n: {
        sku: string | null;
        customAttributes: Array<{ key: string; value: string }> | null;
        product: { id: string; tags: string[] } | null;
      }) => ({
        productId: n.product?.id ?? null,
        sku: n.sku ?? null,
        productTags: Array.isArray(n.product?.tags) ? n.product!.tags : [],
        properties: Array.isArray(n.customAttributes)
          ? n.customAttributes.map((p) => ({
              name: p.key,
              value: p.value,
            }))
          : [],
      }),
    );

    return {
      orderId: order.id,
      orderTags: tags,
      lineItems,
    };
  } catch (err) {
    console.warn(
      `[campaign-goals:match] fetchOrderLineItems FAILED orderId=${orderId}`,
      err,
    );
    return null;
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

type EvaluateArgs = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  shop: string;
  orderId: string;
  orderDate: Date;
  locationId: string;
  staffMemberId?: string | null;
};

/**
 * Checks `orderDate` against every active campaign for the shop. If any campaign's
 * window includes the date, fetches line items once and evaluates each matching
 * campaign's rule. Matches become CampaignOrderMatch rows.
 *
 * Idempotent: safe to call multiple times for the same (campaign, order) — the
 * @@unique constraint prevents duplicates.
 */
export async function evaluateCampaignMatches(
  args: EvaluateArgs,
): Promise<{ evaluated: number; matched: number }> {
  const { admin, shop, orderId, orderDate, locationId, staffMemberId } = args;

  const candidates = await prisma.campaignGoal.findMany({
    where: {
      shop,
      status: "active",
      startDate: { lte: orderDate },
      endDate: { gte: orderDate },
    },
    select: { id: true, matchRule: true },
  });

  if (candidates.length === 0) return { evaluated: 0, matched: 0 };

  const snapshot = await fetchOrderLineItems(admin, orderId);
  if (!snapshot) {
    console.warn(
      `[campaign-goals:match] SKIP shop=${shop} orderId=${orderId} reason=no-snapshot`,
    );
    return { evaluated: candidates.length, matched: 0 };
  }

  let matched = 0;
  for (const c of candidates) {
    const rule = c.matchRule as CampaignMatchRule;
    if (!matchRuleApplies(rule, snapshot)) continue;
    matched += 1;
    const id = `${c.id}__${orderId}`;
    await prisma.campaignOrderMatch.upsert({
      where: { campaignGoalId_orderId: { campaignGoalId: c.id, orderId } },
      create: {
        id,
        campaignGoalId: c.id,
        orderId,
        shop,
        locationId,
        orderDate,
        staffMemberId: staffMemberId ?? null,
      },
      update: {
        locationId,
        orderDate,
        staffMemberId: staffMemberId ?? null,
      },
    });
  }

  console.info(
    `[campaign-goals:match] shop=${shop} orderId=${orderId} candidates=${candidates.length} matched=${matched}`,
  );

  return { evaluated: candidates.length, matched };
}
