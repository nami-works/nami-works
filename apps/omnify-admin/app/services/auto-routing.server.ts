/**
 * Auto-routing service for Local Delivery.
 *
 * Called fire-and-forget from the orders/create webhook. For each confirmed
 * LOCAL delivery order, fetches fulfillment location via GraphQL, then
 * re-clusters ALL open pending orders for that location using haversine
 * k-means (zero external API calls). The clustering enforces a minimum of
 * 3 orders per route and respects directional coherence.
 *
 * No Lalamove quotations or Google Maps API calls are made here — routing
 * decisions use pure haversine geometry. Full cost optimization (Lalamove
 * quotes + R$14 surcharge model) happens when the merchant clicks
 * "Optimize fleet" in the UI.
 *
 * Deduplication: if the order is already present in any open pending route
 * for this location, the webhook is ignored (idempotent).
 */

import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { getRuntimeCredentialsForShop } from "./lalamove-credentials.server";
import type { LalamoveConfig } from "./carrier/lalamove-adapter.server";
import type { OptimizerOrderInput } from "./google-routes-shared.server";
import { clusterOrders } from "./carrier-quotation-optimizer.server";

// ─── Types ───────────────────────────────────────────────────────────────────

export type OrderStop = {
  shopifyOrderId: string;
  lat: number;
  lng: number;
  address: string;
  name: string;
  phone: string;
};

type WebhookShippingAddress = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  zip?: string | null;
  country?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  phone?: string | null;
};

type WebhookCustomer = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
};

export type OrderWebhookPayload = {
  id: string | number;
  name?: string | null;
  confirmed?: boolean;
  financial_status?: string | null;
  location_id?: number | string | null;
  shipping_address?: WebhookShippingAddress | null;
  customer?: WebhookCustomer | null;
};

