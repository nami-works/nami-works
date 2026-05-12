import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import type { LalamoveConfig } from "../services/carrier/lalamove-adapter.server";
import type { OptimizerOrderInput } from "../services/google-routes-shared.server";
import { clusterOrders } from "../services/carrier-quotation-optimizer.server";
import {
  isPhase1EnabledForLocation,
  runRouteOptimizationPipeline,
  buildPhase1PipelineInput,
} from "../services/route-optimization/pipeline.server";
import { getRuntimeCredentialsForShop } from "../services/lalamove-credentials.server";
import {
  createLalamoveQuotation,
  placeLalamoveOrder,
  buildLalamoveRecipientRemarks,
  normalizePhoneForMarket,
} from "../services/lalamove.server";
import { addTags } from "../services/lalamove-sync.server";
import { getAllAutoAssignSkipTags } from "../services/lalamove-tags";
import { applyAddressRepairOrTag } from "../services/address-repair.server";
import { resolveConfiguredSpecialRequests } from "../services/lalamove-special-requests.server";

const MAX_ROUTES = 20;
const GQL_BATCH_SIZE = 10;

/**
 * Cron endpoint for automatic local delivery pipeline.
 * Schedule every 5 minutes:
 *   GET /api/cron/auto-delivery
 *   Header: X-Cron-Secret: <CRON_SECRET>
 *
 * Two phases per location:
 * Phase A — Auto-assign: after cutoff + delay, cluster orders into routes
 * Phase B — Auto-dispatch: at dispatch time, quote + place Lalamove orders
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const secret =
    request.headers.get("X-Cron-Secret") ??
    new URL(request.url).searchParams.get("secret");
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.info("[auto-delivery] cron triggered");

  // Find all locations with auto-delivery enabled
  const allConfigs = await prisma.lalamoveLocationConfig.findMany({});
  const autoConfigs = allConfigs.filter((c) => {
    const data = c.data as LalamoveConfig;
    return data.autoDeliveryEnabled === true;
  });

  if (autoConfigs.length === 0) {
    console.info("[auto-delivery] no auto-delivery locations configured");
    return jsonOk({ processed: 0, assigned: 0, dispatched: 0 });
  }

  let totalAssigned = 0;
  let totalDispatched = 0;
  const errors: Array<{ shop: string; locationId: string; phase: string; error: string }> = [];

  for (const configRow of autoConfigs) {
    const config = configRow.data as LalamoveConfig;
    const { shop, locationId } = configRow;
    const tz = config.timezone?.trim() || "America/Sao_Paulo";

    try {
      const { hour, minute } = getLocalTime(tz);
      const currentMinutes = hour * 60 + minute;

      // ── Phase A: Auto-assign ──────────────────────────────────────────
      if (config.orderCutoffTime && config.autoAssignDelayMinutes != null) {
        const [cutoffH, cutoffM] = config.orderCutoffTime.split(":").map(Number);
        if (!isNaN(cutoffH) && !isNaN(cutoffM)) {
          const assignAfter = cutoffH * 60 + cutoffM + (config.autoAssignDelayMinutes ?? 15);
          if (currentMinutes >= assignAfter) {
            const assigned = await runAutoAssign(shop, locationId, config, tz, errors);
            totalAssigned += assigned;
          }
        }
      }

      // ── Phase B: Auto-dispatch ────────────────────────────────────────
      if (config.autoDispatchTime) {
        const [dispH, dispM] = config.autoDispatchTime.split(":").map(Number);
        if (!isNaN(dispH) && !isNaN(dispM)) {
          const dispatchAfter = dispH * 60 + dispM;
          if (currentMinutes >= dispatchAfter) {
            const dispatched = await runAutoDispatch(shop, locationId, config, tz, errors);
            totalDispatched += dispatched;
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[auto-delivery] ERROR shop=${shop} location=${locationId}`, msg);
      errors.push({ shop, locationId, phase: "general", error: msg });
    }
  }

  console.info(
    `[auto-delivery] cron completed locations=${autoConfigs.length} assigned=${totalAssigned} dispatched=${totalDispatched} errors=${errors.length}`,
  );

  return jsonOk({
    processed: autoConfigs.length,
    assigned: totalAssigned,
    dispatched: totalDispatched,
    errors: errors.length > 0 ? errors : undefined,
  });
};

// ── Legacy cluster fallback (Clarke-Wright savings) ──
function runLegacyCluster(
  validOrders: EligibleOrder[],
  locationId: string,
  pickupLat: number,
  pickupLng: number,
): Array<Array<{ orderId: string }>> {
  const optimizerOrders: OptimizerOrderInput[] = validOrders.map((o) => ({
    orderId: o.id,
    locationId,
    shippingCoordinates: { latitude: o.lat, longitude: o.lng },
    locationCoordinates: { latitude: pickupLat, longitude: pickupLng },
  }));
  const routeCount = Math.min(
    MAX_ROUTES,
    Math.max(1, Math.ceil(validOrders.length / 5)),
  );
  const clusters = clusterOrders(optimizerOrders, routeCount, 10);
  return clusters
    .filter((c) => c.length > 0)
    .map((c) => c.map((o) => ({ orderId: o.orderId })));
}

// ── Phase A: Auto-assign ──────────────────────────────────────────────────────

async function runAutoAssign(
  shop: string,
  locationId: string,
  config: LalamoveConfig,
  tz: string,
  errors: Array<{ shop: string; locationId: string; phase: string; error: string }>,
): Promise<number> {
  const startOfDay = getStartOfDayInTimezone(tz);

  // Idempotency: check if routes already exist for today
  const existingRoutes = await prisma.pendingDeliveryRoute.findMany({
    where: { shop, locationId, createdAt: { gte: startOfDay } },
  });
  if (existingRoutes.length > 0) {
    console.info(`[auto-delivery:assign] SKIP shop=${shop} location=${locationId} — routes already exist today (${existingRoutes.length})`);
    return 0;
  }

  // Fetch unassigned LOCAL delivery orders via Shopify GraphQL
  const adminClient = await unauthenticated.admin(shop);
  const orders = await fetchEligibleOrders(adminClient.admin, locationId);
  if (orders.length === 0) {
    console.info(`[auto-delivery:assign] SKIP shop=${shop} location=${locationId} — no eligible orders`);
    return 0;
  }

  // Address validation: exclude orders with issues, then either auto-fix
  // (Track 4 §6.7 deterministic patterns) or tag for human review.
  const validOrders: typeof orders = [];
  for (const order of orders) {
    const validation = validateOrderAddress(order.address1, order.address2);
    if (!validation.isValid) {
      try {
        const outcome = await applyAddressRepairOrTag({
          admin: adminClient.admin,
          shop,
          order: { id: order.id, address1: order.address1, address2: order.address2 },
          noteFallback: `Delivery paused - address needs review: ${validation.issueType ?? "unknown issue"}. Fix in Omnify > Local Delivery.`,
        });
        if (outcome.outcome === "auto-fixed") {
          // Repaired in place — order rejoins the validation queue next cron tick.
          console.info(
            `[auto-delivery:assign] address auto-fixed order=${order.id} pattern=${outcome.pattern} issue=${validation.issueType}`,
          );
        } else {
          console.info(
            `[auto-delivery:assign] address review tagged order=${order.id} issue=${validation.issueType} outcome=${outcome.outcome}`,
          );
        }
      } catch (tagErr) {
        console.warn(`[auto-delivery:assign] failed to tag address review order=${order.id}`, tagErr);
      }
      continue;
    }
    validOrders.push(order);
  }

  if (validOrders.length === 0) {
    console.info(`[auto-delivery:assign] SKIP shop=${shop} location=${locationId} — all orders have address issues`);
    return 0;
  }

  // Get pickup coordinates
  const pickupLat = config.pickupLat;
  const pickupLng = config.pickupLng;
  if (pickupLat == null || pickupLng == null) {
    console.warn(`[auto-delivery:assign] SKIP shop=${shop} location=${locationId} — missing pickup coordinates`);
    errors.push({ shop, locationId, phase: "assign", error: "Missing pickup coordinates" });
    return 0;
  }

  // ── Phase 1: LLM-enabled optimizer (feature-flagged) ──
  // Runs only when BOTH:
  //   - process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED === "true", AND
  //   - LalamoveLocationConfig.data.routeOptimizationPhase1Enabled === true
  // Falls back to legacy clusterOrders on any unrecoverable error.
  let nonEmptyClusters: Array<Array<{ orderId: string }>>;
  if (isPhase1EnabledForLocation(config)) {
    try {
      const pipelineInput = await buildPhase1PipelineInput({
        shop,
        locationId,
        config: {
          market: config.market,
          preferredServiceType: config.preferredServiceType || "LALAGO",
          city: config.city,
          locationName: config.locationName,
        },
        pickupLat,
        pickupLng,
        orders: validOrders.map((o) => ({
          id: o.id,
          name: o.name,
          lat: o.lat,
          lng: o.lng,
        })),
        credentialsResolver: getRuntimeCredentialsForShop,
      });
      if (pipelineInput) {
        const phase1Start = Date.now();
        const result = await runRouteOptimizationPipeline(pipelineInput);
        console.info(
          `[auto-delivery:assign] Phase1 OK shop=${shop} decisionId=${result.decisionId} winner=${result.decision.winningCandidateId} elapsed=${Date.now() - phase1Start}ms`,
        );
        // Convert winningClustering (slot -> orderName[]) back to GID clusters
        nonEmptyClusters = result.winningClustering
          .map((slot) =>
            slot.orderIds
              .map((name) => validOrders.find((o) => o.name === name)?.id)
              .filter((id): id is string => Boolean(id))
              .map((id) => ({ orderId: id })),
          )
          .filter((c) => c.length > 0);
      } else {
        console.warn(`[auto-delivery:assign] Phase1 skipped (unknown market or missing credentials) shop=${shop} city=${config.city ?? "?"} — falling back to legacy`);
        nonEmptyClusters = runLegacyCluster(validOrders, locationId, pickupLat, pickupLng);
      }
    } catch (err) {
      console.error(
        `[auto-delivery:assign] Phase1 FAILED shop=${shop} — falling back to legacy`,
        err,
      );
      nonEmptyClusters = runLegacyCluster(validOrders, locationId, pickupLat, pickupLng);
    }
  } else {
    nonEmptyClusters = runLegacyCluster(validOrders, locationId, pickupLat, pickupLng);
  }

  if (nonEmptyClusters.length === 0) {
    console.warn(`[auto-delivery:assign] SKIP shop=${shop} location=${locationId} — clustering produced no routes`);
    return 0;
  }

  // Create PendingDeliveryRoute records and apply tags
  let assignedCount = 0;
  for (let i = 0; i < nonEmptyClusters.length; i++) {
    const cluster = nonEmptyClusters[i]!;
    const routeId = `${locationId}-${i}`;
    const routeTag = `ld_rota-${String(i + 1).padStart(2, "0")}`;

    const ordersData = cluster.map((o) => {
      const original = validOrders.find((vo) => vo.id === o.orderId)!;
      return {
        shopifyOrderId: o.orderId,
        lat: original.lat,
        lng: original.lng,
        address: original.address,
        name: original.name,
        phone: original.phone,
      };
    });

    // Create PendingDeliveryRoute
    await prisma.pendingDeliveryRoute.create({
      data: {
        shop,
        locationId,
        routeId,
        status: "open",
        ordersData,
      },
    });

    // Apply route tags to orders
    for (const order of cluster) {
      try {
        await addTags(adminClient.admin, order.orderId, [routeTag]);
      } catch (tagErr) {
        console.warn(`[auto-delivery:assign] tag failed order=${order.orderId} tag=${routeTag}`, tagErr);
      }
    }

    assignedCount += cluster.length;
  }

  console.info(
    `[auto-delivery:assign] OK shop=${shop} location=${locationId} routes=${nonEmptyClusters.length} orders=${assignedCount}`,
  );
  return assignedCount;
}

// ── Phase B: Auto-dispatch ────────────────────────────────────────────────────

async function runAutoDispatch(
  shop: string,
  locationId: string,
  config: LalamoveConfig,
  tz: string,
  errors: Array<{ shop: string; locationId: string; phase: string; error: string }>,
): Promise<number> {
  const startOfDay = getStartOfDayInTimezone(tz);

  // Find open (undispatched) routes for this location
  const openRoutes = await prisma.pendingDeliveryRoute.findMany({
    where: { shop, locationId, status: "open" },
  });

  if (openRoutes.length === 0) {
    return 0;
  }

  const credentials = await getRuntimeCredentialsForShop(shop);
  if (!credentials) {
    console.warn(`[auto-delivery:dispatch] SKIP shop=${shop} — no Lalamove credentials`);
    errors.push({ shop, locationId, phase: "dispatch", error: "No Lalamove credentials" });
    return 0;
  }

  const adminClient = await unauthenticated.admin(shop);
  const carrierConfigRow = await prisma.carrierServiceConfig.findUnique({ where: { shop } });
  const carrierConfig = carrierConfigRow?.data as { lalamovePreferredServiceType?: string } | undefined;
  const defaultServiceType = config.preferredServiceType?.trim() || carrierConfig?.lalamovePreferredServiceType?.trim() || "LALAGO";

  // Resolve special requests once per shop+location so every route in this
  // batch forwards the merchant's configured preferences (e.g. WAITING_TIME_030MIN).
  const specialRequests = await resolveConfiguredSpecialRequests(
    shop,
    {
      market: config.market,
      city: config.city ?? null,
      preferredServiceType: defaultServiceType,
    },
    credentials,
  );

  let dispatchedCount = 0;

  for (const route of openRoutes) {
    try {
      // Idempotency: check if already dispatched today
      const existingDispatch = await prisma.lalamoveDispatchJob.findFirst({
        where: {
          shop,
          locationId,
          routeId: route.routeId,
          requestedAt: { gte: startOfDay },
          status: { notIn: ["cancelled", "CANCELLED", "CANCELED", "failed", "FAILED", "REJECTED", "rejected", "EXPIRED", "expired", "EXPIRED_CUTOFF"] },
        },
      });
      if (existingDispatch) {
        console.info(`[auto-delivery:dispatch] SKIP route=${route.routeId} — already dispatched today`);
        continue;
      }

      const ordersData = route.ordersData as Array<{
        shopifyOrderId: string;
        lat: number;
        lng: number;
        address: string;
        name: string;
        phone: string;
      }>;

      if (ordersData.length === 0) continue;

      const pickupLat = config.pickupLat;
      const pickupLng = config.pickupLng;
      if (pickupLat == null || pickupLng == null) {
        errors.push({ shop, locationId, phase: "dispatch", error: `Missing pickup coords for route ${route.routeId}` });
        continue;
      }

      // Build quotation stops: pickup + delivery stops
      const pickupAddress = config.locationAddress?.trim() || "";
      const stops = [
        { coordinates: { lat: String(pickupLat), lng: String(pickupLng) }, address: pickupAddress },
        ...ordersData.map((o) => ({
          coordinates: { lat: String(o.lat), lng: String(o.lng) },
          address: o.address,
        })),
      ];

      // Create quotation
      const quotation = await createLalamoveQuotation(
        {
          market: config.market,
          language: config.language,
          serviceType: defaultServiceType,
          stops,
          isRouteOptimized: stops.length >= 3,
          ...(specialRequests.length > 0 ? { specialRequests } : {}),
        },
        credentials,
      );

      const stopIds = (quotation.stops ?? []).map((s) => s.stopId).filter(Boolean) as string[];
      if (stopIds.length < 2) {
        errors.push({ shop, locationId, phase: "dispatch", error: `Quotation returned <2 stops for route ${route.routeId}` });
        continue;
      }

      // Build recipients — resolve phones from order data
      const senderStopId = stopIds[0]!;
      const recipientStopIds = stopIds.slice(1);

      // Map stops back to orders (handle route optimization reordering)
      const assignmentOrderIds = resolveStopToOrderMapping(
        ordersData,
        (quotation.stops ?? []).slice(1),
      );

      // Fetch fresh customer phone data
      const orderContactMap = await fetchOrderContacts(adminClient.admin, assignmentOrderIds);

      const pickupInstructions = config.pickupInstructions?.trim();
      const recipients = recipientStopIds.map((stopId, index) => {
        const orderId = assignmentOrderIds[index]!;
        const contact = orderContactMap.get(orderId);
        const remarks = buildLalamoveRecipientRemarks(index, pickupInstructions, null);
        return {
          stopId,
          name: contact?.name || "Customer",
          phone: (() => {
            const candidates = [
              contact?.defaultPhone,
              contact?.shippingPhone,
              contact?.customerPhone,
            ];
            for (const c of candidates) {
              const normalized = normalizePhoneForMarket(c, config.market);
              if (normalized) return normalized;
            }
            return config.locationPhone || "";
          })(),
          ...(remarks ? { remarks } : {}),
        };
      });

      // Place order
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
          metadata: { shop },
        },
        credentials,
      );

      // Build snapshot of order stops — reorder/escalation rebuilds the quotation from this.
      const orderedStopsSnapshot = assignmentOrderIds.map((orderId) => {
        const original = ordersData.find((o) => o.shopifyOrderId === orderId)!;
        return {
          shopifyOrderId: original.shopifyOrderId,
          lat: original.lat,
          lng: original.lng,
          address: original.address,
          name: original.name,
          phone: original.phone,
        };
      });

      // Create DB records
      const dispatchJob = await prisma.lalamoveDispatchJob.create({
        data: {
          shop,
          routeId: route.routeId,
          locationId,
          status: placeResponse.status,
          quotationId: quotation.quotationId,
          lalamoveOrderId: placeResponse.orderId,
          market: config.market,
          serviceType: defaultServiceType,
          requestedBy: "auto-delivery-cron",
          quotationTotal: quotation.priceBreakdown?.total ?? null,
          quotationCurrency: quotation.priceBreakdown?.currency ?? null,
          ordersData: orderedStopsSnapshot,
        },
      });

      // Create order maps
      for (const orderId of assignmentOrderIds) {
        await prisma.lalamoveDispatchOrderMap.create({
          data: {
            shop,
            dispatchJobId: dispatchJob.id,
            shopifyOrderId: orderId,
            lalamoveOrderId: placeResponse.orderId,
            currentStatus: placeResponse.status,
          },
        });
      }

      // Mark route as dispatched
      await prisma.pendingDeliveryRoute.update({
        where: { id: route.id },
        data: { status: "dispatched" },
      });

      dispatchedCount += assignmentOrderIds.length;
      console.info(
        `[auto-delivery:dispatch] OK route=${route.routeId} lalamoveOrder=${placeResponse.orderId} orders=${assignmentOrderIds.length} total=${quotation.priceBreakdown?.total ?? "?"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[auto-delivery:dispatch] FAILED route=${route.routeId} shop=${shop}`, msg);
      errors.push({ shop, locationId, phase: "dispatch", error: `Route ${route.routeId}: ${msg}` });
    }
  }

  return dispatchedCount;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocalTime(tz: string): { hour: number; minute: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute };
}

function getStartOfDayInTimezone(tz: string): Date {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now); // "YYYY-MM-DD"
  return new Date(`${dateStr}T00:00:00`);
}

function jsonOk(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Order fetching ────────────────────────────────────────────────────────────

type EligibleOrder = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string;
  address1: string;
  address2: string;
  name_customer: string;
  phone: string;
};

async function fetchEligibleOrders(
  admin: { graphql: (q: string, o?: { variables?: Record<string, unknown> }) => Promise<Response> },
  locationId: string,
): Promise<EligibleOrder[]> {
  // Convert GID to legacy ID for search filter
  const legacyId = locationId.replace("gid://shopify/Location/", "");
  const query = `fulfillment_location_id:${legacyId} fulfillment_status:unshipped status:open`;

  let cursor: string | null = null;
  const allOrders: EligibleOrder[] = [];
  const seenIds = new Set<string>();

  for (let page = 0; page < 10; page++) {
    const res = await admin.graphql(
      `#graphql
        query AutoDeliveryOrders($query: String!, $first: Int!, $after: String) {
          orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT) {
            edges {
              cursor
              node {
                id
                name
                tags
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
                  displayName
                  phone
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
    const edges = json?.data?.orders?.edges ?? [];
    const hasNextPage = json?.data?.orders?.pageInfo?.hasNextPage ?? false;

    for (const edge of edges) {
      const order = edge.node;
      if (!order?.id || seenIds.has(order.id)) continue;
      seenIds.add(order.id);

      // Skip orders already assigned to a route
      const tags: string[] = order.tags ?? [];
      if (tags.some((t: string) => /^ld_rota-\d+$/i.test(t))) continue;

      // Skip orders carrying any operator tag that excludes auto-assignment.
      // Includes:
      //   - ld_address-confirm: address validation flagged the shipping address
      //   - ld_number-confirm: duplicated-number heuristic flagged the recipient phone
      //   - ld_failed-delivery (operator) and "Failed delivery" (state-machine):
      //     failed delivery, operator must resolve manually
      const skipTags = getAllAutoAssignSkipTags();
      const matchedSkip = tags.find((t: string) => skipTags.includes(t));
      if (matchedSkip) {
        console.info(`[auto-delivery] skip orderId=${order.id} reason=${matchedSkip}`);
        continue;
      }

      // Verify LOCAL delivery method
      type FulfillmentOrderNode = {
        deliveryMethod?: { methodType?: string | null } | null;
        assignedLocation?: { location?: { id?: string | null } | null } | null;
      };
      const fulfillmentOrders: FulfillmentOrderNode[] = order.fulfillmentOrders?.nodes ?? [];
      const isLocal = fulfillmentOrders.some(
        (fo) =>
          fo?.deliveryMethod?.methodType === "LOCAL" &&
          fo?.assignedLocation?.location?.id === locationId,
      );
      if (!isLocal) continue;

      // Require coordinates
      const addr = order.shippingAddress;
      if (!addr?.latitude || !addr?.longitude) continue;

      allOrders.push({
        id: order.id,
        name: order.name ?? "",
        lat: Number(addr.latitude),
        lng: Number(addr.longitude),
        address: [addr.address1, addr.city, addr.province, addr.country].filter(Boolean).join(", "),
        address1: addr.address1 ?? "",
        address2: addr.address2 ?? "",
        name_customer: order.customer?.displayName ?? order.name ?? "Customer",
        phone: order.customer?.defaultPhoneNumber?.phoneNumber ?? addr.phone ?? order.customer?.phone ?? "",
      });
    }

    if (!hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  return allOrders;
}

// ── Address validation (simplified from local-delivery validateAddress) ──────

function validateOrderAddress(
  address1: string | null | undefined,
  address2: string | null | undefined,
): { isValid: boolean; issueType: string | null } {
  const line1 = (address1 ?? "").trim();
  if (!line1) return { isValid: true, issueType: null };

  // Check for apartment/unit in address1
  const aptPatterns = /\b(apt|apto|apartment|unit|suite|ste|sala|bloco|bl|andar|casa)\b\.?\s*\d*/i;
  if (aptPatterns.test(line1) && !(address2 ?? "").trim()) {
    return { isValid: false, issueType: "apartment_in_address1" };
  }

  // Check for duplicate numbers
  const numbers = line1.match(/\d+/g) ?? [];
  if (numbers.length >= 3) {
    return { isValid: false, issueType: "multiple_numbers_in_address1" };
  }

  return { isValid: true, issueType: null };
}

