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

test("unknown POD status with no fallback → MISSING (bucket=held)", () => {
  const summary = summarizeRoutePOD(
    [PICKUP_STOP, makeDeliveryStop("WAITING_FOR_SIGNATURE")],
    ORDERS_DATA,
    EMPTY_MAPS,
  );
  const deliveryStop = summary.find((s) => !s.isPickup);
  // Even though the order matched, an unrecognised POD status with no
  // currentStatus fallback yields MISSING for the stop.
  assert.equal(deliveryStop?.outcome, "MISSING");

  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "held");
});