type AdminGraphQL = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type LogDetails = {
  locationId?: string;
  fulfillmentLocationId?: string;
  deliveryMethod?: string;
  routeId?: string;
  openRoutesCount?: number;
  routeGroupsCount?: number;
  error?: string;
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function joinAddress(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(", ");
}

function toNumber(val: number | string | null | undefined): number | null {
  if (val == null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

async function writeLog(
  shop: string,
  orderId: string,
  orderName: string | null,
  status: "assigned" | "skipped" | "error",
  reason: string,
  locationId?: string | null,
  details?: LogDetails,
): Promise<void> {
  try {
    await prisma.autoAssignLog.create({
      data: {
        shop,
        orderId: String(orderId),
        orderName: orderName ?? null,
        locationId: locationId ?? null,
        status,
        reason,
        details: details ? (details as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
  } catch (err) {
    console.warn("[auto-routing] Failed to write log:", err);
  }
}

const ORDER_FULFILLMENT_QUERY = `#graphql
  query OrderFulfillmentForAutoRouting($id: ID!) {
    order(id: $id) {
      id
      name
      fulfillmentOrders(first: 10) {
        nodes {
          assignedLocation {
            location {
              id
            }
          }
          deliveryMethod {
            methodType
          }
        }
      }
    }
  }
`;

const ORDER_FOR_QUOTATION_QUERY = `#graphql
  query OrderForCarrierQuotation($id: ID!) {
    order(id: $id) {
      id
      name
      displayFulfillmentStatus
      shippingAddress {
        address1
        address2
        city
        province
        zip
        country
        latitude
        longitude
        phone
      }
      customer {
        firstName
        lastName
      }
      fulfillmentOrders(first: 10) {
        nodes {
          assignedLocation {
            location {
              id
            }
          }
          deliveryMethod {
            methodType
          }
        }
      }
    }
  }
`;

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Runs carrier quotation for a single order by order ID (GID).
 * Fetches order via GraphQL, builds payload, and runs the same logic as webhook.
 * Used for manual "Carrier quotation" auto-assign from the Local Delivery UI.
 */
export async function runCarrierQuotationForOrderId(
  shop: string,
  orderId: string,
  admin: AdminGraphQL,
): Promise<void> {
  try {
    const res = await admin.graphql(ORDER_FOR_QUOTATION_QUERY, {
      variables: { id: orderId },
    });
    const json = await res.json();
    const orderData = json?.data?.order;
    if (!orderData) {
      console.warn("[auto-routing] Order not found:", { shop, orderId });
      return;
    }
    const legacyId = orderId.replace("gid://shopify/Order/", "");
    const addr = orderData.shippingAddress;
    const payload: OrderWebhookPayload = {
      id: legacyId,
      name: orderData.name ?? null,
      confirmed: true,
      shipping_address: addr
        ? {
            address1: addr.address1 ?? null,
            address2: addr.address2 ?? null,
            city: addr.city ?? null,
            province: addr.province ?? null,
            zip: addr.zip ?? null,
            country: addr.country ?? null,
            latitude: addr.latitude ?? null,
            longitude: addr.longitude ?? null,
            phone: addr.phone ?? null,
          }
        : undefined,
      customer: orderData.customer
        ? {
            first_name: orderData.customer.firstName ?? null,
            last_name: orderData.customer.lastName ?? null,
          }
        : undefined,
    };
    await _autoAssignOrderToRoute(shop, payload, admin);
  } catch (err) {
    console.error("[auto-routing] runCarrierQuotationForOrderId error:", { shop, orderId, err });
    await writeLog(
      shop,
      orderId.replace("gid://shopify/Order/", ""),
      null,
      "error",
      "Carrier quotation failed",
      undefined,
      { error: err instanceof Error ? err.message : String(err) },
    );
  }
}

/**
 * Assigns a newly confirmed LOCAL delivery order to the optimal delivery routes.
 * Uses haversine k-means clustering (no external API calls) to re-cluster all
 * pending orders globally. Designed to be called fire-and-forget. Never throws.
 */
export async function autoAssignOrderToRoute(
  shop: string,
  payload: OrderWebhookPayload,
  admin?: AdminGraphQL,
): Promise<void> {
  try {
    await _autoAssignOrderToRoute(shop, payload, admin);
  } catch (err) {
    console.error("[auto-routing] Unexpected error:", { shop, orderId: payload.id, err });
    await writeLog(
      shop,
      String(payload.id),
      payload.name ?? null,
      "error",
      "Unexpected error",
      undefined,
      { error: err instanceof Error ? err.message : String(err) },
    );
  }
}

async function _autoAssignOrderToRoute(
  shop: string,
  payload: OrderWebhookPayload,
  admin?: AdminGraphQL,
): Promise<void> {
  const orderId = String(payload.id);
  const orderName = payload.name ?? null;

  // 1. Require admin to fetch fulfillment details
  if (!admin) {
    await writeLog(shop, orderId, orderName, "skipped", "No admin session (e.g. CLI webhook test)", undefined);
    return;
  }

  // 2. Skip unconfirmed orders
  if (!payload.confirmed) {
    await writeLog(shop, orderId, orderName, "skipped", "Order not confirmed", undefined);
    return;
  }

  const addr = payload.shipping_address;
  if (!addr) {
    await writeLog(shop, orderId, orderName, "skipped", "No shipping address", undefined);
    return;
  }

  const lat = toNumber(addr.latitude);
  const lng = toNumber(addr.longitude);
  if (lat == null || lng == null) {
    await writeLog(shop, orderId, orderName, "skipped", "Shipping address missing coordinates", undefined);
    return;
  }

  // 3. Fetch order fulfillment details via GraphQL
  const shopifyOrderId = `gid://shopify/Order/${payload.id}`;
  let locationId: string | null = null;

  try {
    const res = await admin.graphql(ORDER_FULFILLMENT_QUERY, {
      variables: { id: shopifyOrderId },
    });
    const json = await res.json();
    const orderData = json?.data?.order;
    if (!orderData?.fulfillmentOrders?.nodes?.length) {
      await writeLog(shop, orderId, orderName, "skipped", "No fulfillment orders", undefined, {
        deliveryMethod: "none",
      });
      return;
    }

    const localFulfillment = orderData.fulfillmentOrders.nodes.find(
      (fo: { deliveryMethod?: { methodType?: string }; assignedLocation?: { location?: { id: string } } }) =>
        fo.deliveryMethod?.methodType === "LOCAL" && fo.assignedLocation?.location?.id,
    );

    if (!localFulfillment) {
      const methodTypes = orderData.fulfillmentOrders.nodes
        .map((fo: { deliveryMethod?: { methodType?: string } }) => fo.deliveryMethod?.methodType)
        .filter(Boolean);
      await writeLog(shop, orderId, orderName, "skipped", "Not a LOCAL delivery order", undefined, {
        deliveryMethod: methodTypes.join(", ") || "unknown",
      });
      return;
    }

    locationId = localFulfillment.assignedLocation!.location!.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeLog(shop, orderId, orderName, "error", "Failed to fetch order fulfillment", undefined, {
      error: msg,
    });
    return;
  }

  if (!locationId) {
    await writeLog(shop, orderId, orderName, "skipped", "No fulfillment location for LOCAL order", undefined);
    return;
  }

  // 4. Get LalamoveLocationConfig for this fulfillment location
  const configRow = await prisma.lalamoveLocationConfig.findUnique({
    where: { shop_locationId: { shop, locationId } },
  });

  if (!configRow) {
    await writeLog(shop, orderId, orderName, "skipped", "No Lalamove config for fulfillment location", locationId, {
      fulfillmentLocationId: locationId,
    });
    return;
  }

  const config = configRow.data as LalamoveConfig;

  if (config.pickupLat == null || config.pickupLng == null) {
    await writeLog(shop, orderId, orderName, "skipped", "Pickup coordinates missing in location config", locationId, {
      fulfillmentLocationId: locationId,
    });
    return;
  }

  if (!config.market || !config.language || !config.preferredServiceType) {
    await writeLog(shop, orderId, orderName, "skipped", "Incomplete Lalamove config", locationId, {
      fulfillmentLocationId: locationId,
    });
    return;
  }

  // (Credentials still needed for future dispatch; verify they exist)
  const credentials = await getRuntimeCredentialsForShop(shop);
  if (!credentials) {
    await writeLog(shop, orderId, orderName, "skipped", "No Lalamove credentials for shop", locationId, {
      fulfillmentLocationId: locationId,
    });
    return;
  }

  // 5. Build new order stop (use raw Shopify address — Lalamove normalizes internally)
  const customerName = [payload.customer?.first_name, payload.customer?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim() || "Customer";

  const normalizedAddress = joinAddress([addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country]);

  const newStop: OrderStop = {
    shopifyOrderId,
    lat,
    lng,
    address: normalizedAddress,
    name: customerName,
    phone: addr.phone || payload.customer?.phone || "",
  };

  // 6. Fetch all open pending routes and deduplicate
  const openRoutes = await prisma.pendingDeliveryRoute.findMany({
    where: { shop, locationId, status: "open" },
    orderBy: { createdAt: "asc" as const },
  });

  const alreadyAssigned = openRoutes.some((r) =>
    (r.ordersData as OrderStop[]).some((s) => s.shopifyOrderId === newStop.shopifyOrderId),
  );
  if (alreadyAssigned) {
    await writeLog(shop, orderId, orderName, "skipped", "Order already assigned to a pending route (duplicate webhook)", locationId);
    console.info("[auto-routing] Duplicate webhook — order already assigned, skipping.", { shop, shopifyOrderId });
    return;
  }

  // 7. Build full order pool: existing stops + new stop
  const existingStops: OrderStop[] = openRoutes.flatMap((r) => r.ordersData as OrderStop[]);
  const allStops = [...existingStops, newStop];

  // 8. Re-cluster all pending orders using haversine k-means (no external API calls)
  const carrierConfigRow = await prisma.carrierServiceConfig.findUnique({
    where: { shop },
  });
  const maxPerRoute = Math.min(
    15, // Lalamove hard cap
    (carrierConfigRow?.data as { lalamoveMaxOrdersPerRoute?: number } | undefined)?.lalamoveMaxOrdersPerRoute ?? 10,
  );

  if (allStops.length > 1) {
    const inputs: OptimizerOrderInput[] = allStops.map((s) => ({
      orderId: s.shopifyOrderId,
      locationId,
      shippingCoordinates: { latitude: s.lat, longitude: s.lng },
      locationCoordinates: { latitude: config.pickupLat!, longitude: config.pickupLng! },
    }));

    const routeCount = Math.max(1, Math.ceil(inputs.length / maxPerRoute));
    const clusters = clusterOrders(inputs, routeCount, maxPerRoute);

    const routeGroups: OrderStop[][] = clusters
      .filter((c) => c.length > 0)
      .map((cluster) =>
        cluster.map((o) => allStops.find((s) => s.shopifyOrderId === o.orderId)!),
      );

    if (routeGroups.length > 0) {
      await prisma.$transaction([
        prisma.pendingDeliveryRoute.deleteMany({
          where: { shop, locationId, status: "open" },
        }),
        ...routeGroups.map((group) =>
          prisma.pendingDeliveryRoute.create({
            data: { shop, locationId, status: "open", ordersData: group as unknown as Prisma.InputJsonValue },
          }),
        ),
      ]);

      await writeLog(shop, orderId, orderName, "assigned", "Haversine-clustered routes (no Google API)", locationId, {
        openRoutesCount: openRoutes.length,
        routeGroupsCount: routeGroups.length,
      });
      console.info("[auto-routing] Haversine-clustered routes.", {
        shop,
        shopifyOrderId,
        totalOrders: allStops.length,
        routeCount: routeGroups.length,
      });
      return;
    }
  }

  // 9. Fallback: create a solo route for the new order (single order or clustering failed)
  await prisma.pendingDeliveryRoute.create({
    data: { shop, locationId, status: "open", ordersData: [newStop] as unknown as Prisma.InputJsonValue },
  });
  await writeLog(shop, orderId, orderName, "assigned", "Solo route (single order)", locationId, {
    openRoutesCount: openRoutes.length,
  });
  console.info("[auto-routing] Assigned to solo route.", { shop, shopifyOrderId });
}