// ── Stop-to-order mapping (handles route optimization reordering) ────────────

function resolveStopToOrderMapping(
  ordersData: Array<{ shopifyOrderId: string; lat: number; lng: number }>,
  responseStops: Array<{ coordinates?: { lat?: string; lng?: string } }>,
): string[] {
  // Simple nearest-match mapping
  const remaining = new Set(ordersData.map((o) => o.shopifyOrderId));
  const result: string[] = [];

  for (const stop of responseStops) {
    const lat = parseFloat(stop.coordinates?.lat ?? "0");
    const lng = parseFloat(stop.coordinates?.lng ?? "0");

    let best: { id: string; dist: number } | null = null;
    for (const orderId of remaining) {
      const order = ordersData.find((o) => o.shopifyOrderId === orderId)!;
      const dist = Math.hypot(lat - order.lat, lng - order.lng);
      if (!best || dist < best.dist) {
        best = { id: orderId, dist };
      }
    }

    if (best) {
      remaining.delete(best.id);
      result.push(best.id);
    }
  }

  // If mapping couldn't resolve all, fall back to original order
  if (result.length < ordersData.length) {
    for (const o of ordersData) {
      if (!result.includes(o.shopifyOrderId)) {
        result.push(o.shopifyOrderId);
      }
    }
  }

  return result;
}

