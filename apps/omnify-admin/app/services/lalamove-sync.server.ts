import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import {
  FAILED_DELIVERY_TAG,
  DELIVERY_REJECTED_TAG,
  DELIVERY_EXPIRED_TAG,
} from "./lalamove-tags";

/**
 * Internal delivery state machine for Lalamove orders.
 *
 * After the auto-delivery refactor, this module handles TAG OPERATIONS ONLY.
 * No Shopify fulfillment mutations (create, event, cancel) are performed.
 * Orders stay "Unfulfilled" in Shopify admin; delivery status lives in the
 * app DB (LalamoveDispatchJob) and order tags.
 *
 * State → tag mapping:
 *   requested         → remove "Failed delivery" tag (if present)
 *   assigning         → no-op
 *   heading_to_pickup → no-op
 *   in_progress       → no-op
 *   delivered         → handled by renameRouteTagsToArchive (called from webhook)
 *   failed            → add "Failed delivery"
 *   rejected          → add "Failed delivery" + "Delivery rejected"
 *   expired           → add "Failed delivery" + "Delivery expired"
 */
type DeliveryState =
  | "requested"
  | "assigning"
  | "heading_to_pickup"
  | "in_progress"
  | "delivered"
  | "failed"
  | "rejected"
  | "expired";

// ── Tag helpers (exported for use by webhook, escalation, cron) ─────────────

export const addTags = async (
  admin: AdminApiContext,
  orderId: string,
  tags: string[],
) => {
  if (tags.length === 0) return;
  await admin.graphql(
    `#graphql
      mutation AddOrderTag($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
    { variables: { id: orderId, tags } },
  );
};

export const removeTags = async (
  admin: AdminApiContext,
  orderId: string,
  tags: string[],
) => {
  if (tags.length === 0) return;
  await admin.graphql(
    `#graphql
      mutation RemoveOrderTag($id: ID!, $tags: [String!]!) {
        tagsRemove(id: $id, tags: $tags) {
          userErrors { message }
        }
      }`,
    { variables: { id: orderId, tags } },
  );
};

// ── Route tag operations ────────────────────────────────────────────────────

export const removeRouteTags = async (
  admin: AdminApiContext,
  orderId: string,
) => {
  const response = await admin.graphql(
    `#graphql
      query OrderTags($id: ID!) {
        order(id: $id) { tags }
      }`,
    { variables: { id: orderId } },
  );
  const json = await response.json();
  const tags: string[] = (json as any)?.data?.order?.tags ?? [];
  const routeTags = tags.filter((t: string) => /^ld_rota-\d+$/i.test(t));
  if (routeTags.length > 0) {
    await removeTags(admin, orderId, routeTags);
  }
};

/**
 * Archive route tags by renaming ld_rota-## → ld_rota-##_YY.MM.DD.
 * Called by the Lalamove webhook on COMPLETED status.
 */
export const renameRouteTagsToArchive = async (
  admin: AdminApiContext,
  orderId: string,
  dateStr: string, // "YY.MM.DD" format, e.g. "26.04.08"
) => {
  const response = await admin.graphql(
    `#graphql
      query OrderTags($id: ID!) {
        order(id: $id) { tags }
      }`,
    { variables: { id: orderId } },
  );
  const json = await response.json();
  const tags: string[] = (json as any)?.data?.order?.tags ?? [];
  const routeTags = tags.filter((t: string) => /^ld_rota-\d+$/i.test(t));
  if (routeTags.length === 0) return;

  // Remove old tags and add archived versions
  await removeTags(admin, orderId, routeTags);
  const archivedTags = routeTags.map((t) => `${t}_${dateStr}`);
  await addTags(admin, orderId, archivedTags);
  console.info(`[lalamove-sync] renameRouteTagsToArchive order=${orderId} ${routeTags.join(",")} → ${archivedTags.join(",")}`);
};

// ── Delivery state machine (tag-only) ───────────────────────────────────────

export const applyLalamoveDeliveryState = async (
  admin: AdminApiContext,
  params: {
    orderIds: string[];
    state: DeliveryState;
    reason?: string;
  },
) => {
  const { orderIds, state } = params;
  console.info(`[lalamove-sync] applyState orders=${orderIds.length} state=${state}`);
  if (orderIds.length === 0) return;

  if (state === "requested") {
    // Remove stale failure tags when a new request is placed
    await Promise.all(
      orderIds.map((id) => removeTags(admin, id, [FAILED_DELIVERY_TAG, DELIVERY_REJECTED_TAG, DELIVERY_EXPIRED_TAG])),
    );
    return;
  }

  // Failure states: add appropriate failure tags
  if (state === "rejected") {
    await Promise.all(
      orderIds.map((id) => addTags(admin, id, [FAILED_DELIVERY_TAG, DELIVERY_REJECTED_TAG])),
    );
  } else if (state === "expired") {
    await Promise.all(
      orderIds.map((id) => addTags(admin, id, [FAILED_DELIVERY_TAG, DELIVERY_EXPIRED_TAG])),
    );
  } else if (state === "failed") {
    await Promise.all(
      orderIds.map((id) => addTags(admin, id, [FAILED_DELIVERY_TAG])),
    );
  }

  // assigning, heading_to_pickup, in_progress, delivered → no-op
  // (delivered tag rename is handled by renameRouteTagsToArchive from webhook)
};

// Re-export for back-compat with existing call sites that import from here.
// New code should import from `lalamove-tags.ts` directly so client bundles
// can use the constants too (this file is server-only).
export { getFailedDeliveryTag } from "./lalamove-tags";
