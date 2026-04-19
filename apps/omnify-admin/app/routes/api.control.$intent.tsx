/**
 * Claude Control API — external control surface for the Local Delivery pipeline.
 *
 * Bearer-auth-gated endpoints that let Claude Code (or any authorized client)
 * drive the same operations the UI offers: inspect state, auto-assign orders,
 * dispatch via Lalamove, correct mistakes.
 *
 * Auth: Authorization: Bearer <CLAUDE_CONTROL_TOKEN>. Shop is fixed by env.
 *
 * Intents (MVP):
 *   GET  /api/control/state?locationId=<gid-or-legacy>
 *   POST /api/control/optimize   body: {locationId}
 *   POST /api/control/unassign   body: {routeTag, orderIds[], locationId}
 *   POST /api/control/dispatch   body: {routeIndex, locationId}
 *   POST /api/control/quote      body: {locationId, routes:[{orderIds:string[]}]}
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { unauthenticated } from "../shopify.server";
import {
  authorizeControlRequest,
  controlErrorResponse,
  jsonResponse,
} from "../services/claude-control-auth.server";
import prisma from "../db.server";
import type { LalamoveConfig } from "../services/carrier/lalamove-adapter.server";
import { getRuntimeCredentialsForShop } from "../services/lalamove-credentials.server";
import {
  createLalamoveQuotation,
  placeLalamoveOrder,
  buildLalamoveRecipientRemarks,
  normalizePhoneForMarket,
  cancelLalamoveOrder,
  getLalamoveOrderDetails,
} from "../services/lalamove.server";
import { resolveConfiguredSpecialRequests } from "../services/lalamove-special-requests.server";
import { clusterOrders } from "../services/carrier-quotation-optimizer.server";
import { addTags, renameRouteTagsToArchive } from "../services/lalamove-sync.server";
import type { OptimizerOrderInput } from "../services/google-routes-shared.server";

const MAX_ROUTE_SLOTS = 20;
const TERMINAL_DISPATCH_STATUSES = new Set(["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"]);
const ADDRESS_REVIEW_TAG = "ld_address_review";

const routeTagForSlot = (slot: number) => `ld_rota-${String(slot + 1).padStart(2, "0")}`;

const normalizeLocationId = (raw: string): { gid: string; legacy: string } => {
  if (raw.startsWith("gid://shopify/Location/")) {
    return { gid: raw, legacy: raw.replace("gid://shopify/Location/", "") };
  }
  return { gid: `gid://shopify/Location/${raw}`, legacy: raw };
};

// ──────────────────────────────────────────────────────────────────────
// Loader: GET intents
// ──────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const auth = authorizeControlRequest(request);
  if (!auth.ok) return controlErrorResponse(auth);

  const intent = params.intent;
  if (intent !== "state") {
    return jsonResponse({ ok: false, error: `Unknown GET intent: ${intent}` }, 404);
  }

  const url = new URL(request.url);
  const locationIdRaw = url.searchParams.get("locationId");
  if (!locationIdRaw) {
    return jsonResponse({ ok: false, error: "locationId query param required" }, 400);
  }
  const live = url.searchParams.get("live") === "true" || url.searchParams.get("live") === "1";
  const { gid: locationGid, legacy: locationLegacy } = normalizeLocationId(locationIdRaw);

  const start = Date.now();
  console.info(`[control] state START shop=${auth.shop} location=${locationLegacy} live=${live}`);

  try {
    const { admin } = await unauthenticated.admin(auth.shop);

    const locationResp = await admin.graphql(
      `#graphql
        query ControlStateLocation($id: ID!) {
          location(id: $id) { id name address { city province country } }
        }`,
      { variables: { id: locationGid } },
    );
    const locationJson = await locationResp.json();
    const location = locationJson.data?.location ?? null;

    const routes: Array<{
      slot: number;
      tag: string;
      orders: Array<Record<string, unknown>>;
      dispatch: Record<string, unknown> | null;
    }> = [];

    const ordersBySlot = new Map<number, unknown[]>();
    for (let slot = 0; slot < MAX_ROUTE_SLOTS; slot += 1) {
      const tag = routeTagForSlot(slot);
      const resp = await admin.graphql(
        `#graphql
          query ControlStateByTag($query: String!, $first: Int!) {
            orders(first: $first, query: $query, sortKey: ID) {
              nodes {
                id name createdAt tags note
                customer { displayName }
                shippingAddress { address1 address2 city province zip latitude longitude }
                currentTotalPriceSet { shopMoney { amount currencyCode } }
                currentShippingPriceSet { shopMoney { amount currencyCode } }
                fulfillmentOrders(first: 5) {
                  nodes { assignedLocation { location { id name } } }
                }
              }
            }
          }`,
        { variables: { query: `tag:${tag} fulfillment_status:unshipped`, first: 100 } },
      );
      const json = await resp.json();
      const nodes = (json.data?.orders?.nodes ?? []) as Array<any>;
      const scoped = nodes.filter((o) => {
        const loc = o?.fulfillmentOrders?.nodes?.[0]?.assignedLocation?.location?.id ?? null;
        if (!loc) return true; // keep if location unknown (scope-limited)
        return loc === locationGid;
      });
      if (scoped.length > 0) ordersBySlot.set(slot, scoped);
    }

    // Active Lalamove dispatches for this location
    const activeDispatchesRaw = await (prisma as any).lalamoveDispatchJob.findMany({
      where: {
        shop: auth.shop,
        routeId: { startsWith: `${locationGid}-` },
        status: { notIn: Array.from(TERMINAL_DISPATCH_STATUSES) },
      },
      select: { routeId: true, status: true, lalamoveOrderId: true, market: true, requestedAt: true },
    });
    const dispatchBySlot = new Map<number, any>();
    for (const d of activeDispatchesRaw as Array<any>) {
      const suffix = String(d.routeId).slice(locationGid.length + 1);
      const idx = Number.parseInt(suffix, 10);
      if (Number.isFinite(idx) && idx >= 0) dispatchBySlot.set(idx, d);
    }

    // Live refresh: for each active dispatch, fetch fresh status from Lalamove.
    // Only runs when ?live=true. Per-call latency ~1-2s; parallelized.
    const refreshedSlots: number[] = [];
    if (live && dispatchBySlot.size > 0) {
      const credentials = await getRuntimeCredentialsForShop(auth.shop);
      if (!credentials) {
        console.warn(`[control] state live=true SKIP — no Lalamove credentials for shop=${auth.shop}`);
      } else {
        const liveStart = Date.now();
        await Promise.all(
          Array.from(dispatchBySlot.entries()).map(async ([slot, d]) => {
            try {
              const fresh = await getLalamoveOrderDetails(d.market, d.lalamoveOrderId, credentials);
              const freshStatus = fresh.status ?? d.status;
              if (freshStatus && freshStatus !== d.status) {
                // Persist change so DB catches up
                try {
                  await (prisma as any).lalamoveDispatchJob.updateMany({
                    where: { shop: auth.shop, lalamoveOrderId: d.lalamoveOrderId },
                    data: { status: freshStatus },
                  });
                } catch (writeErr) {
                  console.warn(`[control] state live: DB update failed order=${d.lalamoveOrderId}`, writeErr);
                }
              }
              // Replace the map entry with fresh data (preserve identity fields)
              dispatchBySlot.set(slot, {
                ...d,
                status: freshStatus,
                shareLink: fresh.shareLink ?? null,
                driverId: fresh.driverId ?? null,
                priceBreakdown: fresh.priceBreakdown ?? null,
                stops: fresh.stops ?? null,
              });
              refreshedSlots.push(slot);
            } catch (err) {
              console.warn(
                `[control] state live: fresh fetch failed slot=${slot} order=${d.lalamoveOrderId}`,
                err instanceof Error ? err.message : String(err),
              );
            }
          }),
        );
        console.info(
          `[control] state live refresh shop=${auth.shop} refreshed=${refreshedSlots.length}/${dispatchBySlot.size} elapsed=${Date.now() - liveStart}ms`,
        );
      }
    }

    for (let slot = 0; slot < MAX_ROUTE_SLOTS; slot += 1) {
      const orders = ordersBySlot.get(slot);
      if (!orders || orders.length === 0) continue;
      routes.push({
        slot,
        tag: routeTagForSlot(slot),
        orders: orders.map((o: any) => ({
          id: o.id,
          name: o.name,
          createdAt: o.createdAt,
          customer: o.customer?.displayName ?? null,
          address: {
            line1: o.shippingAddress?.address1 ?? null,
            line2: o.shippingAddress?.address2 ?? null,
            city: o.shippingAddress?.city ?? null,
            province: o.shippingAddress?.province ?? null,
            zip: o.shippingAddress?.zip ?? null,
            lat: o.shippingAddress?.latitude ?? null,
            lng: o.shippingAddress?.longitude ?? null,
          },
          total: o.currentTotalPriceSet?.shopMoney ?? null,
          shipping: o.currentShippingPriceSet?.shopMoney ?? null,
          tags: o.tags ?? [],
          note: o.note ?? null,
        })),
        dispatch: dispatchBySlot.get(slot)
          ? {
              lalamoveOrderId: dispatchBySlot.get(slot).lalamoveOrderId,
              status: dispatchBySlot.get(slot).status,
              market: dispatchBySlot.get(slot).market,
              requestedAt: dispatchBySlot.get(slot).requestedAt,
              shareLink: dispatchBySlot.get(slot).shareLink ?? null,
              driverId: dispatchBySlot.get(slot).driverId ?? null,
              priceBreakdown: dispatchBySlot.get(slot).priceBreakdown ?? null,
              stops: dispatchBySlot.get(slot).stops ?? null,
              refreshed: refreshedSlots.includes(slot),
            }
          : null,
      });
    }

    // Address-review orders at this location
    const reviewResp = await admin.graphql(
      `#graphql
        query ControlStateAddressReview($query: String!, $first: Int!) {
          orders(first: $first, query: $query, sortKey: ID) {
            nodes {
              id name tags
              customer { displayName }
              shippingAddress { address1 address2 city province zip }
              fulfillmentOrders(first: 5) {
                nodes { assignedLocation { location { id } } }
              }
            }
          }
        }`,
      { variables: { query: `tag:${ADDRESS_REVIEW_TAG} fulfillment_status:unshipped`, first: 100 } },
    );
    const reviewJson = await reviewResp.json();
    const reviewNodes = (reviewJson.data?.orders?.nodes ?? []) as Array<any>;
    const addressReview = reviewNodes
      .filter((o) => {
        const loc = o?.fulfillmentOrders?.nodes?.[0]?.assignedLocation?.location?.id ?? null;
        return !loc || loc === locationGid;
      })
      .map((o) => ({
        id: o.id,
        name: o.name,
        customer: o.customer?.displayName ?? null,
        address: o.shippingAddress ?? null,
      }));

    const result = {
      ok: true,
      shop: auth.shop,
      location: location
        ? { id: location.id, name: location.name, address: location.address }
        : { id: locationGid, name: null, address: null },
      routes,
      addressReview,
      live,
      refreshedDispatches: refreshedSlots.length,
      generatedAt: new Date().toISOString(),
    };

    console.info(
      `[control] state OK shop=${auth.shop} location=${locationLegacy} routes=${routes.length} review=${addressReview.length} elapsed=${Date.now() - start}ms`,
    );

    return jsonResponse(result);
  } catch (err) {
    console.error(`[control] state FAILED shop=${auth.shop} location=${locationLegacy}`, err);
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : "state failed" }, 500);
  }
};

// ──────────────────────────────────────────────────────────────────────
// Action: POST intents
// ──────────────────────────────────────────────────────────────────────

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const auth = authorizeControlRequest(request);
  if (!auth.ok) return controlErrorResponse(auth);

  const intent = params.intent;
  const contentType = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown> = {};
  if (contentType.includes("application/json")) {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
    }
  }

  switch (intent) {
    case "unassign":
      return handleUnassign(auth.shop, body);
    case "dispatch":
      return handleDispatch(auth.shop, body);
    case "optimize":
      return handleOptimize(auth.shop, body);
    case "reorder":
      return handleReorder(auth.shop, body);
    case "mark-delivered":
      return handleMarkDelivered(auth.shop, body);
    case "mark-all-today":
      return handleMarkAllToday(auth.shop, body);
    case "quote":
      return handleQuote(auth.shop, body);
    default:
      return jsonResponse(
        { ok: false, error: `Unknown or not-yet-implemented POST intent: ${intent}` },
        404,
      );
  }
};

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/unassign — remove ld_rota-NN tag from a list of orders
// ──────────────────────────────────────────────────────────────────────

async function handleUnassign(shop: string, body: Record<string, unknown>): Promise<Response> {
  const routeTag = typeof body.routeTag === "string" ? body.routeTag : null;
  const orderIds = Array.isArray(body.orderIds)
    ? (body.orderIds as unknown[]).filter((x): x is string => typeof x === "string")
    : null;
  if (!routeTag || !orderIds || orderIds.length === 0) {
    return jsonResponse({ ok: false, error: "routeTag and orderIds[] required" }, 400);
  }
  if (!/^ld_rota-\d{2}$/.test(routeTag)) {
    return jsonResponse({ ok: false, error: "routeTag must match ld_rota-NN" }, 400);
  }

  console.info(`[control] unassign START shop=${shop} tag=${routeTag} orders=${orderIds.length}`);
  try {
    const { admin } = await unauthenticated.admin(shop);
    await Promise.all(
      orderIds.map((id) =>
        admin.graphql(
          `#graphql
            mutation ControlUnassign($id: ID!, $tags: [String!]!) {
              tagsRemove(id: $id, tags: $tags) {
                userErrors { field message }
              }
            }`,
          { variables: { id, tags: [routeTag] } },
        ),
      ),
    );
    console.info(`[control] unassign OK shop=${shop} tag=${routeTag} orders=${orderIds.length}`);
    return jsonResponse({ ok: true, unassigned: orderIds.length });
  } catch (err) {
    console.error(`[control] unassign FAILED shop=${shop} tag=${routeTag}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "unassign failed" },
      500,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/dispatch — place a Lalamove order for one route
// Body: { locationId: string, routeIndex: number (0-based) }
// Derives orders from Shopify tags at the given location, quotes + places
// a Lalamove order, and records LalamoveDispatchJob + OrderMap rows.
// Idempotent per (shop, locationId, routeId, day).
// ──────────────────────────────────────────────────────────────────────

type DispatchOrderData = {
  shopifyOrderId: string;
  lat: number;
  lng: number;
  address: string;
  name: string;
  phone: string;
};

async function handleDispatch(shop: string, body: Record<string, unknown>): Promise<Response> {
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : null;
  const routeIndexRaw = body.routeIndex;
  if (!locationIdRaw) {
    return jsonResponse({ ok: false, error: "locationId required" }, 400);
  }
  const routeIndex =
    typeof routeIndexRaw === "number"
      ? routeIndexRaw
      : typeof routeIndexRaw === "string"
        ? Number.parseInt(routeIndexRaw, 10)
        : NaN;
  if (!Number.isFinite(routeIndex) || routeIndex < 0 || routeIndex >= MAX_ROUTE_SLOTS) {
    return jsonResponse({ ok: false, error: `routeIndex must be 0..${MAX_ROUTE_SLOTS - 1}` }, 400);
  }
  const { gid: locationGid } = normalizeLocationId(locationIdRaw);
  const routeTag = routeTagForSlot(routeIndex);
  const routeId = `${locationGid}-${routeIndex}`;
  const prismaAny = prisma as any;

  console.info(`[control] dispatch START shop=${shop} route=${routeId} tag=${routeTag}`);

  try {
    // 1. Idempotency check — skip if an active dispatch already exists for this route today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const existing = await prismaAny.lalamoveDispatchJob.findFirst({
      where: {
        shop,
        locationId: locationGid,
        routeId,
        requestedAt: { gte: startOfToday },
        status: {
          notIn: [
            "cancelled", "CANCELLED", "CANCELED",
            "failed", "FAILED",
            "REJECTED", "rejected",
            "EXPIRED", "expired",
            "COMPLETED", "completed",
            "delivered", "DELIVERED", "FULFILLED",
          ],
        },
      },
    });
    if (existing) {
      return jsonResponse({
        ok: false,
        error: "Route already has an active dispatch today.",
        existingJobId: existing.id,
        existingLalamoveOrderId: existing.lalamoveOrderId,
      }, 409);
    }

    // 2. Load config + credentials
    const configRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId: locationGid } },
    });
    if (!configRow) {
      return jsonResponse({ ok: false, error: "Missing Lalamove settings for this location." }, 400);
    }
    const config = configRow.data as LalamoveConfig;
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return jsonResponse({ ok: false, error: "Missing Lalamove credentials for shop." }, 400);
    }
    const pickupLat = (config as any).pickupLat;
    const pickupLng = (config as any).pickupLng;
    if (pickupLat == null || pickupLng == null) {
      return jsonResponse({ ok: false, error: "Location config missing pickup coordinates." }, 400);
    }
    const carrierConfigRow = await prismaAny.carrierServiceConfig.findUnique({ where: { shop } });
    const carrierConfig = carrierConfigRow?.data as { lalamovePreferredServiceType?: string } | undefined;
    const serviceType =
      config.preferredServiceType?.trim() ||
      carrierConfig?.lalamovePreferredServiceType?.trim() ||
      "LALAGO";

    // 3. Pull orders for this route tag at this location
    const { admin } = await unauthenticated.admin(shop);
    const ordersResp = await admin.graphql(
      `#graphql
        query ControlDispatchOrders($query: String!, $first: Int!) {
          orders(first: $first, query: $query, sortKey: ID) {
            nodes {
              id name
              customer { displayName phone defaultPhoneNumber { phoneNumber } }
              shippingAddress { address1 address2 city province zip latitude longitude phone }
              fulfillmentOrders(first: 5) {
                nodes { assignedLocation { location { id } } }
              }
            }
          }
        }`,
      { variables: { query: `tag:${routeTag} fulfillment_status:unshipped`, first: 100 } },
    );
    const ordersJson = await ordersResp.json();
    const rawNodes = (ordersJson.data?.orders?.nodes ?? []) as Array<any>;
    const scoped = rawNodes.filter((o) => {
      const loc = o?.fulfillmentOrders?.nodes?.[0]?.assignedLocation?.location?.id ?? null;
      return !loc || loc === locationGid;
    });
    if (scoped.length === 0) {
      return jsonResponse({ ok: false, error: `No unshipped orders with tag ${routeTag} at this location.` }, 404);
    }

    const ordersData: DispatchOrderData[] = [];
    const unresolvedAddresses: string[] = [];
    for (const o of scoped) {
      const addr = o.shippingAddress;
      if (!addr || addr.latitude == null || addr.longitude == null) {
        unresolvedAddresses.push(o.name);
        continue;
      }
      const line = [addr.address1, addr.address2, addr.city, addr.province, addr.zip]
        .filter(Boolean)
        .join(", ");
      const phoneCandidates = [
        addr.phone,
        o.customer?.defaultPhoneNumber?.phoneNumber,
        o.customer?.phone,
      ];
      let normalizedPhone = "";
      for (const p of phoneCandidates) {
        const n = normalizePhoneForMarket(p, config.market);
        if (n) { normalizedPhone = n; break; }
      }
      ordersData.push({
        shopifyOrderId: o.id,
        lat: Number(addr.latitude),
        lng: Number(addr.longitude),
        address: line,
        name: o.customer?.displayName || "Customer",
        phone: normalizedPhone || config.locationPhone || "",
      });
    }
    if (ordersData.length === 0) {
      return jsonResponse({
        ok: false,
        error: "No orders with valid coordinates to dispatch.",
        unresolvedAddresses,
      }, 400);
    }

    // 4. Build quotation
    const specialRequests = await resolveConfiguredSpecialRequests(
      shop,
      { market: config.market, city: (config as any).city ?? null, preferredServiceType: serviceType },
      credentials,
    );
    const stops = [
      { coordinates: { lat: String(pickupLat), lng: String(pickupLng) }, address: (config.locationAddress ?? "").trim() },
      ...ordersData.map((o) => ({ coordinates: { lat: String(o.lat), lng: String(o.lng) }, address: o.address })),
    ];

    const quotation = await createLalamoveQuotation(
      {
        market: config.market,
        language: (config as any).language,
        serviceType,
        stops,
        isRouteOptimized: stops.length >= 3,
        ...(specialRequests.length > 0 ? { specialRequests } : {}),
      },
      credentials,
    );

    const stopIds = (quotation.stops ?? []).map((s) => s.stopId).filter(Boolean) as string[];
    if (stopIds.length < 2) {
      return jsonResponse({ ok: false, error: "Lalamove quote returned <2 stops." }, 502);
    }

    const senderStopId = stopIds[0]!;
    const recipientStopIds = stopIds.slice(1);

    // Map response stops (may be reordered by Lalamove's route optimizer) back to orders by nearest coordinate
    const responseDeliveryStops = (quotation.stops ?? []).slice(1);
    const remaining = new Set(ordersData.map((o) => o.shopifyOrderId));
    const assignmentOrderIds: string[] = [];
    for (const stop of responseDeliveryStops) {
      const lat = parseFloat(stop.coordinates?.lat ?? "0");
      const lng = parseFloat(stop.coordinates?.lng ?? "0");
      let best: { id: string; dist: number } | null = null;
      for (const oid of remaining) {
        const o = ordersData.find((x) => x.shopifyOrderId === oid)!;
        const dist = Math.hypot(lat - o.lat, lng - o.lng);
        if (!best || dist < best.dist) best = { id: oid, dist };
      }
      if (best) {
        assignmentOrderIds.push(best.id);
        remaining.delete(best.id);
      }
    }
    // Fallback: any unmapped orders keep original order
    for (const o of ordersData) {
      if (!assignmentOrderIds.includes(o.shopifyOrderId)) assignmentOrderIds.push(o.shopifyOrderId);
    }
    if (assignmentOrderIds.length !== recipientStopIds.length) {
      return jsonResponse({ ok: false, error: "Stop-to-order mapping length mismatch." }, 500);
    }

    // 5. Build recipients and place order
    const pickupInstructions = (config as any).pickupInstructions?.trim();
    const recipients = recipientStopIds.map((stopId, idx) => {
      const orderId = assignmentOrderIds[idx]!;
      const orderData = ordersData.find((o) => o.shopifyOrderId === orderId)!;
      const remarks = buildLalamoveRecipientRemarks(idx, pickupInstructions, null);
      return {
        stopId,
        name: orderData.name,
        phone: orderData.phone,
        ...(remarks ? { remarks } : {}),
      };
    });

    const placeResponse = await placeLalamoveOrder(
      {
        market: config.market,
        quotationId: quotation.quotationId,
        sender: {
          stopId: senderStopId,
          name: config.locationName?.trim() ?? "",
          phone: config.locationPhone ?? "",
        },
        recipients,
        isPODEnabled: true,
        metadata: { shop, dispatchedBy: "claude-control" },
      },
      credentials,
    );

    // 6. Persist dispatch records
    const orderedStopsSnapshot = assignmentOrderIds.map((oid) => {
      const original = ordersData.find((o) => o.shopifyOrderId === oid)!;
      return {
        shopifyOrderId: original.shopifyOrderId,
        lat: original.lat,
        lng: original.lng,
        address: original.address,
        name: original.name,
        phone: original.phone,
      };
    });

    const dispatchJob = await prismaAny.lalamoveDispatchJob.create({
      data: {
        shop,
        routeId,
        locationId: locationGid,
        status: placeResponse.status,
        quotationId: quotation.quotationId,
        lalamoveOrderId: placeResponse.orderId,
        market: config.market,
        serviceType,
        requestedBy: "claude-control",
        quotationTotal: quotation.priceBreakdown?.total ?? null,
        quotationCurrency: quotation.priceBreakdown?.currency ?? null,
        ordersData: orderedStopsSnapshot,
      },
    });

    for (const oid of assignmentOrderIds) {
      await prismaAny.lalamoveDispatchOrderMap.create({
        data: {
          shop,
          dispatchJobId: dispatchJob.id,
          shopifyOrderId: oid,
          lalamoveOrderId: placeResponse.orderId,
          currentStatus: placeResponse.status,
        },
      });
    }

    console.info(
      `[control] dispatch OK shop=${shop} route=${routeId} lalamoveOrder=${placeResponse.orderId} orders=${assignmentOrderIds.length} total=${quotation.priceBreakdown?.total ?? "?"}`,
    );

    return jsonResponse({
      ok: true,
      routeId,
      lalamoveOrderId: placeResponse.orderId,
      status: placeResponse.status,
      shareLink: placeResponse.shareLink ?? null,
      dispatchJobId: dispatchJob.id,
      ordersDispatched: assignmentOrderIds.length,
      unresolvedAddresses,
      quotationTotal: quotation.priceBreakdown?.total ?? null,
      quotationCurrency: quotation.priceBreakdown?.currency ?? null,
    });
  } catch (err) {
    console.error(`[control] dispatch FAILED shop=${shop} route=${routeId}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "dispatch failed" },
      500,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/optimize — cluster unassigned orders into routes
// Body: { locationId: string, maxPerRoute?: number, flagAddressIssues?: boolean }
// Derives unassigned LOCAL orders at the location, runs the clustering
// optimizer, applies ld_rota-NN tags, saves a RouteOptimizationSnapshot
// for correction-tracking parity with the UI flow.
// Idempotent within the same day: skips orders already tagged ld_rota-*.
// ──────────────────────────────────────────────────────────────────────

const CLAUDE_OPTIMIZE_MAX_ROUTES = 20;
const CLAUDE_OPTIMIZE_DEFAULT_MAX_PER_ROUTE = 10;
const CLAUDE_OPTIMIZE_TARGET_PER_ROUTE = 5;

type EligibleOrderForOptimize = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  address1: string;
  address2: string;
  customer: string;
  phone: string;
};

async function fetchUnassignedOrdersForLocation(
  admin: { graphql: (q: string, o?: { variables?: Record<string, unknown> }) => Promise<Response> },
  locationGid: string,
): Promise<EligibleOrderForOptimize[]> {
  const legacyId = locationGid.replace("gid://shopify/Location/", "");
  const query = `fulfillment_location_id:${legacyId} fulfillment_status:unshipped status:open`;

  let cursor: string | null = null;
  const all: EligibleOrderForOptimize[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < 10; page += 1) {
    const res = await admin.graphql(
      `#graphql
        query ControlOptimizeOrders($query: String!, $first: Int!, $after: String) {
          orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT) {
            edges {
              cursor
              node {
                id name tags
                shippingAddress {
                  address1 address2 city province zip country
                  latitude longitude phone
                }
                customer {
                  displayName phone
                  defaultPhoneNumber { phoneNumber }
                }
                fulfillmentOrders(first: 10) {
                  nodes {
                    deliveryMethod { methodType }
                    assignedLocation { location { id } }
                  }
                }
              }
            }
            pageInfo { hasNextPage }
          }
        }`,
      { variables: { query, first: 50, after: cursor } },
    );
    const json = await res.json();
    const edges = (json?.data?.orders?.edges ?? []) as Array<any>;
    const hasNext = json?.data?.orders?.pageInfo?.hasNextPage ?? false;

    for (const edge of edges) {
      const o = edge.node;
      if (!o?.id || seen.has(o.id)) continue;
      seen.add(o.id);
      const tags: string[] = o.tags ?? [];
      if (tags.some((t: string) => /^ld_rota-\d+$/i.test(t))) continue;
      if (tags.includes("ld_address_review")) continue;
      const fo = o.fulfillmentOrders?.nodes ?? [];
      const isLocal = fo.some(
        (f: any) =>
          f?.deliveryMethod?.methodType === "LOCAL" &&
          f?.assignedLocation?.location?.id === locationGid,
      );
      if (!isLocal) continue;
      const addr = o.shippingAddress;
      if (!addr?.latitude || !addr?.longitude) continue;
      all.push({
        id: o.id,
        name: o.name ?? "",
        lat: Number(addr.latitude),
        lng: Number(addr.longitude),
        address: [addr.address1, addr.city, addr.province, addr.country].filter(Boolean).join(", "),
        address1: addr.address1 ?? "",
        address2: addr.address2 ?? "",
        customer: o.customer?.displayName ?? o.name ?? "Customer",
        phone:
          o.customer?.defaultPhoneNumber?.phoneNumber ??
          addr.phone ??
          o.customer?.phone ??
          "",
      });
    }

    if (!hasNext || edges.length === 0) break;
    cursor = edges[edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }
  return all;
}

function validateAddressLine(
  address1: string | null | undefined,
  address2: string | null | undefined,
): { isValid: boolean; issue: string | null } {
  const line1 = (address1 ?? "").trim();
  if (!line1) return { isValid: true, issue: null };
  const aptPatterns = /\b(apt|apto|apartment|unit|suite|ste|sala|bloco|bl|andar|casa)\b\.?\s*\d*/i;
  if (aptPatterns.test(line1) && !(address2 ?? "").trim()) {
    return { isValid: false, issue: "apartment_in_address1" };
  }
  const numbers = line1.match(/\d+/g) ?? [];
  if (numbers.length >= 3) {
    return { isValid: false, issue: "multiple_numbers_in_address1" };
  }
  return { isValid: true, issue: null };
}