// ── Contact fetching ──────────────────────────────────────────────────────────

type OrderContact = {
  name: string;
  defaultPhone: string | null;
  shippingPhone: string | null;
  customerPhone: string | null;
};

async function fetchOrderContacts(
  admin: { graphql: (q: string, o?: { variables?: Record<string, unknown> }) => Promise<Response> },
  orderIds: string[],
): Promise<Map<string, OrderContact>> {
  const result = new Map<string, OrderContact>();
  if (orderIds.length === 0) return result;

  // Batch in groups of 10
  for (let i = 0; i < orderIds.length; i += GQL_BATCH_SIZE) {
    const batch = orderIds.slice(i, i + GQL_BATCH_SIZE);
    try {
      const res = await admin.graphql(
        `#graphql
          query AutoDeliveryContacts($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Order {
                id
                name
                shippingAddress { phone address2 }
                customer {
                  displayName
                  phone
                  defaultPhoneNumber { phoneNumber }
                }
              }
            }
          }`,
        { variables: { ids: batch } },
      );
      const json = await res.json();
      const nodes = (json?.data?.nodes ?? []) as Array<{
        id: string;
        name?: string;
        shippingAddress?: { phone?: string | null; address2?: string | null } | null;
        customer?: {
          displayName?: string | null;
          phone?: string | null;
          defaultPhoneNumber?: { phoneNumber?: string } | null;
        } | null;
      }>;

      for (const node of nodes) {
        if (!node?.id) continue;
        result.set(node.id, {
          name: node.customer?.displayName || node.name || "Customer",
          defaultPhone: node.customer?.defaultPhoneNumber?.phoneNumber ?? null,
          shippingPhone: node.shippingAddress?.phone ?? null,
          customerPhone: node.customer?.phone ?? null,
        });
      }
    } catch (err) {
      console.warn(`[auto-delivery:dispatch] contact fetch failed batch`, err);
    }
  }

  return result;
}
