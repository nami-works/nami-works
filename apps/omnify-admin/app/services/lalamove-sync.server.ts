import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Internal delivery state machine for Lalamove orders.
 *
 * State → Shopify fulfillment event mapping:
 *   requested         → IN_TRANSIT      (order placed with Lalamove, awaiting driver)
 *   assigning         → CONFIRMED       (Lalamove ASSIGNING_DRIVER: looking for driver)
 *   heading_to_pickup → IN_TRANSIT      (Lalamove ON_GOING: driver heading to pickup)
 *   in_progress       → OUT_FOR_DELIVERY (Lalamove PICKED_UP: package with driver)
 *   delivered         → DELIVERED       (Lalamove COMPLETED)
 *   failed            → FAILURE         (Lalamove CANCELED)
 *   rejected          → FAILURE + tag "Delivery rejected"  (Lalamove REJECTED: no driver)
 *   expired           → FAILURE + tag "Delivery expired"   (Lalamove EXPIRED: timed out)
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

const FAILED_DELIVERY_TAG = "Failed delivery";
const LALAMOVE_ACTIVE_TAG = "Lalamove active";
const DELIVERY_REJECTED_TAG = "Delivery rejected";
const DELIVERY_EXPIRED_TAG = "Delivery expired";

const addTags = async (
  admin: AdminApiContext["admin"],
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

const removeTags = async (
  admin: AdminApiContext["admin"],
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

const fetchFulfillmentOrderIds = async (
  admin: AdminApiContext["admin"],
  orderIds: string[],
) => {
  if (orderIds.length === 0) return [] as string[];
  const response = await admin.graphql(
    `#graphql
      query FulfillmentOrderIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            fulfillmentOrders(first: 20) {
              nodes {
                id
                status
              }
            }
          }
        }
      }`,
    { variables: { ids: orderIds } },
  );
  const json = await response.json();
  const nodes = (json?.data?.nodes ?? []) as Array<{
    fulfillmentOrders?: { nodes?: Array<{ id: string; status?: string }> };
  }>;
  return nodes.flatMap((node) =>
    (node.fulfillmentOrders?.nodes ?? [])
      .filter((fo) => (fo.status ?? "").toUpperCase() !== "CLOSED")
      .map((fo) => fo.id),
  );
};

const createFulfillmentForOrders = async (
  admin: AdminApiContext["admin"],
  orderIds: string[],
) => {
  const fulfillmentOrderIds = await fetchFulfillmentOrderIds(admin, orderIds);
  if (fulfillmentOrderIds.length === 0) return null;
  const response = await admin.graphql(
    `#graphql
      mutation CreateFulfillment($fulfillment: FulfillmentV2Input!) {
        fulfillmentCreateV2(fulfillment: $fulfillment) {
          fulfillment {
            id
          }
          userErrors {
            message
          }
        }
      }`,
    {
      variables: {
        fulfillment: {
          lineItemsByFulfillmentOrder: fulfillmentOrderIds.map((id) => ({
            fulfillmentOrderId: id,
          })),
          notifyCustomer: true,
        },
      },
    },
  );
  const json = await response.json();
  return json?.data?.fulfillmentCreateV2?.fulfillment?.id as string | null;
};

const createFulfillmentEvent = async (
  admin: AdminApiContext["admin"],
  fulfillmentId: string,
  status: "CONFIRMED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILURE",
  message?: string,
) => {
  await admin.graphql(
    `#graphql
      mutation FulfillmentEvent($fulfillmentEvent: FulfillmentEventInput!) {
        fulfillmentEventCreate(fulfillmentEvent: $fulfillmentEvent) {
          userErrors { message }
        }
      }`,
    {
      variables: {
        fulfillmentEvent: {
          fulfillmentId,
          status,
          message: message ?? null,
          notifyCustomer: true,
        },
      },
    },
  );
};

const cancelFulfillment = async (
  admin: AdminApiContext["admin"],
  fulfillmentId: string,
) => {
  await admin.graphql(
    `#graphql
      mutation CancelFulfillment($id: ID!) {
        fulfillmentCancel(id: $id) {
          userErrors { message }
        }
      }`,
    { variables: { id: fulfillmentId } },
  );
};

export const applyLalamoveDeliveryState = async (
  admin: AdminApiContext["admin"],
  params: {
    orderIds: string[];
    state: DeliveryState;
    reason?: string;
    existingFulfillmentId?: string | null;
  },
) => {
  const { orderIds, state, reason, existingFulfillmentId } = params;
  if (orderIds.length === 0) return { fulfillmentId: existingFulfillmentId ?? null };

  // ── requested: order placed with Lalamove ──────────────────────────────────
  if (state === "requested") {
    const fulfillmentId = existingFulfillmentId ?? (await createFulfillmentForOrders(admin, orderIds));
    if (fulfillmentId) {
      await createFulfillmentEvent(admin, fulfillmentId, "IN_TRANSIT");
    }
    await Promise.all(
      orderIds.map(async (orderId) => {
        await removeTags(admin, orderId, [FAILED_DELIVERY_TAG]);
        await addTags(admin, orderId, [LALAMOVE_ACTIVE_TAG]);
      }),
    );
    return { fulfillmentId };
  }

  const fulfillmentId = existingFulfillmentId ?? (await createFulfillmentForOrders(admin, orderIds));
  if (!fulfillmentId) return { fulfillmentId: null };

  // ── assigning: Lalamove searching for a driver ─────────────────────────────
  if (state === "assigning") {
    await createFulfillmentEvent(admin, fulfillmentId, "CONFIRMED", "Looking for a driver");
    return { fulfillmentId };
  }

  // ── heading_to_pickup: driver accepted, heading to pickup location ──────────
  if (state === "heading_to_pickup") {
    await createFulfillmentEvent(admin, fulfillmentId, "IN_TRANSIT", "Driver heading to pickup");
    return { fulfillmentId };
  }

  // ── in_progress: driver picked up package, heading to customer ─────────────
  if (state === "in_progress") {
    await createFulfillmentEvent(admin, fulfillmentId, "OUT_FOR_DELIVERY");
    return { fulfillmentId };
  }

  // ── delivered: delivery completed ──────────────────────────────────────────
  if (state === "delivered") {
    await createFulfillmentEvent(admin, fulfillmentId, "DELIVERED");
    await Promise.all(orderIds.map((orderId) => removeTags(admin, orderId, [LALAMOVE_ACTIVE_TAG])));
    return { fulfillmentId };
  }

  // ── rejected: no driver accepted the order — merchant must re-dispatch ──────
  if (state === "rejected") {
    const msg = reason ?? "No driver accepted the order. Please re-request a driver.";
    await createFulfillmentEvent(admin, fulfillmentId, "FAILURE", msg);
    await cancelFulfillment(admin, fulfillmentId);
    await Promise.all(
      orderIds.map(async (orderId) => {
        await removeTags(admin, orderId, [LALAMOVE_ACTIVE_TAG]);
        await addTags(admin, orderId, [FAILED_DELIVERY_TAG, DELIVERY_REJECTED_TAG]);
      }),
    );
    return { fulfillmentId };
  }

  // ── expired: order timed out without assignment — merchant must re-dispatch ─
  if (state === "expired") {
    const msg = reason ?? "Driver request expired. Please re-request a driver.";
    await createFulfillmentEvent(admin, fulfillmentId, "FAILURE", msg);
    await cancelFulfillment(admin, fulfillmentId);
    await Promise.all(
      orderIds.map(async (orderId) => {
        await removeTags(admin, orderId, [LALAMOVE_ACTIVE_TAG]);
        await addTags(admin, orderId, [FAILED_DELIVERY_TAG, DELIVERY_EXPIRED_TAG]);
      }),
    );
    return { fulfillmentId };
  }

  // ── failed: cancelled by merchant or system ────────────────────────────────
  await createFulfillmentEvent(admin, fulfillmentId, "FAILURE", reason ?? "Delivery unsuccessful");
  await cancelFulfillment(admin, fulfillmentId);
  await Promise.all(
    orderIds.map(async (orderId) => {
      await removeTags(admin, orderId, [LALAMOVE_ACTIVE_TAG]);
      await addTags(admin, orderId, [FAILED_DELIVERY_TAG]);
    }),
  );
  return { fulfillmentId };
};

export const getFailedDeliveryTag = () => FAILED_DELIVERY_TAG;