async function handleOptimize(shop: string, body: Record<string, unknown>): Promise<Response> {
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : null;
  if (!locationIdRaw) {
    return jsonResponse({ ok: false, error: "locationId required" }, 400);
  }
  const maxPerRoute =
    typeof body.maxPerRoute === "number" && body.maxPerRoute > 0
      ? Math.min(CLAUDE_OPTIMIZE_DEFAULT_MAX_PER_ROUTE, body.maxPerRoute)
      : CLAUDE_OPTIMIZE_DEFAULT_MAX_PER_ROUTE;
  const flagAddressIssues = body.flagAddressIssues !== false; // default true
  const { gid: locationGid } = normalizeLocationId(locationIdRaw);
  const prismaAny = prisma as any;

  console.info(`[control] optimize START shop=${shop} location=${locationGid} maxPerRoute=${maxPerRoute}`);
  const start = Date.now();

  try {
    // 1. Load config (pickup coords required for clustering)
    const configRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId: locationGid } },
    });
    if (!configRow) {
      return jsonResponse({ ok: false, error: "Missing Lalamove settings for this location." }, 400);
    }
    const config = configRow.data as LalamoveConfig;
    const pickupLat = (config as any).pickupLat;
    const pickupLng = (config as any).pickupLng;
    if (pickupLat == null || pickupLng == null) {
      return jsonResponse({ ok: false, error: "Location config missing pickup coordinates." }, 400);
    }

    // 2. Fetch unassigned LOCAL orders at this location
    const { admin } = await unauthenticated.admin(shop);
    const orders = await fetchUnassignedOrdersForLocation(admin, locationGid);
    if (orders.length === 0) {
      return jsonResponse({
        ok: true,
        message: "No unassigned LOCAL orders at this location.",
        location: locationGid,
        orders: 0,
        routes: [],
      });
    }

    // 3. Address validation — flag problematic orders, exclude from this batch
    const validOrders: EligibleOrderForOptimize[] = [];
    const flagged: Array<{ orderId: string; name: string; issue: string }> = [];
    for (const o of orders) {
      const v = validateAddressLine(o.address1, o.address2);
      if (!v.isValid) {
        flagged.push({ orderId: o.id, name: o.name, issue: v.issue ?? "unknown" });
        if (flagAddressIssues) {
          try {
            await addTags(admin, o.id, ["ld_address_review"]);
            await admin.graphql(
              `#graphql
                mutation ControlOptimizeAddressNote($input: OrderInput!) {
                  orderUpdate(input: $input) { userErrors { message } }
                }`,
              {
                variables: {
                  input: {
                    id: o.id,
                    note: `Delivery paused - address needs review: ${v.issue}. Fix in CPG Labs > Local Delivery.`,
                  },
                },
              },
            );
          } catch (tagErr) {
            console.warn(`[control:optimize] address-review tag failed order=${o.id}`, tagErr);
          }
        }
        continue;
      }
      validOrders.push(o);
    }
    if (validOrders.length === 0) {
      return jsonResponse({
        ok: true,
        message: "All candidate orders were flagged for address review — none assignable this run.",
        location: locationGid,
        orders: 0,
        flagged,
        routes: [],
      });
    }

    // 4. Cluster orders into routes
    const optimizerInput: OptimizerOrderInput[] = validOrders.map((o) => ({
      orderId: o.id,
      locationId: locationGid,
      shippingCoordinates: { latitude: o.lat, longitude: o.lng },
      locationCoordinates: { latitude: pickupLat, longitude: pickupLng },
    }));
    const routeCount = Math.min(
      CLAUDE_OPTIMIZE_MAX_ROUTES,
      Math.max(1, Math.ceil(validOrders.length / CLAUDE_OPTIMIZE_TARGET_PER_ROUTE)),
    );
    const clusters = clusterOrders(optimizerInput, routeCount, maxPerRoute);
    const nonEmpty = clusters.filter((c) => c.length > 0);
    if (nonEmpty.length === 0) {
      return jsonResponse({
        ok: false,
        error: "Clustering produced no routes — check configuration.",
      }, 500);
    }

    // 5. Apply tags + record snapshot
    const appliedRoutes: Array<{
      slot: number;
      tag: string;
      orderIds: string[];
    }> = [];
    for (let i = 0; i < nonEmpty.length; i += 1) {
      const cluster = nonEmpty[i]!;
      const slot = i;
      const tag = routeTagForSlot(slot);
      const orderIds = cluster.map((c) => c.orderId);
      for (const orderId of orderIds) {
        try {
          await addTags(admin, orderId, [tag]);
        } catch (tagErr) {
          console.warn(`[control:optimize] tag failed order=${orderId} tag=${tag}`, tagErr);
        }
      }
      appliedRoutes.push({ slot, tag, orderIds });
    }

    // 6. Snapshot for correction tracking (parity with UI optimize-fleet)
    try {
      const proposedRoutes = appliedRoutes.map((r) => ({
        routeIndex: r.slot,
        orderIds: r.orderIds,
      }));
      const orderCoordinates = validOrders.map((o) => ({
        orderId: o.id,
        lat: o.lat,
        lng: o.lng,
      }));
      await prismaAny.routeOptimizationSnapshot.create({
        data: {
          shop,
          locationId: locationGid,
          proposedRoutes,
          orderCoordinates,
          orderCount: validOrders.length,
          routeCount: appliedRoutes.length,
        },
      });
    } catch (snapErr) {
      console.warn("[control:optimize] snapshot save failed", snapErr);
    }

    const elapsed = Date.now() - start;
    console.info(
      `[control] optimize OK shop=${shop} location=${locationGid} routes=${appliedRoutes.length} assigned=${validOrders.length} flagged=${flagged.length} elapsed=${elapsed}ms`,
    );

    return jsonResponse({
      ok: true,
      location: locationGid,
      orders: validOrders.length,
      flagged,
      routes: appliedRoutes,
      elapsedMs: elapsed,
    });
  } catch (err) {
    console.error(`[control] optimize FAILED shop=${shop} location=${locationGid}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "optimize failed" },
      500,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/reorder — cancel active Lalamove dispatch and re-request
// Body: { locationId, routeIndex } — same shape as dispatch.
// Finds the active dispatch job for this route, cancels it at Lalamove,
// marks DB as CANCELED, then calls dispatch again.
// ──────────────────────────────────────────────────────────────────────

async function handleReorder(shop: string, body: Record<string, unknown>): Promise<Response> {
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : null;
  const routeIndexRaw = body.routeIndex;
  if (!locationIdRaw) return jsonResponse({ ok: false, error: "locationId required" }, 400);
  const routeIndex =
    typeof routeIndexRaw === "number"
      ? routeIndexRaw
      : typeof routeIndexRaw === "string"
        ? Number.parseInt(routeIndexRaw, 10)
        : NaN;
  if (!Number.isFinite(routeIndex) || routeIndex < 0 || routeIndex >= MAX_ROUTE_SLOTS) {
    return jsonResponse({ ok: false, error: `routeIndex must be 0..${MAX_ROUTE_SLOTS - 1}` }, 400);
  }
  const { gid: locationGid } = normalizeLocationId(locationIdRaw);
  const routeId = `${locationGid}-${routeIndex}`;
  const prismaAny = prisma as any;

  console.info(`[control] reorder START shop=${shop} route=${routeId}`);

  try {
    // 1. Find active dispatch job
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const activeJob = await prismaAny.lalamoveDispatchJob.findFirst({
      where: {
        shop,
        locationId: locationGid,
        routeId,
        requestedAt: { gte: startOfToday },
        status: {
          notIn: [
            "cancelled", "CANCELLED", "CANCELED",
            "failed", "FAILED",
            "REJECTED", "rejected",
            "EXPIRED", "expired",
            "COMPLETED", "completed",
            "delivered", "DELIVERED", "FULFILLED",
          ],
        },
      },
      orderBy: { requestedAt: "desc" },
    });
    if (!activeJob) {
      return jsonResponse({ ok: false, error: "No active dispatch job found for this route today." }, 404);
    }

    // 2. Cancel at Lalamove
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return jsonResponse({ ok: false, error: "Missing Lalamove credentials." }, 400);
    }
    let cancelNote = "cancelled";
    try {
      await cancelLalamoveOrder(activeJob.market, activeJob.lalamoveOrderId, credentials);
      console.info(`[control] reorder: cancelled lalamove=${activeJob.lalamoveOrderId}`);
    } catch (cancelErr) {
      const msg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
      // If the order is already in a terminal/non-cancellable state, proceed anyway
      if (msg.includes("422") || msg.startsWith("404:")) {
        cancelNote = "already-terminal";
        console.warn(`[control] reorder: lalamove cancel non-fatal (${msg.slice(0, 100)}) — proceeding`);
      } else {
        throw cancelErr;
      }
    }

    // 3. Mark DB job as CANCELED (unblocks idempotency check in handleDispatch)
    await prismaAny.lalamoveDispatchJob.update({
      where: { id: activeJob.id },
      data: { status: "CANCELED" },
    });

    // 4. Re-dispatch
    console.info(`[control] reorder: calling dispatch for route=${routeId}`);
    const dispatchResponse = await handleDispatch(shop, {
      locationId: locationIdRaw,
      routeIndex,
    });
    const dispatchBody = await dispatchResponse.clone().json();
    return jsonResponse({
      ok: dispatchBody.ok === true,
      cancelled: {
        jobId: activeJob.id,
        lalamoveOrderId: activeJob.lalamoveOrderId,
        note: cancelNote,
      },
      redispatch: dispatchBody,
    }, dispatchResponse.status);
  } catch (err) {
    console.error(`[control] reorder FAILED shop=${shop} route=${routeId}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "reorder failed" },
      500,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/mark-delivered — close a route outside the normal webhook flow
// Body: { locationId, routeIndex, cancelPendingLalamove?: boolean = true }
//
// Mirrors the Lalamove COMPLETED webhook: archives route tags
// (ld_rota-NN → ld_rota-NN_YY.MM.DD), marks the dispatch job FULFILLED, and
// flips OrderMap currentStatus to "delivered". By default also cancels any
// still-pending Lalamove order so we don't get charged for a driver that
// shows up after the fact.
// ──────────────────────────────────────────────────────────────────────

async function handleMarkDelivered(shop: string, body: Record<string, unknown>): Promise<Response> {
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : null;
  const routeIndexRaw = body.routeIndex;
  const cancelPendingLalamove = body.cancelPendingLalamove !== false; // default true
  const createShopifyFulfillment = body.createShopifyFulfillment !== false; // default true
  const notifyCustomer = body.notifyCustomer === true; // default false to avoid email spam
  if (!locationIdRaw) return jsonResponse({ ok: false, error: "locationId required" }, 400);
  const routeIndex =
    typeof routeIndexRaw === "number"
      ? routeIndexRaw
      : typeof routeIndexRaw === "string"
        ? Number.parseInt(routeIndexRaw, 10)
        : NaN;
  if (!Number.isFinite(routeIndex) || routeIndex < 0 || routeIndex >= MAX_ROUTE_SLOTS) {
    return jsonResponse({ ok: false, error: `routeIndex must be 0..${MAX_ROUTE_SLOTS - 1}` }, 400);
  }
  const { gid: locationGid } = normalizeLocationId(locationIdRaw);
  const routeId = `${locationGid}-${routeIndex}`;
  const prismaAny = prisma as any;

  console.info(`[control] mark-delivered START shop=${shop} route=${routeId}`);

  try {
    // 1. Find the most recent dispatch job for this route within the last 48h.
    //    48h window is generous enough to cover same-day runs + timezone edges
    //    without matching ancient jobs for the same slot.
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const job = await prismaAny.lalamoveDispatchJob.findFirst({
      where: {
        shop,
        locationId: locationGid,
        routeId,
        requestedAt: { gte: since },
      },
      orderBy: { requestedAt: "desc" },
    });
    if (!job) {
      return jsonResponse({ ok: false, error: "No dispatch job found for this route today." }, 404);
    }

    // 2. Optionally cancel at Lalamove if still in a non-terminal state
    const terminalStatuses = new Set([
      "COMPLETED", "completed",
      "CANCELED", "CANCELLED", "cancelled",
      "REJECTED", "rejected",
      "EXPIRED", "expired",
      "FULFILLED", "delivered", "DELIVERED",
    ]);
    let lalamoveCancelNote = "skipped";
    if (cancelPendingLalamove && !terminalStatuses.has(String(job.status))) {
      try {
        const credentials = await getRuntimeCredentialsForShop(shop);
        if (credentials) {
          await cancelLalamoveOrder(job.market, job.lalamoveOrderId, credentials);
          lalamoveCancelNote = "cancelled-at-lalamove";
        } else {
          lalamoveCancelNote = "no-credentials-skipped";
        }
      } catch (cancelErr) {
        const msg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
        if (msg.includes("422") || msg.startsWith("404:")) {
          lalamoveCancelNote = "already-terminal-at-lalamove";
        } else {
          lalamoveCancelNote = `cancel-error: ${msg.slice(0, 120)}`;
          console.warn(`[control] mark-delivered: cancel non-fatal`, msg);
        }
      }
    }

    // 3. Archive route tags on all mapped orders (ld_rota-NN → ld_rota-NN_YY.MM.DD)
    const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
      where: { shop, dispatchJobId: job.id },
      select: { shopifyOrderId: true },
    });
    const orderIds = (orderMaps as Array<{ shopifyOrderId: string }>).map((m) => m.shopifyOrderId);

    const now = new Date();
    const dateStr = `${String(now.getFullYear()).slice(-2)}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;

    const { admin } = await unauthenticated.admin(shop);
    const archiveResults = await Promise.allSettled(
      orderIds.map((id) => renameRouteTagsToArchive(admin, id, dateStr)),
    );
    const archived = archiveResults.filter((r) => r.status === "fulfilled").length;
    const archiveFailures = archiveResults.length - archived;
    if (archiveFailures > 0) {
      console.warn(`[control] mark-delivered: ${archiveFailures} tag-archive failures (non-fatal)`);
    }

    // 4. Mark dispatch job FULFILLED and order maps delivered
    await prismaAny.lalamoveDispatchJob.update({
      where: { id: job.id },
      data: { status: "FULFILLED" },
    });
    await prismaAny.lalamoveDispatchOrderMap.updateMany({
      where: { shop, dispatchJobId: job.id },
      data: { currentStatus: "delivered" },
    });

    // 5. Flip Shopify status to Fulfilled + Delivered.
    // Idempotent: if a fulfillment already exists (prior run), we just add a
    // DELIVERED event. Otherwise we fulfillmentCreateV2 first, then event.
    let shopifyFulfilled = 0;
    let deliveredEventsCreated = 0;
    const fulfillmentFailures: Array<{ orderId: string; reason: string }> = [];

    async function addDeliveredEvent(fulfillmentId: string, orderId: string) {
      try {
        const eventResp = await admin.graphql(
          `#graphql
            mutation ControlMarkDeliveredEvent($fulfillmentId: ID!, $status: FulfillmentEventStatus!) {
              fulfillmentEventCreate(fulfillmentEvent: { fulfillmentId: $fulfillmentId, status: $status }) {
                fulfillmentEvent { id status }
                userErrors { field message }
              }
            }`,
          { variables: { fulfillmentId, status: "DELIVERED" } },
        );
        const eventJson = await eventResp.json();
        const eventErrors = eventJson?.data?.fulfillmentEventCreate?.userErrors ?? [];
        if (eventErrors.length > 0) {
          console.warn(`[control] mark-delivered event userErrors order=${orderId}`, eventErrors);
          fulfillmentFailures.push({
            orderId,
            reason: `event: ${eventErrors.map((e: any) => e.message).join("; ")}`,
          });
          return false;
        }
        deliveredEventsCreated += 1;
        return true;
      } catch (err) {
        console.warn(
          `[control] mark-delivered event exception order=${orderId}`,
          err instanceof Error ? err.message : String(err),
        );
        return false;
      }
    }

    if (createShopifyFulfillment && orderIds.length > 0) {
      for (const shopifyOrderId of orderIds) {
        try {
          // Inspect order: existing fulfillments + open fulfillment orders
          const inspect = await admin.graphql(
            `#graphql
              query ControlMarkDeliveredInspect($id: ID!) {
                order(id: $id) {
                  fulfillments(first: 20) { id status displayStatus }
                  fulfillmentOrders(first: 20) {
                    nodes {
                      id status
                      assignedLocation { location { id } }
                    }
                  }
                }
              }`,
            { variables: { id: shopifyOrderId } },
          );
          const inspectJson = await inspect.json();
          const existingFulfillments = (inspectJson?.data?.order?.fulfillments ?? []) as Array<any>;
          const foNodes = (inspectJson?.data?.order?.fulfillmentOrders?.nodes ?? []) as Array<any>;

          if (existingFulfillments.length > 0) {
            // Already fulfilled — just push DELIVERED event on each non-cancelled fulfillment
            const targets = existingFulfillments.filter((f) => f?.status && f.status !== "CANCELLED");
            if (targets.length === 0) {
              fulfillmentFailures.push({ orderId: shopifyOrderId, reason: "only cancelled fulfillments found" });
              continue;
            }
            for (const f of targets) {
              await addDeliveredEvent(f.id, shopifyOrderId);
            }
            shopifyFulfilled += 1;
            continue;
          }

          // No existing fulfillment — create one using open fulfillment orders at this location
          const openFOs = foNodes.filter(
            (n) =>
              (n?.status === "OPEN" || n?.status === "IN_PROGRESS") &&
              n?.assignedLocation?.location?.id === locationGid,
          );
          if (openFOs.length === 0) {
            fulfillmentFailures.push({ orderId: shopifyOrderId, reason: "no fulfillments and no open fulfillment orders at this location" });
            continue;
          }

          const createResp = await admin.graphql(
            `#graphql
              mutation ControlMarkDeliveredFulfill($fulfillment: FulfillmentV2Input!) {
                fulfillmentCreateV2(fulfillment: $fulfillment) {
                  fulfillment { id status }
                  userErrors { field message }
                }
              }`,
            {
              variables: {
                fulfillment: {
                  lineItemsByFulfillmentOrder: openFOs.map((n) => ({ fulfillmentOrderId: n.id })),
                  notifyCustomer,
                  trackingInfo: { company: "Lalamove", number: job.lalamoveOrderId },
                },
              },
            },
          );
          const createJson = await createResp.json();
          const userErrors = createJson?.data?.fulfillmentCreateV2?.userErrors ?? [];
          const fulfillmentId = createJson?.data?.fulfillmentCreateV2?.fulfillment?.id ?? null;
          if (userErrors.length > 0) {
            fulfillmentFailures.push({
              orderId: shopifyOrderId,
              reason: userErrors.map((e: any) => e.message).join("; "),
            });
            continue;
          }
          if (!fulfillmentId) {
            fulfillmentFailures.push({ orderId: shopifyOrderId, reason: "no fulfillment returned" });
            continue;
          }
          shopifyFulfilled += 1;
          await addDeliveredEvent(fulfillmentId, shopifyOrderId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          fulfillmentFailures.push({ orderId: shopifyOrderId, reason: msg.slice(0, 150) });
          console.warn(`[control] mark-delivered order-loop exception order=${shopifyOrderId}`, msg);
        }
      }
    }

    console.info(
      `[control] mark-delivered OK shop=${shop} route=${routeId} job=${job.id} orders=${orderIds.length} archived=${archived} lalamove=${lalamoveCancelNote} shopifyFulfilled=${shopifyFulfilled}/${orderIds.length}`,
    );

    return jsonResponse({
      ok: true,
      routeId,
      jobId: job.id,
      lalamoveOrderId: job.lalamoveOrderId,
      ordersDelivered: orderIds.length,
      tagsArchivedOn: `${dateStr} (YY.MM.DD)`,
      archiveFailures,
      lalamove: lalamoveCancelNote,
      shopifyFulfilled,
      deliveredEventsCreated,
      fulfillmentFailures,
    });
  } catch (err) {
    console.error(`[control] mark-delivered FAILED shop=${shop} route=${routeId}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "mark-delivered failed" },
      500,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/mark-all-today — close out EVERY dispatch job at a
