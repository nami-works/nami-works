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
 *   POST /api/control/check-dispatches   body: {} — polls live driver location
 *       for every in-flight dispatch and returns approach-to-pickup telemetry +
 *       reorder suggestions when a driver has stalled. Also auto-archives route
 *       tags (Phase A of the close flow) when a route transitions to COMPLETED.
 *   POST /api/control/close-route    body: {locationId, routeIndex} — Phase A:
 *       archive ld_rota-NN tags to ld_rota-NN_YY.MM.DD + mark DB job FULFILLED.
 *       No Shopify fulfillment. Safe to run repeatedly (Promise.allSettled).
 *   POST /api/control/fulfill-route  body: {locationId, routeIndex} — Phase B:
 *       create Shopify fulfillment + DELIVERED event. Assumes close-route already
 *       archived tags. Requires user approval (manual trigger).
 *   POST /api/control/mark-delivered body: {locationId, routeIndex} — LEGACY
 *       one-shot: both phases in a single call. Kept for scripts that haven't
 *       migrated to the two-phase flow.
 *   POST /api/control/render-routes  body: {locationId?} — build Google Static
 *       Maps URLs (one per active-route location) with color-coded order markers
 *       + store pickup point. Python client downloads the PNGs so Claude can
 *       Read them and apply spatial reasoning that coordinate math misses
 *       (water barriers, neighborhood gravity, traffic corridors).
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
  getLalamoveDriverDetails,
} from "../services/lalamove.server";
import { resolveConfiguredSpecialRequests } from "../services/lalamove-special-requests.server";
import { clusterOrders } from "../services/carrier-quotation-optimizer.server";
import { addTags, renameRouteTagsToArchive } from "../services/lalamove-sync.server";
import { LD_ADDRESS_CONFIRM_TAG, getAllAutoAssignSkipTags } from "../services/lalamove-tags";
import { applyAddressRepairOrTag } from "../services/address-repair.server";
import type { OptimizerOrderInput } from "../services/google-routes-shared.server";
import {
  isPhase1EnabledForLocation,
  runRouteOptimizationPipeline,
  buildPhase1PipelineInput,
} from "../services/route-optimization/pipeline.server";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import {
  summarizeRoutePOD,
  bucketRouteForFulfillment,
  REDELIVERY_TAG,
  type RouteBucket,
  type StopSummary,
  type LalamoveStop,
  type DispatchOrderSnapshot,
  type DispatchOrderMapRow,
} from "../services/pod-bucketing.server";

const MAX_ROUTE_SLOTS = 20;
const TERMINAL_DISPATCH_STATUSES = new Set(["COMPLETED", "CANCELED", "REJECTED", "EXPIRED"]);
const ADDRESS_REVIEW_TAG = LD_ADDRESS_CONFIRM_TAG;

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

    // Active Lalamove dispatches for this location.
    // Multiple jobs can share a slot across days (cron's rota-01 + Claude's
    // rota-01 the next day); keep only the most recent per slot.
    const activeDispatchesRaw = await (prisma as any).lalamoveDispatchJob.findMany({
      where: {
        shop: auth.shop,
        routeId: { startsWith: `${locationGid}-` },
        status: { notIn: Array.from(TERMINAL_DISPATCH_STATUSES) },
      },
      select: { routeId: true, status: true, lalamoveOrderId: true, market: true, requestedAt: true },
      orderBy: { requestedAt: "desc" },
    });
    const dispatchBySlot = new Map<number, any>();
    for (const d of activeDispatchesRaw as Array<any>) {
      const suffix = String(d.routeId).slice(locationGid.length + 1);
      const idx = Number.parseInt(suffix, 10);
      if (Number.isFinite(idx) && idx >= 0 && !dispatchBySlot.has(idx)) {
        dispatchBySlot.set(idx, d);
      }
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
    case "mark-stop-delivered":
      return handleMarkStopDelivered(auth.shop, body);
    case "mark-all-today":
      return handleMarkAllToday(auth.shop, body);
    case "quote":
      return handleQuote(auth.shop, body);
    case "check-dispatches":
      return handleCheckDispatches(auth.shop, body);
    case "render-routes":
      return handleRenderRoutes(auth.shop, body);
    case "close-route":
      // Phase A: tag archival + DB close. No Shopify fulfillment.
      return handleMarkDelivered(auth.shop, {
        ...body,
        createShopifyFulfillment: false,
        archiveTags: true,
        cancelPendingLalamove: false,
      });
    case "fulfill-route":
      // Phase B: Shopify fulfillment + DELIVERED event. Tags already archived.
      return handleMarkDelivered(auth.shop, {
        ...body,
        createShopifyFulfillment: true,
        archiveTags: false,
        cancelPendingLalamove: false,
      });
    case "post-mortem-list":
      // List recent RouteOptimizationDecision rows for headless review.
      return handlePostMortemList(auth.shop, body);
    case "post-mortem-verdict":
      // Capture operator verdict on one decision. Body: {decisionId, verdict, comment?}.
      return handlePostMortemVerdict(auth.shop, body);
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
  address2: string | null;
  name: string;
  phone: string;
};

