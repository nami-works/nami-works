/**
 * Unit tests for pod-bucketing.server.ts.
 *
 * Run: npx tsx --test app/services/__tests__/pod-bucketing.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  summarizeRoutePOD,
  bucketRouteForFulfillment,
  type LalamoveStop,
  type DispatchOrderSnapshot,
  type DispatchOrderMapRow,
} from "../pod-bucketing.server";

// classifyPodStatus is internal; exercise it through summarizeRoutePOD which
// owns the per-stop classification pipeline.

const PICKUP_STOP: LalamoveStop = {
  stopId: "pickup",
  address: "Pickup location",
  name: "Sender",
  phone: "+5511999999999",
};

const DELIVERY_NAME = "Karla Mialaret";
const DELIVERY_PHONE = "+5581996637018";

function makeDeliveryStop(podStatus: string): LalamoveStop {
  return {
    stopId: "delivery-1",
    address: "Rua Domingos Bastos 227, Apto 602",
    name: DELIVERY_NAME,
    phone: DELIVERY_PHONE,
    POD: { status: podStatus, deliveredAt: "2026-05-13T20:58:40Z" },
  };
}

const ORDERS_DATA: DispatchOrderSnapshot[] = [
  {
    shopifyOrderId: "gid://shopify/Order/7222391898432",
    lat: -8.122,
    lng: -34.901,
    address: "Rua Domingos Bastos 227, Apto 602",
    name: DELIVERY_NAME,
    phone: DELIVERY_PHONE,
  },
];

const EMPTY_MAPS: DispatchOrderMapRow[] = [];

test("SIGNED POD status classifies as DELIVERED (2026-05-13 Recife regression)", () => {
  const summary = summarizeRoutePOD(
    [PICKUP_STOP, makeDeliveryStop("SIGNED")],
    ORDERS_DATA,
    EMPTY_MAPS,
  );
  const deliveryStop = summary.find((s) => !s.isPickup);
  assert.ok(deliveryStop, "expected one delivery stop in summary");
  assert.equal(deliveryStop!.outcome, "DELIVERED");
  assert.equal(deliveryStop!.failureReason, null);
  assert.equal(deliveryStop!.orderId, "gid://shopify/Order/7222391898432");

  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "clean");
  assert.deepEqual(decision.ordersToFulfill, ["gid://shopify/Order/7222391898432"]);
});

test("DELIVERED / COMPLETED / SUCCESS / SIGNED all classify as DELIVERED", () => {
  for (const podStatus of ["DELIVERED", "COMPLETED", "SUCCESS", "SIGNED"]) {
    const summary = summarizeRoutePOD(
      [PICKUP_STOP, makeDeliveryStop(podStatus)],
      ORDERS_DATA,
      EMPTY_MAPS,
    );
    const deliveryStop = summary.find((s) => !s.isPickup);
    assert.equal(deliveryStop?.outcome, "DELIVERED", `expected DELIVERED for POD.status=${podStatus}`);
  }
});

test("FAILED / FAIL / REJECTED classify as FAILED", () => {
  for (const podStatus of ["FAILED", "FAIL", "REJECTED"]) {
    const summary = summarizeRoutePOD(
      [PICKUP_STOP, makeDeliveryStop(podStatus)],
      ORDERS_DATA,
      EMPTY_MAPS,
    );
    const deliveryStop = summary.find((s) => !s.isPickup);
    assert.equal(deliveryStop?.outcome, "FAILED", `expected FAILED for POD.status=${podStatus}`);
  }
});

test("unknown POD status with no fallback → UNKNOWN (bucket=needs-review)", () => {
  const summary = summarizeRoutePOD(
    [PICKUP_STOP, makeDeliveryStop("WAITING_FOR_SIGNATURE")],
    ORDERS_DATA,
    EMPTY_MAPS,
  );
  const deliveryStop = summary.find((s) => !s.isPickup);
  // Watchdog refactor 2026-05-16: a non-empty POD.status we don't classify
  // now bubbles up as UNKNOWN so the route flips to needs-review for human
  // validation. Old behaviour (MISSING → held) silently waited forever.
  assert.equal(deliveryStop?.outcome, "UNKNOWN");

  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "needs-review");
  assert.equal(decision.needsReviewReason, "unknown-pod-status");
  assert.deepEqual(decision.needsReviewStopIndexes, [1]);
});

// ───────────────────────────────────────────────────────────────────
// needs-review detection rules — watchdog refactor 2026-05-16
// ───────────────────────────────────────────────────────────────────

test("return-stop signature (address match) → needs-review", () => {
  // Last stop's address matches the pickup — classic return-to-sender.
  const stops: LalamoveStop[] = [
    { ...PICKUP_STOP, address: "Rua Joana 100, Botafogo" },
    makeDeliveryStop("DELIVERED"),
    { ...PICKUP_STOP, address: "Rua Joana 100, Botafogo" },
  ];
  const ordersData: DispatchOrderSnapshot[] = [
    ORDERS_DATA[0]!,
    {
      shopifyOrderId: "gid://shopify/Order/X",
      lat: -22.95,
      lng: -43.18,
      address: "Rua Joana 100",
      name: "Bystander",
      phone: "+5521900000000",
    },
  ];
  const summary = summarizeRoutePOD(stops, ordersData, EMPTY_MAPS);
  const decision = bucketRouteForFulfillment(summary, stops);
  assert.equal(decision.bucket, "needs-review");
  assert.equal(decision.needsReviewReason, "return-stop-detected");
  assert.ok(decision.needsReviewStopIndexes && decision.needsReviewStopIndexes.length > 0);
  assert.deepEqual(decision.ordersToFulfill, []);
});

test("return-stop signature (stop count anomaly) → needs-review", () => {
  // Two delivery stops in the route but only one order dispatched — Lalamove
  // inserted an extra leg.
  const stops: LalamoveStop[] = [
    PICKUP_STOP,
    makeDeliveryStop("DELIVERED"),
    { ...PICKUP_STOP, address: "Extra stop somewhere else" },
  ];
  const summary = summarizeRoutePOD(stops, ORDERS_DATA, EMPTY_MAPS);
  const decision = bucketRouteForFulfillment(summary, stops, {
    expectedDeliveryStops: 1,
  });
  assert.equal(decision.bucket, "needs-review");
  assert.equal(decision.needsReviewReason, "return-stop-detected");
});

test("cancelled order + ≥1 DELIVERED POD → needs-review (edge case 2)", () => {
  const summary = summarizeRoutePOD(
    [PICKUP_STOP, makeDeliveryStop("DELIVERED")],
    ORDERS_DATA,
    EMPTY_MAPS,
  );
  const decision = bucketRouteForFulfillment(summary, undefined, {
    orderLevelStatus: "CANCELED",
  });
  assert.equal(decision.bucket, "needs-review");
  assert.equal(decision.needsReviewReason, "cancelled-with-partial-success");
  assert.deepEqual(decision.ordersToFulfill, []);
});

test("cancelled order + no DELIVERED PODs → skip (not needs-review)", () => {
  const summary = summarizeRoutePOD(
    [PICKUP_STOP, makeDeliveryStop("FAILED")],
    ORDERS_DATA,
    EMPTY_MAPS,
  );
  const decision = bucketRouteForFulfillment(summary, undefined, {
    orderLevelStatus: "CANCELED",
  });
  // Without any DELIVERED stop, edge case 2 isn't the right framing — fall
  // through to skip so manual review picks up the route.
  assert.notEqual(decision.bucket, "needs-review");
});

test("empty POD on terminal order — first attempt buckets as held", () => {
  // No POD object at all, order at COMPLETED, never been bucketed before.
  // Expected: held (give it more chances) on the first pass.
  const stop: LalamoveStop = {
    stopId: "delivery-1",
    address: "Rua Domingos Bastos 227, Apto 602",
    name: DELIVERY_NAME,
    phone: DELIVERY_PHONE,
  };
  const summary = summarizeRoutePOD(
    [PICKUP_STOP, stop],
    ORDERS_DATA,
    EMPTY_MAPS,
  );
  const decision = bucketRouteForFulfillment(summary, [PICKUP_STOP, stop], {
    orderLevelStatus: "COMPLETED",
    lastBucketingAt: null,
  });
  assert.equal(decision.bucket, "held");
});

test("empty POD on terminal order — older than 24h flips to needs-review", () => {
  const stop: LalamoveStop = {
    stopId: "delivery-1",
    address: "Rua Domingos Bastos 227, Apto 602",
    name: DELIVERY_NAME,
    phone: DELIVERY_PHONE,
  };
  const summary = summarizeRoutePOD(
    [PICKUP_STOP, stop],
    ORDERS_DATA,
    EMPTY_MAPS,
  );
  const now = new Date("2026-05-17T12:00:00Z");
  const oneDayAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000);
  const decision = bucketRouteForFulfillment(summary, [PICKUP_STOP, stop], {
    orderLevelStatus: "COMPLETED",
    lastBucketingAt: oneDayAgo,
    reconcileNow: now,
  });
  assert.equal(decision.bucket, "needs-review");
  assert.equal(decision.needsReviewReason, "empty-pod-after-retries");
});

test("clean route still buckets as clean when stops + context provided", () => {
  // Regression guard: passing the new params on a happy-path route must not
  // change the existing bucket assignment.
  const stops: LalamoveStop[] = [PICKUP_STOP, makeDeliveryStop("DELIVERED")];
  const summary = summarizeRoutePOD(stops, ORDERS_DATA, EMPTY_MAPS);
  const decision = bucketRouteForFulfillment(summary, stops, {
    orderLevelStatus: "COMPLETED",
  });
  assert.equal(decision.bucket, "clean");
  assert.deepEqual(decision.ordersToFulfill, ["gid://shopify/Order/7222391898432"]);
});