// location from the last 24h. Useful after the auto-cron has completed
// its day: the webhook COMPLETED flow archives tags + marks DB FULFILLED
// but does NOT create Shopify fulfillments, so customers see orders as
// "Unfulfilled" in admin. This sweep ensures Shopify fulfillment + a
// DELIVERED event exist for every order that was dispatched today.
//
// Body: { locationId, notifyCustomer?: boolean = false }
// Idempotent: if a Shopify fulfillment already exists we only add the
// DELIVERED event (no duplicate fulfillments).
// ──────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/quote — price-check one or more route compositions
// without placing Lalamove orders. Read-only against Lalamove's
// /v3/quotations endpoint; no DB writes.
// Body: { locationId, routes: [{ orderIds: string[] }, ...] }
// ──────────────────────────────────────────────────────────────────────

async function handleQuote(shop: string, body: Record<string, unknown>): Promise<Response> {
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : null;
  const routesInput = Array.isArray(body.routes) ? (body.routes as unknown[]) : null;
  if (!locationIdRaw) return jsonResponse({ ok: false, error: "locationId required" }, 400);
  if (!routesInput || routesInput.length === 0) {
    return jsonResponse({ ok: false, error: "routes[] required (array of { orderIds: string[] })" }, 400);
  }
  const { gid: locationGid } = normalizeLocationId(locationIdRaw);

  const normalizedRoutes: string[][] = [];
  for (let i = 0; i < routesInput.length; i += 1) {
    const r = routesInput[i] as Record<string, unknown> | null;
    const orderIds =
      r && Array.isArray(r.orderIds)
        ? (r.orderIds as unknown[]).filter((x): x is string => typeof x === "string")
        : null;
    if (!orderIds || orderIds.length === 0) {
      return jsonResponse({ ok: false, error: `routes[${i}].orderIds[] required` }, 400);
    }
    normalizedRoutes.push(orderIds);
  }

  console.info(
    `[control] quote START shop=${shop} location=${locationGid} routes=${normalizedRoutes.length}`,
  );
  const start = Date.now();

  try {
    const configRow = await prisma.lalamoveLocationConfig.findUnique({
      where: { shop_locationId: { shop, locationId: locationGid } },
    });
    if (!configRow) {
      return jsonResponse({ ok: false, error: "Missing Lalamove settings for this location." }, 400);
    }
    const config = configRow.data as LalamoveConfig;
    const credentials = await getRuntimeCredentialsForShop(shop);
    if (!credentials) {
      return jsonResponse({ ok: false, error: "Missing Lalamove credentials." }, 400);
    }
    const pickupLat = (config as any).pickupLat;
    const pickupLng = (config as any).pickupLng;
    if (pickupLat == null || pickupLng == null) {
      return jsonResponse({ ok: false, error: "Location config missing pickup coordinates." }, 400);
    }
    const carrierConfigRow = await (prisma as any).carrierServiceConfig.findUnique({ where: { shop } });
    const carrierConfig = carrierConfigRow?.data as { lalamovePreferredServiceType?: string } | undefined;
    const serviceType =
      config.preferredServiceType?.trim() ||
      carrierConfig?.lalamovePreferredServiceType?.trim() ||
      "LALAGO";
    const specialRequests = await resolveConfiguredSpecialRequests(
      shop,
      { market: config.market, city: (config as any).city ?? null, preferredServiceType: serviceType },
      credentials,
    );

    const allOrderIds = Array.from(new Set(normalizedRoutes.flat()));
    const { admin } = await unauthenticated.admin(shop);
    const ordersResp = await admin.graphql(
      `#graphql
        query ControlQuoteOrders($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Order {
              id name
              shippingAddress {
                address1 address2 city province zip
                latitude longitude
              }
            }
          }
        }`,
      { variables: { ids: allOrderIds } },
    );
    const ordersJson = await ordersResp.json();
    const orderById = new Map<string, any>();
    for (const o of (ordersJson.data?.nodes ?? []) as Array<any>) {
      if (o?.id) orderById.set(o.id, o);
    }

    const results: Array<Record<string, unknown>> = [];
    let grandTotal = 0;
    let currency: string | null = null;

    for (let i = 0; i < normalizedRoutes.length; i += 1) {
      const orderIds = normalizedRoutes[i]!;
      const missingIds = orderIds.filter((id) => !orderById.has(id));
      if (missingIds.length > 0) {
        results.push({ routeIndex: i, ok: false, error: "Missing orders", missingIds });
        continue;
      }
      const routeOrders = orderIds.map((id) => orderById.get(id));
      const missingCoords = routeOrders.filter(
        (o: any) => !o?.shippingAddress?.latitude || !o?.shippingAddress?.longitude,
      );
      if (missingCoords.length > 0) {
        results.push({
          routeIndex: i,
          ok: false,
          error: "Missing coordinates on some orders",
          orders: missingCoords.map((o: any) => o.name),
        });
        continue;
      }

      const stops = [
        {
          coordinates: { lat: String(pickupLat), lng: String(pickupLng) },
          address: (config.locationAddress ?? "").trim(),
        },
        ...routeOrders.map((o: any) => {
          const addr = o.shippingAddress;
          const line = [addr.address1, addr.address2, addr.city, addr.province, addr.zip]
            .filter(Boolean)
            .join(", ");
          return {
            coordinates: { lat: String(addr.latitude), lng: String(addr.longitude) },
            address: line,
          };
        }),
      ];

      try {
        const quotation = await createLalamoveQuotation(
          {
            market: config.market,
            language: (config as any).language,
            serviceType,
            stops,
            isRouteOptimized: stops.length >= 3,
            ...(specialRequests.length > 0 ? { specialRequests } : {}),
          },
          credentials,
        );
        const totalStr = quotation.priceBreakdown?.total ?? null;
        const total = totalStr ? parseFloat(totalStr) : NaN;
        if (Number.isFinite(total)) grandTotal += total;
        if (!currency && quotation.priceBreakdown?.currency) {
          currency = quotation.priceBreakdown.currency;
        }
        results.push({
          routeIndex: i,
          ok: true,
          orders: routeOrders.length,
          orderNames: routeOrders.map((o: any) => o.name),
          total: totalStr,
          currency: quotation.priceBreakdown?.currency ?? null,
          distance: quotation.distance ?? null,
          priceBreakdown: quotation.priceBreakdown ?? null,
        });
      } catch (err) {
        results.push({
          routeIndex: i,
          ok: false,
          error: err instanceof Error ? err.message : "quote failed",
          orders: routeOrders.length,
          orderNames: routeOrders.map((o: any) => o.name),
        });
      }
    }

    const elapsed = Date.now() - start;
    console.info(
      `[control] quote OK shop=${shop} location=${locationGid} routes=${normalizedRoutes.length} grandTotal=${grandTotal.toFixed(2)} elapsed=${elapsed}ms`,
    );

    return jsonResponse({
      ok: true,
      location: locationGid,
      routes: results,
      grandTotal: grandTotal.toFixed(2),
      currency,
      elapsedMs: elapsed,
    });
  } catch (err) {
    console.error(`[control] quote FAILED shop=${shop} location=${locationGid}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "quote failed" },
      500,
    );
  }
}

async function handleMarkAllToday(shop: string, body: Record<string, unknown>): Promise<Response> {
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : null;
  const notifyCustomer = body.notifyCustomer === true;
  if (!locationIdRaw) return jsonResponse({ ok: false, error: "locationId required" }, 400);
  const { gid: locationGid } = normalizeLocationId(locationIdRaw);
  const prismaAny = prisma as any;

  console.info(`[control] mark-all-today START shop=${shop} location=${locationGid}`);

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const jobs = await prismaAny.lalamoveDispatchJob.findMany({
      where: {
        shop,
        locationId: locationGid,
        requestedAt: { gte: since },
      },
      orderBy: { requestedAt: "asc" },
    });

    if (jobs.length === 0) {
      return jsonResponse({
        ok: true,
        location: locationGid,
        message: "No dispatch jobs in the last 24h at this location.",
        jobsProcessed: 0,
      });
    }

    const { admin } = await unauthenticated.admin(shop);

    const jobSummaries: Array<Record<string, unknown>> = [];
    let totalOrders = 0;
    let totalShopifyFulfilled = 0;
    let totalDeliveredEvents = 0;
    let totalFailures = 0;

    for (const job of jobs as Array<any>) {
      const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
        where: { shop, dispatchJobId: job.id },
        select: { shopifyOrderId: true },
      });
      const orderIds = (orderMaps as Array<{ shopifyOrderId: string }>).map((m) => m.shopifyOrderId);
      totalOrders += orderIds.length;

      let shopifyFulfilled = 0;
      let deliveredEventsCreated = 0;
      const failures: Array<{ orderId: string; reason: string }> = [];

      for (const shopifyOrderId of orderIds) {
        try {
          const inspect = await admin.graphql(
            `#graphql
              query ControlMarkAllTodayInspect($id: ID!) {
                order(id: $id) {
                  fulfillments(first: 20) { id status displayStatus }
                  fulfillmentOrders(first: 20) {
                    nodes {
                      id status
                      assignedLocation { location { id } }
                    }
                  }
                }
              }`,
            { variables: { id: shopifyOrderId } },
          );
          const inspectJson = await inspect.json();
          const existingFulfillments = (inspectJson?.data?.order?.fulfillments ?? []) as Array<any>;
          const foNodes = (inspectJson?.data?.order?.fulfillmentOrders?.nodes ?? []) as Array<any>;

          let fulfillmentIdsToEvent: string[] = [];
          if (existingFulfillments.length > 0) {
            fulfillmentIdsToEvent = existingFulfillments
              .filter((f) => f?.status && f.status !== "CANCELLED")
              .map((f) => f.id);
            if (fulfillmentIdsToEvent.length === 0) {
              failures.push({ orderId: shopifyOrderId, reason: "only cancelled fulfillments" });
              continue;
            }
            shopifyFulfilled += 1;
          } else {
            const openFOs = foNodes.filter(
              (n) =>
                (n?.status === "OPEN" || n?.status === "IN_PROGRESS") &&
                n?.assignedLocation?.location?.id === locationGid,
            );
            if (openFOs.length === 0) {
              failures.push({ orderId: shopifyOrderId, reason: "no fulfillments and no open fulfillment orders" });
              continue;
            }
            const createResp = await admin.graphql(
              `#graphql
                mutation ControlMarkAllTodayFulfill($fulfillment: FulfillmentV2Input!) {
                  fulfillmentCreateV2(fulfillment: $fulfillment) {
                    fulfillment { id status }
                    userErrors { field message }
                  }
                }`,
              {
                variables: {
                  fulfillment: {
                    lineItemsByFulfillmentOrder: openFOs.map((n) => ({ fulfillmentOrderId: n.id })),
                    notifyCustomer,
                    trackingInfo: { company: "Lalamove", number: job.lalamoveOrderId },
                  },
                },
              },
            );
            const createJson = await createResp.json();
            const userErrors = createJson?.data?.fulfillmentCreateV2?.userErrors ?? [];
            const newFulfillmentId = createJson?.data?.fulfillmentCreateV2?.fulfillment?.id ?? null;
            if (userErrors.length > 0 || !newFulfillmentId) {
              failures.push({
                orderId: shopifyOrderId,
                reason: userErrors.length > 0 ? userErrors.map((e: any) => e.message).join("; ") : "no fulfillment returned",
              });
              continue;
            }
            shopifyFulfilled += 1;
            fulfillmentIdsToEvent = [newFulfillmentId];
          }

          // DELIVERED event on each relevant fulfillment
          for (const fulfillmentId of fulfillmentIdsToEvent) {
            try {
              const eventResp = await admin.graphql(
                `#graphql
                  mutation ControlMarkAllTodayEvent($fulfillmentId: ID!, $status: FulfillmentEventStatus!) {
                    fulfillmentEventCreate(fulfillmentEvent: { fulfillmentId: $fulfillmentId, status: $status }) {
                      fulfillmentEvent { id status }
                      userErrors { field message }
                    }
                  }`,
                { variables: { fulfillmentId, status: "DELIVERED" } },
              );
              const eventJson = await eventResp.json();
              const eventErrors = eventJson?.data?.fulfillmentEventCreate?.userErrors ?? [];
              if (eventErrors.length > 0) {
                failures.push({
                  orderId: shopifyOrderId,
                  reason: `event: ${eventErrors.map((e: any) => e.message).join("; ")}`,
                });
              } else {
                deliveredEventsCreated += 1;
              }
            } catch (eventErr) {
              const msg = eventErr instanceof Error ? eventErr.message : String(eventErr);
              failures.push({ orderId: shopifyOrderId, reason: `event-exc: ${msg.slice(0, 80)}` });
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push({ orderId: shopifyOrderId, reason: msg.slice(0, 120) });
        }
      }

      // Update job + maps to terminal FULFILLED
      await prismaAny.lalamoveDispatchJob.update({
        where: { id: job.id },
        data: { status: "FULFILLED" },
      });
      await prismaAny.lalamoveDispatchOrderMap.updateMany({
        where: { shop, dispatchJobId: job.id },
        data: { currentStatus: "delivered" },
      });

      totalShopifyFulfilled += shopifyFulfilled;
      totalDeliveredEvents += deliveredEventsCreated;
      totalFailures += failures.length;

      jobSummaries.push({
        jobId: job.id,
        routeId: job.routeId,
        lalamoveOrderId: job.lalamoveOrderId,
        orders: orderIds.length,
        shopifyFulfilled,
        deliveredEventsCreated,
        failures,
      });
    }

    console.info(
      `[control] mark-all-today OK shop=${shop} location=${locationGid} jobs=${jobs.length} orders=${totalOrders} shopifyFulfilled=${totalShopifyFulfilled} deliveredEvents=${totalDeliveredEvents} failures=${totalFailures}`,
    );

    return jsonResponse({
      ok: true,
      location: locationGid,
      jobsProcessed: jobs.length,
      totals: {
        orders: totalOrders,
        shopifyFulfilled: totalShopifyFulfilled,
        deliveredEventsCreated: totalDeliveredEvents,
        failures: totalFailures,
      },
      jobs: jobSummaries,
    });
  } catch (err) {
    console.error(`[control] mark-all-today FAILED shop=${shop} location=${locationGid}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "mark-all-today failed" },
      500,
    );
  }
}