// Mirrors formatFulfillmentStopAddress in app.local-delivery.tsx — joins
// locationName + locationAddress + locationDetails with " • " so Lalamove's
// UI shows store name, street, and complement as distinct lines rather than
// only the street.
function formatPickupStopAddress(
  name?: string | null,
  address?: string | null,
  details?: string | null,
): string {
  return [name, address, details]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" • ");
}

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
      // Build the street-line portion (without address2 — that goes through
      // sourceAddress2 so Lalamove keeps the complement visually distinct).
      const line = [addr.address1, addr.city, addr.province, addr.zip]
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
        address2: addr.address2 ?? null,
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
    const pickupAddressBase = formatPickupStopAddress(
      (config as any).locationName,
      config.locationAddress,
      (config as any).locationDetails,
    ) || (config.locationAddress ?? "").trim();
    const stops = [
      { coordinates: { lat: String(pickupLat), lng: String(pickupLng) }, address: pickupAddressBase },
      ...ordersData.map((o) => ({
        coordinates: { lat: String(o.lat), lng: String(o.lng) },
        address: o.address,
        sourceAddress2: o.address2,
      })),
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
// Hard cap per GE Beauty operational constraint (2026-04-23): a driver cannot
// carry or reliably drop off more than 7 packages per route, regardless of how
// tight the geographic cluster is. See memory/feedback_max_orders_per_route.md.
const CLAUDE_OPTIMIZE_DEFAULT_MAX_PER_ROUTE = 7;
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
      // Centralized exclusion list — matches api.cron.auto-delivery.tsx so
      // Claude-driven and cron-driven runs respect the same operator skips
      // (ld_address-confirm, ld_number-confirm, ld_failed-delivery, "Failed delivery").
      const skipTags = getAllAutoAssignSkipTags();
      const matchedSkip = tags.find((t: string) => skipTags.includes(t));
      if (matchedSkip) {
        console.info(`[control:optimize] skip orderId=${o.id} reason=${matchedSkip}`);
        continue;
      }
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

// ── Phase 1 LLM-enabled optimizer helper (feature-flagged) ─────────────────
// Maps a Lalamove config to the MarketKey via the shared helper in
// pipeline.server.ts so all entry points (control API, UI, cron) stay
// in sync. Returns null when Phase 1 can't run for this location (unknown
// market or missing Lalamove credentials) — caller falls back to legacy.
async function runPhase1Optimize(args: {
  shop: string;
  admin: AdminApiContext;
  locationGid: string;
  config: LalamoveConfig;
  pickupLat: number;
  pickupLng: number;
  validOrders: EligibleOrderForOptimize[];
  flagged: Array<{ orderId: string; name: string; issue: string }>;
  start: number;
}): Promise<Response | null> {
  const { shop, admin, locationGid, config, pickupLat, pickupLng, validOrders, flagged, start } = args;

  const pipelineInput = await buildPhase1PipelineInput({
    shop,
    locationId: locationGid,
    config,
    pickupLat,
    pickupLng,
    orders: validOrders.map((o) => ({
      id: o.id,
      name: o.name,
      lat: o.lat,
      lng: o.lng,
      neighborhood: (o as { neighborhood?: string }).neighborhood,
    })),
    credentialsResolver: getRuntimeCredentialsForShop,
  });
  if (!pipelineInput) {
    console.warn(`[control:optimize] Phase 1 skipped (unknown market or missing credentials) shop=${shop} city=${config.city ?? "?"}`);
    return null;
  }

  const result = await runRouteOptimizationPipeline(pipelineInput);

  // Apply the winning clustering as ld_rota tags.
  const appliedRoutes: Array<{ slot: number; tag: string; orderIds: string[] }> = [];
  for (const slot of result.winningClustering) {
    const tag = routeTagForSlot(slot.slot);
    const orderIds = slot.orderIds
      .map((name) => validOrders.find((o) => o.name === name)?.id)
      .filter((id): id is string => Boolean(id));
    for (const orderId of orderIds) {
      try {
        await addTags(admin, orderId, [tag]);
      } catch (tagErr) {
        console.warn(`[control:optimize] Phase 1 tag failed order=${orderId} tag=${tag}`, tagErr);
      }
    }
    appliedRoutes.push({ slot: slot.slot, tag, orderIds });
  }

  const elapsed = Date.now() - start;
  console.info(
    `[control] optimize Phase1 OK shop=${shop} location=${locationGid} decisionId=${result.decisionId} winner=${result.decision.winningCandidateId} path=${result.decision.decisionPath} flags=${result.decision.postMortemFlags.length} elapsed=${elapsed}ms`,
  );

  return jsonResponse({
    ok: true,
    location: locationGid,
    orders: validOrders.length,
    flagged,
    routes: appliedRoutes,
    elapsedMs: elapsed,
    phase1: {
      decisionId: result.decisionId,
      decisionPath: result.decision.decisionPath,
      winningCandidateId: result.decision.winningCandidateId,
      confidence: result.decision.confidence,
      postMortemFlags: result.decision.postMortemFlags,
      timings: result.timings,
    },
  });
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

    // 3. Address validation — flag problematic orders, exclude from this batch.
    // Track 4 §6.7: try the deterministic patterns first; auto-fix in place
    // when one matches, else tag for human review.
    const validOrders: EligibleOrderForOptimize[] = [];
    const flagged: Array<{ orderId: string; name: string; issue: string }> = [];
    for (const o of orders) {
      const v = validateAddressLine(o.address1, o.address2);
      if (!v.isValid) {
        flagged.push({ orderId: o.id, name: o.name, issue: v.issue ?? "unknown" });
        if (flagAddressIssues) {
          try {
            await applyAddressRepairOrTag({
              admin,
              shop,
              order: { id: o.id, address1: o.address1, address2: o.address2 },
              noteFallback: `Delivery paused - address needs review: ${v.issue}. Fix in Omnify > Local Delivery.`,
            });
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

    // 3b. Phase 1: LLM-enabled optimizer (feature-flagged).
    // Runs only when BOTH:
    //   - process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED === "true", AND
    //   - LalamoveLocationConfig.data.routeOptimizationPhase1Enabled === true
    // Falls back to the legacy clusterOrders path on any unrecoverable error.
    if (isPhase1EnabledForLocation(config)) {
      try {
        const phase1Response = await runPhase1Optimize({
          shop,
          admin,
          locationGid,
          config,
          pickupLat,
          pickupLng,
          validOrders,
          flagged,
          start,
        });
        if (phase1Response) return phase1Response;
        // null returned means "phase 1 not appropriate, fall through" (e.g.
        // unknown market or missing credentials).
      } catch (err) {
        console.error(
          `[control:optimize] Phase 1 pipeline failed shop=${shop} — falling back to legacy`,
          err,
        );
      }
    }

    // 4. Cluster orders into routes (legacy path).
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

// ──────────────────────────────────────────────────────────────────────
// Fulfillment + DELIVERED-event helpers (issue #1, blueprint §13.8)
// ──────────────────────────────────────────────────────────────────────

/** Minimal shape we need from the Shopify admin client. */
type ShopifyAdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};

type InspectResult = {
  existingFulfillments: Array<{ id: string; status: string | null; displayStatus: string | null }>;
  openFulfillmentOrders: Array<{ id: string; status: string | null; locationId: string | null }>;
};

type UserError = { field?: unknown; message?: string };
type FulfillmentNode = { id?: string; status?: string | null; displayStatus?: string | null };
type FulfillmentOrderNode = {
  id?: string;
  status?: string | null;
  assignedLocation?: { location?: { id?: string | null } | null } | null;
};

async function inspectOrderForFulfillment(
  admin: ShopifyAdminClient,
  shopifyOrderId: string,
): Promise<InspectResult> {
  const inspect = await admin.graphql(
    `#graphql
      query ControlInspectOrder($id: ID!) {
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
  const json = (await inspect.json()) as {
    data?: {
      order?: {
        fulfillments?: FulfillmentNode[];
        fulfillmentOrders?: { nodes?: FulfillmentOrderNode[] };
      };
    };
  };
  const existingFulfillments = (json?.data?.order?.fulfillments ?? []).map((f) => ({
    id: f.id ?? "",
    status: f?.status ?? null,
    displayStatus: f?.displayStatus ?? null,
  }));
  const openFulfillmentOrders = (json?.data?.order?.fulfillmentOrders?.nodes ?? []).map((n) => ({
    id: n.id ?? "",
    status: n?.status ?? null,
    locationId: n?.assignedLocation?.location?.id ?? null,
  }));
  return { existingFulfillments, openFulfillmentOrders };
}

async function fireFulfillmentEvent(
  admin: ShopifyAdminClient,
  fulfillmentId: string,
  status: "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED",
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const resp = await admin.graphql(
      `#graphql
        mutation ControlFulfillmentEvent($fulfillmentId: ID!, $status: FulfillmentEventStatus!) {
          fulfillmentEventCreate(fulfillmentEvent: { fulfillmentId: $fulfillmentId, status: $status }) {
            fulfillmentEvent { id status }
            userErrors { field message }
          }
        }`,
      { variables: { fulfillmentId, status } },
    );
    const json = (await resp.json()) as {
      data?: { fulfillmentEventCreate?: { userErrors?: UserError[] } };
    };
    const errs = json?.data?.fulfillmentEventCreate?.userErrors ?? [];
    if (errs.length > 0) {
      return {
        ok: false,
        reason: errs.map((e) => e.message ?? "unknown").join("; "),
      };
    }
    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function readFulfillmentDisplayStatus(
  admin: ShopifyAdminClient,
  fulfillmentId: string,
): Promise<string | null> {
  try {
    const resp = await admin.graphql(
      `#graphql
        query ControlReadFulfillment($id: ID!) {
          fulfillment(id: $id) { id status displayStatus }
        }`,
      { variables: { id: fulfillmentId } },
    );
    const json = (await resp.json()) as {
      data?: { fulfillment?: { displayStatus?: string | null } };
    };
    return json?.data?.fulfillment?.displayStatus ?? null;
  } catch {
    return null;
  }
}

/**
 * Fire a DELIVERED event, then re-query displayStatus. If Shopify hasn't
 * promoted the fulfillment to DELIVERED, run the explicit chain
 *   IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
 * once. Synchronous in the same request — only kicks in on the rare
 * degenerate path where the initial event didn't promote.
 */
async function deliverWithVerification(
  admin: ShopifyAdminClient,
  fulfillmentId: string,
): Promise<{ deliveredEvent: boolean; finalDisplayStatus: string | null; reason: string | null }> {
  const first = await fireFulfillmentEvent(admin, fulfillmentId, "DELIVERED");
  if (!first.ok) {
    return { deliveredEvent: false, finalDisplayStatus: null, reason: first.reason };
  }
  const status1 = await readFulfillmentDisplayStatus(admin, fulfillmentId);
  if (status1 === "DELIVERED") {
    return { deliveredEvent: true, finalDisplayStatus: status1, reason: null };
  }

  // Retry chain — explicit chronology helps when prior event history is empty.
  const inTransit = await fireFulfillmentEvent(admin, fulfillmentId, "IN_TRANSIT");
  const outForDelivery = await fireFulfillmentEvent(admin, fulfillmentId, "OUT_FOR_DELIVERY");
  const deliveredAgain = await fireFulfillmentEvent(admin, fulfillmentId, "DELIVERED");
  const status2 = await readFulfillmentDisplayStatus(admin, fulfillmentId);

  const chainOk = inTransit.ok && outForDelivery.ok && deliveredAgain.ok;
  return {
    deliveredEvent: chainOk,
    finalDisplayStatus: status2,
    reason:
      status2 === "DELIVERED"
        ? null
        : `displayStatus=${status2 ?? "null"} after retry chain`,
  };
}

type FulfillResult = {
  ok: boolean;
  fulfillmentCreated: boolean;
  fulfillmentId: string | null;
  deliveredEventCreated: boolean;
  finalDisplayStatus: string | null;
  alreadyDelivered: boolean;
  reason: string | null;
};

async function fulfillOrderWithVerification(args: {
  admin: ShopifyAdminClient;
  shopifyOrderId: string;
  locationGid: string;
  trackingNumber: string | null;
  notifyCustomer: boolean;
}): Promise<FulfillResult> {
  const { admin, shopifyOrderId, locationGid, trackingNumber, notifyCustomer } = args;
  const inspect = await inspectOrderForFulfillment(admin, shopifyOrderId);

  // Already delivered? — short-circuit, idempotent.
  const alreadyDelivered = inspect.existingFulfillments.some(
    (f) => f.displayStatus === "DELIVERED",
  );
  if (alreadyDelivered) {
    return {
      ok: true,
      fulfillmentCreated: false,
      fulfillmentId: inspect.existingFulfillments.find((f) => f.displayStatus === "DELIVERED")?.id ?? null,
      deliveredEventCreated: false,
      finalDisplayStatus: "DELIVERED",
      alreadyDelivered: true,
      reason: null,
    };
  }

  // Existing non-cancelled fulfillment? — push DELIVERED event on each.
  const reusableFulfillments = inspect.existingFulfillments.filter(
    (f) => f.status && f.status !== "CANCELLED",
  );
  if (reusableFulfillments.length > 0) {
    let lastVerify: { deliveredEvent: boolean; finalDisplayStatus: string | null; reason: string | null } = {
      deliveredEvent: false,
      finalDisplayStatus: null,
      reason: "no fulfillments processed",
    };
    for (const f of reusableFulfillments) {
      lastVerify = await deliverWithVerification(admin, f.id);
    }
    const lastFulfillmentId = reusableFulfillments[reusableFulfillments.length - 1]!.id;
    return {
      ok: lastVerify.finalDisplayStatus === "DELIVERED",
      fulfillmentCreated: false,
      fulfillmentId: lastFulfillmentId,
      deliveredEventCreated: lastVerify.deliveredEvent,
      finalDisplayStatus: lastVerify.finalDisplayStatus,
      alreadyDelivered: false,
      reason: lastVerify.reason,
    };
  }

  // No existing fulfillment — create one against open fulfillment orders at this location.
  const openFOs = inspect.openFulfillmentOrders.filter(
    (n) => (n.status === "OPEN" || n.status === "IN_PROGRESS") && n.locationId === locationGid,
  );
  if (openFOs.length === 0) {
    return {
      ok: false,
      fulfillmentCreated: false,
      fulfillmentId: null,
      deliveredEventCreated: false,
      finalDisplayStatus: null,
      alreadyDelivered: false,
      reason: "no fulfillments and no open fulfillment orders at this location",
    };
  }

  const createResp = await admin.graphql(
    `#graphql
      mutation ControlFulfillCreate($fulfillment: FulfillmentV2Input!) {
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
          trackingInfo: trackingNumber ? { company: "Lalamove", number: trackingNumber } : undefined,
        },
      },
    },
  );
  const createJson = (await createResp.json()) as {
    data?: {
      fulfillmentCreateV2?: {
        fulfillment?: { id?: string | null };
        userErrors?: UserError[];
      };
    };
  };
  const userErrors = createJson?.data?.fulfillmentCreateV2?.userErrors ?? [];
  const fulfillmentId = createJson?.data?.fulfillmentCreateV2?.fulfillment?.id ?? null;
  if (userErrors.length > 0) {
    return {
      ok: false,
      fulfillmentCreated: false,
      fulfillmentId: null,
      deliveredEventCreated: false,
      finalDisplayStatus: null,
      alreadyDelivered: false,
      reason: userErrors.map((e) => e.message ?? "unknown").join("; "),
    };
  }
  if (!fulfillmentId) {
    return {
      ok: false,
      fulfillmentCreated: false,
      fulfillmentId: null,
      deliveredEventCreated: false,
      finalDisplayStatus: null,
      alreadyDelivered: false,
      reason: "no fulfillment returned",
    };
  }

  const verify = await deliverWithVerification(admin, fulfillmentId);
  return {
    ok: verify.finalDisplayStatus === "DELIVERED",
    fulfillmentCreated: true,
    fulfillmentId,
    deliveredEventCreated: verify.deliveredEvent,
    finalDisplayStatus: verify.finalDisplayStatus,
    alreadyDelivered: false,
    reason: verify.reason,
  };
}

async function tagOrderForRedelivery(
  admin: ShopifyAdminClient,
  shopifyOrderId: string,
): Promise<{ ok: boolean; reason: string | null }> {
  try {
    const resp = await admin.graphql(
      `#graphql
        mutation ControlTagRedelivery($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) {
            userErrors { field message }
          }
        }`,
      { variables: { id: shopifyOrderId, tags: [REDELIVERY_TAG] } },
    );
    const json = (await resp.json()) as {
      data?: { tagsAdd?: { userErrors?: UserError[] } };
    };
    const errs = json?.data?.tagsAdd?.userErrors ?? [];
    if (errs.length > 0) {
      return { ok: false, reason: errs.map((e) => e.message ?? "unknown").join("; ") };
    }
    return { ok: true, reason: null };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function persistBucketingResults(args: {
  shop: string;
  jobId: string;
  bucket: RouteBucket;
  partialDelivery: boolean;
  summary: StopSummary[];
}): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the file-wide pattern for Prisma untyped models
  const prismaAny = prisma as any;
  try {
    await prismaAny.lalamoveDispatchJob.update({
      where: { id: args.jobId },
      data: {
        podBucket: args.bucket,
        partialDelivery: args.partialDelivery,
        lastBucketingAt: new Date(),
      },
    });
    for (const stop of args.summary) {
      if (!stop.orderId) continue;
      await prismaAny.lalamoveDispatchOrderMap.updateMany({
        where: { shop: args.shop, dispatchJobId: args.jobId, shopifyOrderId: stop.orderId },
        data: {
          stopOutcome: stop.outcome,
          stopFailureReason: stop.failureReason,
        },
      });
    }
  } catch (err) {
    console.warn(`[control] persist bucketing FAILED job=${args.jobId}`, err);
  }
}

async function handleMarkDelivered(shop: string, body: Record<string, unknown>): Promise<Response> {
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : null;
  const routeIndexRaw = body.routeIndex;
  const cancelPendingLalamove = body.cancelPendingLalamove !== false; // default true
  const createShopifyFulfillment = body.createShopifyFulfillment !== false; // default true
  const archiveTags = body.archiveTags !== false; // default true — Phase B flows pass false
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

    // 3. Load order maps + ordersData snapshot for stop-to-order matching.
    const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
      where: { shop, dispatchJobId: job.id },
      select: {
        shopifyOrderId: true,
        currentStatus: true,
        failureReason: true,
      },
    });
    const orderIds = (orderMaps as Array<{ shopifyOrderId: string }>).map((m) => m.shopifyOrderId);
    const ordersData: DispatchOrderSnapshot[] = Array.isArray(job.ordersData)
      ? (job.ordersData as DispatchOrderSnapshot[])
      : [];

    // 4. Fetch live Lalamove stops + POD (best-effort; bucketing tolerates empty).
    let lalamoveStops: LalamoveStop[] = [];
    try {
      const credentials = await getRuntimeCredentialsForShop(shop);
      if (credentials && job.lalamoveOrderId) {
        const details = await getLalamoveOrderDetails(job.market, job.lalamoveOrderId, credentials);
        lalamoveStops = (details.stops ?? []) as LalamoveStop[];
      }
    } catch (err) {
      console.warn(
        `[control] mark-delivered: stop fetch failed lalamove=${job.lalamoveOrderId}`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // 5. Bucket the route per per-stop POD outcomes.
    const summary = summarizeRoutePOD(
      lalamoveStops,
      ordersData,
      orderMaps as DispatchOrderMapRow[],
    );
    const decision = bucketRouteForFulfillment(summary);

    console.info(
      `[control] mark-delivered bucket=${decision.bucket} shop=${shop} route=${routeId} stops=${lalamoveStops.length} fulfill=${decision.ordersToFulfill.length} redeliver=${decision.ordersToRedeliver.length} unmatched=${decision.unmatchedStopIndexes.length}`,
    );

    const isoBrt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(job.requestedAt));
    const [yy, mm, dd] = isoBrt.split("-");
    const dateStr = `${yy!.slice(-2)}.${mm}.${dd}`;

    const { admin } = await unauthenticated.admin(shop);

    // 6. Held / skip — persist bucket and bail out before any Shopify writes.
    if (decision.bucket === "held") {
      await persistBucketingResults({
        shop,
        jobId: job.id,
        bucket: decision.bucket,
        partialDelivery: false,
        summary,
      });
      console.info(
        `[control] mark-delivered HOLD shop=${shop} route=${routeId} pending=${
          summary.filter((s) => !s.isPickup && s.outcome === "PENDING").length
        } unmatched=${decision.unmatchedStopIndexes.length}`,
      );
      return jsonResponse({
        ok: false,
        status: "held",
        bucket: decision.bucket,
        routeId,
        jobId: job.id,
        retryAfter: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        summary,
        unmatchedStopIndexes: decision.unmatchedStopIndexes,
        lalamove: lalamoveCancelNote,
      });
    }

    if (decision.bucket === "skip") {
      await persistBucketingResults({
        shop,
        jobId: job.id,
        bucket: decision.bucket,
        partialDelivery: false,
        summary,
      });
      console.info(
        `[control] mark-delivered SKIP shop=${shop} route=${routeId} reason=no-delivered-stops`,
      );
      return jsonResponse({
        ok: false,
        status: "manual-review",
        bucket: decision.bucket,
        routeId,
        jobId: job.id,
        summary,
        unmatchedStopIndexes: decision.unmatchedStopIndexes,
        lalamove: lalamoveCancelNote,
      });
    }

    // 7. Clean / mixed — archive tags + mark DB job FULFILLED.
    let archived = 0;
    let archiveFailures = 0;
    if (archiveTags) {
      const archiveResults = await Promise.allSettled(
        orderIds.map((id) => renameRouteTagsToArchive(admin, id, dateStr)),
      );
      archived = archiveResults.filter((r) => r.status === "fulfilled").length;
      archiveFailures = archiveResults.length - archived;
      if (archiveFailures > 0) {
        console.warn(`[control] mark-delivered: ${archiveFailures} tag-archive failures (non-fatal)`);
      }
    }

    await prismaAny.lalamoveDispatchJob.update({
      where: { id: job.id },
      data: { status: "FULFILLED" },
    });
    await prismaAny.lalamoveDispatchOrderMap.updateMany({
      where: { shop, dispatchJobId: job.id },
      data: { currentStatus: "delivered" },
    });

    // 8. Fulfill DELIVERED stops only. shopifyFulfilled increments only on
    //    full success (fulfillment AND DELIVERED-event AND displayStatus
    //    promoted). deliveredEventsCreated tracks the inner half.
    let shopifyFulfilled = 0;
    let deliveredEventsCreated = 0;
    const fulfillmentFailures: Array<{ orderId: string; reason: string }> = [];
    const trackingNumber = (job.lalamoveOrderId ?? null) as string | null;

    if (createShopifyFulfillment) {
      // FAILED stops are not in ordersToFulfill (the Yasmin protection),
      // so the only customers reachable here are DELIVERED ones. They get
      // the caller's notifyCustomer preference regardless of bucket — a
      // mixed route's clean stops still deserve their delivered email.
      const effectiveNotify = notifyCustomer;

      for (const shopifyOrderId of decision.ordersToFulfill) {
        try {
          const result = await fulfillOrderWithVerification({
            admin,
            shopifyOrderId,
            locationGid,
            trackingNumber,
            notifyCustomer: effectiveNotify,
          });
          if (result.deliveredEventCreated) deliveredEventsCreated += 1;
          if (result.ok) {
            shopifyFulfilled += 1;
          } else {
            fulfillmentFailures.push({
              orderId: shopifyOrderId,
              reason: result.reason ?? `displayStatus=${result.finalDisplayStatus ?? "null"}`,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          fulfillmentFailures.push({ orderId: shopifyOrderId, reason: msg.slice(0, 150) });
          console.warn(
            `[control] mark-delivered order-loop exception order=${shopifyOrderId}`,
            msg,
          );
        }
      }
    }

    // 9. Tag FAILED stops for re-delivery; never email these customers.
    let redeliveryTagged = 0;
    const redeliveryTagFailures: Array<{ orderId: string; reason: string }> = [];
    for (const shopifyOrderId of decision.ordersToRedeliver) {
      const tagResult = await tagOrderForRedelivery(admin, shopifyOrderId);
      if (tagResult.ok) {
        redeliveryTagged += 1;
      } else {
        redeliveryTagFailures.push({
          orderId: shopifyOrderId,
          reason: tagResult.reason ?? "tag failed",
        });
      }
    }

    // 10. Persist bucketing results + partialDelivery flag.
    const partialDelivery = shopifyFulfilled !== deliveredEventsCreated;
    await persistBucketingResults({
      shop,
      jobId: job.id,
      bucket: decision.bucket,
      partialDelivery,
      summary,
    });

    console.info(
      `[control] mark-delivered OK shop=${shop} route=${routeId} job=${job.id} bucket=${decision.bucket} orders=${orderIds.length} archived=${archived} lalamove=${lalamoveCancelNote} shopifyFulfilled=${shopifyFulfilled}/${decision.ordersToFulfill.length} delivered=${deliveredEventsCreated} redeliveryTagged=${redeliveryTagged} partial=${partialDelivery}`,
    );

    return jsonResponse({
      ok: true,
      bucket: decision.bucket,
      partialDelivery,
      routeId,
      jobId: job.id,
      lalamoveOrderId: job.lalamoveOrderId,
      ordersDelivered: decision.ordersToFulfill.length,
      ordersFlaggedForRedelivery: decision.ordersToRedeliver,
      tagsArchivedOn: `${dateStr} (YY.MM.DD)`,
      archiveFailures,
      lalamove: lalamoveCancelNote,
      shopifyFulfilled,
      deliveredEventsCreated,
      redeliveryTagged,
      redeliveryTagFailures,
      fulfillmentFailures,
      summary,
      unmatchedStopIndexes: decision.unmatchedStopIndexes,
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
// POST /api/control/mark-stop-delivered — surgical single-order fulfill.
// Solves the Beatriz #77793 case: an order physically delivered but stuck
// UNFULFILLED in Shopify, with no path through route-level mark-delivered.
//
// Body: { orderId: string, dispatchJobId?: string, locationId?: string,
//         notifyCustomer?: boolean = true, force?: boolean = false }
// Idempotent: if displayStatus === "DELIVERED" already, no-op (or fire
// the notification only when notifyCustomer && force, never re-create
// the fulfillment).
// ──────────────────────────────────────────────────────────────────────

async function handleMarkStopDelivered(
  shop: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const orderId = typeof body.orderId === "string" ? body.orderId : null;
  const dispatchJobId = typeof body.dispatchJobId === "string" ? body.dispatchJobId : null;
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : null;
  const notifyCustomer = body.notifyCustomer === false ? false : true; // default ON
  const force = body.force === true;

  if (!orderId) {
    return jsonResponse({ ok: false, error: "orderId required" }, 400);
  }

  console.info(
    `[control] mark-stop-delivered START shop=${shop} order=${orderId} notify=${notifyCustomer} force=${force}`,
  );

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the file-wide pattern for Prisma untyped models
    const prismaAny = prisma as any;

    // Resolve location + tracking number from the dispatch job map (if known).
    let locationGid: string | null = locationIdRaw
      ? normalizeLocationId(locationIdRaw).gid
      : null;
    let trackingNumber: string | null = null;
    let resolvedJobId: string | null = dispatchJobId;

    if (!resolvedJobId || !locationGid) {
      const orderMap = await prismaAny.lalamoveDispatchOrderMap.findFirst({
        where: { shop, shopifyOrderId: orderId },
        orderBy: { updatedAt: "desc" },
      });
      if (orderMap) {
        resolvedJobId = resolvedJobId ?? orderMap.dispatchJobId;
        const job = await prismaAny.lalamoveDispatchJob.findUnique({
          where: { id: orderMap.dispatchJobId },
        });
        if (job) {
          locationGid = locationGid ?? (job.locationId ?? null);
          trackingNumber = job.lalamoveOrderId ?? null;
        }
      }
    } else {
      const job = await prismaAny.lalamoveDispatchJob.findUnique({
        where: { id: resolvedJobId },
      });
      if (job) trackingNumber = job.lalamoveOrderId ?? null;
    }

    if (!locationGid) {
      return jsonResponse(
        { ok: false, error: "locationId could not be resolved (pass locationId or dispatchJobId)" },
        400,
      );
    }

    const { admin } = await unauthenticated.admin(shop);

    // Idempotency check — short-circuit if already DELIVERED at displayStatus.
    const inspect = await inspectOrderForFulfillment(admin, orderId);
    const deliveredFulfillment = inspect.existingFulfillments.find(
      (f) => f.displayStatus === "DELIVERED",
    );

    if (deliveredFulfillment && !force) {
      console.info(
        `[control] mark-stop-delivered ALREADY-DELIVERED shop=${shop} order=${orderId} fulfillment=${deliveredFulfillment.id}`,
      );
      // Persist outcome on the order map so the UI pill reflects DELIVERED.
      if (resolvedJobId) {
        await prismaAny.lalamoveDispatchOrderMap.updateMany({
          where: { shop, dispatchJobId: resolvedJobId, shopifyOrderId: orderId },
          data: { stopOutcome: "DELIVERED", currentStatus: "delivered" },
        }).catch(() => {});
      }
      return jsonResponse({
        ok: true,
        alreadyDelivered: true,
        orderId,
        fulfillmentId: deliveredFulfillment.id,
        displayStatus: "DELIVERED",
        notificationSent: false,
      });
    }

    const result = await fulfillOrderWithVerification({
      admin,
      shopifyOrderId: orderId,
      locationGid,
      trackingNumber,
      notifyCustomer,
    });

    // Sync the order map so UI pills and bucket recompute reflect the new state.
    if (resolvedJobId && result.ok) {
      await prismaAny.lalamoveDispatchOrderMap.updateMany({
        where: { shop, dispatchJobId: resolvedJobId, shopifyOrderId: orderId },
        data: { stopOutcome: "DELIVERED", currentStatus: "delivered" },
      }).catch(() => {});
    }

    console.info(
      `[control] mark-stop-delivered ${result.ok ? "OK" : "FAILED"} shop=${shop} order=${orderId} fulfillmentId=${result.fulfillmentId ?? "null"} created=${result.fulfillmentCreated} delivered=${result.deliveredEventCreated} displayStatus=${result.finalDisplayStatus ?? "null"}`,
    );

    return jsonResponse({
      ok: result.ok,
      alreadyDelivered: result.alreadyDelivered,
      orderId,
      fulfillmentId: result.fulfillmentId,
      fulfillmentCreated: result.fulfillmentCreated,
      deliveredEventCreated: result.deliveredEventCreated,
      displayStatus: result.finalDisplayStatus,
      notificationSent: notifyCustomer && result.fulfillmentCreated,
      reason: result.reason,
    });
  } catch (err) {
    console.error(`[control] mark-stop-delivered FAILED shop=${shop} order=${orderId}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "mark-stop-delivered failed" },
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

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/check-dispatches — poll driver GPS for every in-flight
// dispatch and flag drivers that aren't approaching the pickup.
//
// Rule (4-min cadence, 12-min timeout, matched 4-min grace):
//   - Only evaluates routes in ON_GOING (driver assigned, pre-pickup)
//   - Grace window of 4 min from dispatch requestedAt — no strikes
//   - Arrival zone ≤300 m from pickup — no strikes (driver parking/hunting)
//   - Each poll: haversine distance(driver → pickup)
//       · distance decreased → approachFailCount = 0
//       · distance same/grew → approachFailCount += 1
//   - approachFailCount ≥ 3 → suggested: "reorder"
// Returns per-dispatch telemetry; caller decides whether to fire reorder.
// ──────────────────────────────────────────────────────────────────────

const APPROACH_STRIKE_LIMIT = 3;
const APPROACH_ARRIVAL_RADIUS_M = 300;
const APPROACH_GRACE_MINUTES = 4;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/render-routes — build Google Static Maps URLs per
// active-route location so Claude can Read the PNG and apply spatial
// reasoning the coordinate-math centroid rule misses (water barriers,
// neighborhood gravity, traffic corridors).
// Body: { locationId?: string } — omit to render all active-route locations.
// Returns: { ok, renders: [{ locationId, locationName, url, routeCount, orderCount }] }
// ──────────────────────────────────────────────────────────────────────

// 7 visually-distinct colors for routes rota-01..rota-07 (7-order hard cap
// means we never need more). Hex without the '0x' prefix — Static Maps
// expects '0xRRGGBB' in the marker URL.
const ROUTE_MARKER_COLORS = [
  "0xEF4444", // red
  "0x3B82F6", // blue
  "0x22C55E", // green
  "0xF97316", // orange
  "0xA855F7", // purple
  "0xEAB308", // yellow
  "0x78350F", // brown
];

async function handleRenderRoutes(shop: string, body: Record<string, unknown>): Promise<Response> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return jsonResponse({ ok: false, error: "GOOGLE_MAPS_API_KEY not configured on server." }, 500);
  }
  const locationIdRaw = typeof body.locationId === "string" ? body.locationId : null;

  console.info(`[control] render-routes START shop=${shop} location=${locationIdRaw ?? "all"}`);
  const start = Date.now();

  try {
    // Find all locations that have active-route dispatched orders, OR all
    // location configs the shop has (if we want to render even when no
    // dispatches exist yet — useful right after optimize).
    const locationFilter = locationIdRaw
      ? [normalizeLocationId(locationIdRaw).gid]
      : null;
    const configs = await prisma.lalamoveLocationConfig.findMany({
      where: {
        shop,
        ...(locationFilter ? { locationId: { in: locationFilter } } : {}),
      },
    });
    if (configs.length === 0) {
      return jsonResponse({ ok: false, error: "No Lalamove location configs found for shop." }, 404);
    }

    const { admin } = await unauthenticated.admin(shop);
    const renders: Array<Record<string, unknown>> = [];

    for (const configRow of configs) {
      const locationGid = configRow.locationId;
      const config = configRow.data as any;
      const pickupLat = config.pickupLat;
      const pickupLng = config.pickupLng;
      if (pickupLat == null || pickupLng == null) {
        renders.push({ locationId: locationGid, ok: false, note: "missing pickup coords" });
        continue;
      }

      // Fetch orders with ld_rota-NN tags at this location (per-slot loop)
      const routesPerLocation: Array<{ slot: number; orders: Array<any> }> = [];
      for (let slot = 0; slot < MAX_ROUTE_SLOTS; slot += 1) {
        const tag = routeTagForSlot(slot);
        const resp = await admin.graphql(
          `#graphql
            query ControlRenderRoutesBySlot($query: String!, $first: Int!) {
              orders(first: $first, query: $query, sortKey: ID) {
                nodes {
                  id name
                  shippingAddress { latitude longitude }
                  fulfillmentOrders(first: 5) {
                    nodes { assignedLocation { location { id } } }
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
          return !loc || loc === locationGid;
        });
        if (scoped.length > 0) {
          routesPerLocation.push({ slot, orders: scoped });
        }
      }

      if (routesPerLocation.length === 0) {
        renders.push({ locationId: locationGid, locationName: config.locationName ?? null, ok: true, note: "no active routes", url: null });
        continue;
      }

      // Build Static Maps URL
      // Pickup marker — black "P" mid-size
      const params: string[] = [
        "size=640x640",
        "scale=2", // higher-DPI render (effective 1280x1280) while keeping URL short
        "maptype=roadmap",
        `markers=color:black|label:P|size:mid|${pickupLat},${pickupLng}`,
      ];

      let orderTotal = 0;
      for (const route of routesPerLocation) {
        const color = ROUTE_MARKER_COLORS[route.slot] ?? "0x6B7280";
        const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // one letter per order within route
        const markerPoints: string[] = [];
        route.orders.forEach((o, i) => {
          const lat = o.shippingAddress?.latitude;
          const lng = o.shippingAddress?.longitude;
          if (lat == null || lng == null) return;
          const label = labels[i] ?? "X";
          markerPoints.push(`${lat},${lng}`);
          // One markers= entry per point so we can keep its label distinct
          params.push(`markers=color:${color}|label:${label}|size:small|${lat},${lng}`);
          orderTotal += 1;
        });
      }

      params.push(`key=${encodeURIComponent(apiKey)}`);
      const url = `https://maps.googleapis.com/maps/api/staticmap?${params.join("&")}`;

      renders.push({
        locationId: locationGid,
        locationName: config.locationName ?? null,
        routeCount: routesPerLocation.length,
        orderCount: orderTotal,
        url,
        // Per-route legend the client can echo so the user knows which color = which rota.
        legend: routesPerLocation.map((r) => ({
          tag: routeTagForSlot(r.slot),
          color: ROUTE_MARKER_COLORS[r.slot] ?? "0x6B7280",
          orderCount: r.orders.length,
        })),
      });
    }

    const elapsed = Date.now() - start;
    console.info(
      `[control] render-routes OK shop=${shop} renders=${renders.length} elapsed=${elapsed}ms`,
    );

    return jsonResponse({
      ok: true,
      renders,
      generatedAt: new Date().toISOString(),
      elapsedMs: elapsed,
    });
  } catch (err) {
    console.error(`[control] render-routes FAILED shop=${shop}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "render-routes failed" },
      500,
    );
  }
}

async function handleCheckDispatches(shop: string, _body: Record<string, unknown>): Promise<Response> {
  const prismaAny = prisma as any;
  const credentials = await getRuntimeCredentialsForShop(shop);
  if (!credentials) {
    return jsonResponse({ ok: false, error: "Missing Lalamove credentials." }, 400);
  }

  console.info(`[control] check-dispatches START shop=${shop}`);
  const start = Date.now();

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const jobs = await prismaAny.lalamoveDispatchJob.findMany({
      where: {
        shop,
        requestedAt: { gte: since },
        status: { notIn: Array.from(TERMINAL_DISPATCH_STATUSES) },
        lalamoveOrderId: { not: null },
      },
      orderBy: { requestedAt: "desc" },
    });

    // Load all relevant LalamoveLocationConfig rows once (pickup coords)
    const uniqueLocations = Array.from(new Set((jobs as Array<any>).map((j) => j.locationId)));
    const configByLocation = new Map<string, any>();
    for (const locId of uniqueLocations) {
      const cfg = await prisma.lalamoveLocationConfig.findUnique({
        where: { shop_locationId: { shop, locationId: locId } },
      });
      if (cfg) configByLocation.set(locId, cfg.data);
    }

    const results: Array<Record<string, unknown>> = [];

    for (const job of jobs as Array<any>) {
      let liveStatus = job.status;
      let driverId: string | undefined;

      try {
        const orderDetails = await getLalamoveOrderDetails(job.market, job.lalamoveOrderId, credentials);
        liveStatus = orderDetails.status ?? job.status;
        driverId = orderDetails.driverId;
        if (liveStatus !== job.status) {
          await prismaAny.lalamoveDispatchJob.updateMany({
            where: { shop, lalamoveOrderId: job.lalamoveOrderId },
            data: { status: liveStatus },
          });
          // Phase A auto-close: when a route just transitioned to COMPLETED,
          // archive route tags (ld_rota-NN → ld_rota-NN_YY.MM.DD) so dispatched
          // orders are no longer unassigned. Shopify fulfillment is intentionally
          // NOT created here — that's Phase B, gated on user approval via
          // /api/control/fulfill-route.
          const completed = String(liveStatus).toUpperCase() === "COMPLETED";
          const wasPending = String(job.status ?? "").toUpperCase() !== "COMPLETED";
          if (completed && wasPending) {
            try {
              const orderMaps = await prismaAny.lalamoveDispatchOrderMap.findMany({
                where: { shop, dispatchJobId: job.id },
                select: { shopifyOrderId: true },
              });
              const mapOrderIds = (orderMaps as Array<{ shopifyOrderId: string }>).map(
                (m) => m.shopifyOrderId,
              );
              const isoBrt = new Intl.DateTimeFormat("en-CA", {
                timeZone: "America/Sao_Paulo",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).format(new Date(job.requestedAt));
              const [yy, mm, dd] = isoBrt.split("-");
              const dateStr = `${yy!.slice(-2)}.${mm}.${dd}`;
              const { admin } = await unauthenticated.admin(shop);
              await Promise.allSettled(
                mapOrderIds.map((id) => renameRouteTagsToArchive(admin, id, dateStr)),
              );
              await prismaAny.lalamoveDispatchOrderMap.updateMany({
                where: { shop, dispatchJobId: job.id },
                data: { currentStatus: "delivered" },
              });
              console.info(
                `[control] check-dispatches auto-close route=${job.routeId} orders=${mapOrderIds.length} dateStr=${dateStr}`,
              );
            } catch (closeErr) {
              console.warn(
                `[control] check-dispatches auto-close FAILED route=${job.routeId}`,
                closeErr instanceof Error ? closeErr.message : String(closeErr),
              );
            }
          }
        }
      } catch (err) {
        results.push({
          routeId: job.routeId,
          lalamoveOrderId: job.lalamoveOrderId,
          ok: false,
          note: `order fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      if (liveStatus !== "ON_GOING" || !driverId) {
        results.push({
          routeId: job.routeId,
          lalamoveOrderId: job.lalamoveOrderId,
          status: liveStatus,
          ok: true,
          note: "rule inactive (not ON_GOING with driver)",
        });
        continue;
      }

      const cfg = configByLocation.get(job.locationId) as any;
      const pickupLat = cfg?.pickupLat;
      const pickupLng = cfg?.pickupLng;
      if (pickupLat == null || pickupLng == null) {
        results.push({
          routeId: job.routeId,
          lalamoveOrderId: job.lalamoveOrderId,
          status: liveStatus,
          ok: false,
          note: "missing pickup coords on location config",
        });
        continue;
      }

      let driverDetails: Awaited<ReturnType<typeof getLalamoveDriverDetails>>;
      try {
        driverDetails = await getLalamoveDriverDetails(job.market, job.lalamoveOrderId, driverId, credentials);
      } catch (err) {
        results.push({
          routeId: job.routeId,
          lalamoveOrderId: job.lalamoveOrderId,
          status: liveStatus,
          driverId,
          ok: false,
          note: `driver details fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      const dLat = parseFloat(driverDetails.coordinates?.lat ?? "NaN");
      const dLng = parseFloat(driverDetails.coordinates?.lng ?? "NaN");
      if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) {
        results.push({
          routeId: job.routeId,
          lalamoveOrderId: job.lalamoveOrderId,
          status: liveStatus,
          driverId,
          ok: false,
          note: "driver coordinates unavailable from Lalamove",
        });
        continue;
      }

      const distanceM = haversineMeters(dLat, dLng, Number(pickupLat), Number(pickupLng));
      const minutesSinceRequested = (Date.now() - new Date(job.requestedAt).getTime()) / 60000;
      const inGrace = minutesSinceRequested < APPROACH_GRACE_MINUTES;

      // Arrival zone — don't strike
      if (distanceM <= APPROACH_ARRIVAL_RADIUS_M) {
        await prismaAny.lalamoveDispatchJob.updateMany({
          where: { shop, lalamoveOrderId: job.lalamoveOrderId },
          data: {
            lastDriverLat: dLat,
            lastDriverLng: dLng,
            lastDriverSampledAt: new Date(),
            lastDistanceToPickupM: distanceM,
            approachFailCount: 0,
          },
        });
        results.push({
          routeId: job.routeId,
          lalamoveOrderId: job.lalamoveOrderId,
          status: liveStatus,
          driverId,
          distanceM: Math.round(distanceM),
          approachFailCount: 0,
          ok: true,
          note: "arrival zone",
        });
        continue;
      }

      // First sample — record without strike
      if (job.lastDistanceToPickupM == null) {
        await prismaAny.lalamoveDispatchJob.updateMany({
          where: { shop, lalamoveOrderId: job.lalamoveOrderId },
          data: {
            lastDriverLat: dLat,
            lastDriverLng: dLng,
            lastDriverSampledAt: new Date(),
            lastDistanceToPickupM: distanceM,
            approachFailCount: 0,
          },
        });
        results.push({
          routeId: job.routeId,
          lalamoveOrderId: job.lalamoveOrderId,
          status: liveStatus,
          driverId,
          distanceM: Math.round(distanceM),
          delta: null,
          approachFailCount: 0,
          ok: true,
          note: "first sample",
        });
        continue;
      }

      const delta = distanceM - Number(job.lastDistanceToPickupM);
      const approaching = delta < 0;
      const newFailCount = approaching ? 0 : Number(job.approachFailCount ?? 0) + 1;

      await prismaAny.lalamoveDispatchJob.updateMany({
        where: { shop, lalamoveOrderId: job.lalamoveOrderId },
        data: {
          lastDriverLat: dLat,
          lastDriverLng: dLng,
          lastDriverSampledAt: new Date(),
          lastDistanceToPickupM: distanceM,
          approachFailCount: newFailCount,
        },
      });

      const suggested = !inGrace && newFailCount >= APPROACH_STRIKE_LIMIT ? "reorder" : null;

      results.push({
        routeId: job.routeId,
        lalamoveOrderId: job.lalamoveOrderId,
        status: liveStatus,
        driverId,
        distanceM: Math.round(distanceM),
        deltaM: Math.round(delta),
        approachFailCount: newFailCount,
        inGrace,
        suggested,
        ok: true,
      });
    }

    const elapsed = Date.now() - start;
    console.info(
      `[control] check-dispatches OK shop=${shop} checked=${results.length} suggestions=${results.filter((r) => r.suggested).length} elapsed=${elapsed}ms`,
    );

    return jsonResponse({
      ok: true,
      checkedAt: new Date().toISOString(),
      dispatches: results,
      elapsedMs: elapsed,
    });
  } catch (err) {
    console.error(`[control] check-dispatches FAILED shop=${shop}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "check-dispatches failed" },
      500,
    );
  }
}

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

      const pickupAddressBase = formatPickupStopAddress(
        (config as any).locationName,
        config.locationAddress,
        (config as any).locationDetails,
      ) || (config.locationAddress ?? "").trim();
      const stops = [
        {
          coordinates: { lat: String(pickupLat), lng: String(pickupLng) },
          address: pickupAddressBase,
        },
        ...routeOrders.map((o: any) => {
          const addr = o.shippingAddress;
          const line = [addr.address1, addr.city, addr.province, addr.zip]
            .filter(Boolean)
            .join(", ");
          return {
            coordinates: { lat: String(addr.latitude), lng: String(addr.longitude) },
            address: line,
            sourceAddress2: addr.address2 ?? null,
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

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/post-mortem-list — headless mirror of the post-mortem
// panel list view.
// Body: { period?: "7d" | "30d" | "quarter", locationId?, limit?, reviewedOnly?, unreviewedOnly? }
// Returns recent RouteOptimizationDecision rows scoped to this shop.
// ──────────────────────────────────────────────────────────────────────
async function handlePostMortemList(
  shop: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const periodRaw = typeof body.period === "string" ? body.period : "7d";
  const period: "7d" | "30d" | "quarter" =
    periodRaw === "30d" ? "30d" : periodRaw === "quarter" ? "quarter" : "7d";
  const locationId = typeof body.locationId === "string" ? body.locationId : null;
  const limit =
    typeof body.limit === "number" && body.limit > 0 && body.limit <= 200
      ? body.limit
      : 80;
  const unreviewedOnly = body.unreviewedOnly === true;
  const reviewedOnly = body.reviewedOnly === true;

  const now = Date.now();
  const since = new Date(
    period === "quarter"
      ? now - 92 * 86_400_000
      : period === "30d"
        ? now - 30 * 86_400_000
        : now - 7 * 86_400_000,
  );

  console.info(
    `[control] post-mortem-list START shop=${shop} period=${period} location=${locationId ?? "all"} limit=${limit}`,
  );

  try {
    const prismaAny = prisma as unknown as {
      routeOptimizationDecision: {
        findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
      };
    };
    const where: Record<string, unknown> = { shop, createdAt: { gte: since } };
    if (locationId) where.locationId = locationId;
    if (unreviewedOnly) where.operatorReviewed = false;
    if (reviewedOnly) where.operatorReviewed = true;

    const rows = (await prismaAny.routeOptimizationDecision.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        locationId: true,
        market: true,
        decisionPath: true,
        winningCandidateId: true,
        costSubunits: true,
        costCurrency: true,
        confidence: true,
        rationale: true,
        postMortemFlagsJson: true,
        operatorReviewed: true,
        operatorVerdict: true,
        operatorComment: true,
      },
    })) as Array<{
      id: string;
      createdAt: Date;
      locationId: string;
      market: string;
      decisionPath: string;
      winningCandidateId: string;
      costSubunits: number;
      costCurrency: string;
      confidence: number;
      rationale: string;
      postMortemFlagsJson: unknown;
      operatorReviewed: boolean;
      operatorVerdict: string | null;
      operatorComment: string | null;
    }>;

    console.info(`[control] post-mortem-list OK shop=${shop} rows=${rows.length}`);
    return jsonResponse({
      ok: true,
      period,
      locationId,
      count: rows.length,
      decisions: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        locationId: r.locationId,
        market: r.market,
        decisionPath: r.decisionPath,
        winningCandidateId: r.winningCandidateId,
        cost: { subunits: r.costSubunits, currency: r.costCurrency, display: (r.costSubunits / 100).toFixed(2) },
        confidence: r.confidence,
        rationale: r.rationale,
        postMortemFlags: r.postMortemFlagsJson,
        operatorReviewed: r.operatorReviewed,
        operatorVerdict: r.operatorVerdict,
        operatorComment: r.operatorComment,
      })),
    });
  } catch (err) {
    console.error(`[control] post-mortem-list FAILED shop=${shop}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "post-mortem-list failed" },
      500,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/control/post-mortem-verdict — capture an operator verdict.
// Body: { decisionId, verdict: "correct" | "wrong-call" | "edge-case", comment? }
// Comment is required when verdict is "wrong-call" or "edge-case".
// ──────────────────────────────────────────────────────────────────────
async function handlePostMortemVerdict(
  shop: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const decisionId = typeof body.decisionId === "string" ? body.decisionId : null;
  const verdict = typeof body.verdict === "string" ? body.verdict : null;
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";

  if (!decisionId) {
    return jsonResponse({ ok: false, error: "decisionId required" }, 400);
  }
  if (!verdict || !["correct", "wrong-call", "edge-case"].includes(verdict)) {
    return jsonResponse(
      { ok: false, error: 'verdict must be "correct" | "wrong-call" | "edge-case"' },
      400,
    );
  }
  if ((verdict === "wrong-call" || verdict === "edge-case") && comment.length === 0) {
    return jsonResponse(
      { ok: false, error: `comment required for verdict=${verdict}` },
      400,
    );
  }

  console.info(
    `[control] post-mortem-verdict START shop=${shop} decisionId=${decisionId} verdict=${verdict} commentLen=${comment.length}`,
  );

  try {
    const prismaAny = prisma as unknown as {
      routeOptimizationDecision: {
        findUnique: (args: Record<string, unknown>) => Promise<unknown | null>;
        update: (args: Record<string, unknown>) => Promise<unknown>;
      };
    };

    const existing = (await prismaAny.routeOptimizationDecision.findUnique({
      where: { id: decisionId },
      select: { shop: true },
    })) as null | { shop: string };

    if (!existing) {
      console.warn(`[control] post-mortem-verdict not found decisionId=${decisionId}`);
      return jsonResponse({ ok: false, error: "decision not found" }, 404);
    }
    if (existing.shop !== shop) {
      console.warn(
        `[control] post-mortem-verdict wrong shop decisionId=${decisionId} expected=${shop} actual=${existing.shop}`,
      );
      return jsonResponse({ ok: false, error: "decision belongs to a different shop" }, 403);
    }

    await prismaAny.routeOptimizationDecision.update({
      where: { id: decisionId },
      data: {
        operatorReviewed: true,
        operatorVerdict: verdict,
        operatorComment: comment.length > 0 ? comment : null,
      },
    });

    console.info(`[control] post-mortem-verdict OK shop=${shop} decisionId=${decisionId} verdict=${verdict}`);
    return jsonResponse({
      ok: true,
      decisionId,
      verdict,
      commentSaved: comment.length > 0,
    });
  } catch (err) {
    console.error(`[control] post-mortem-verdict FAILED shop=${shop} decisionId=${decisionId}`, err);
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "post-mortem-verdict failed" },
      500,
    );
  }
}
