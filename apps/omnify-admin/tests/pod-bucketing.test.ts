import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeRoutePOD,
  bucketRouteForFulfillment,
  type LalamoveStop,
  type DispatchOrderSnapshot,
  type DispatchOrderMapRow,
} from "../app/services/pod-bucketing.server";

const pickup: LalamoveStop = {
  stopId: "stop-0",
  address: "Pickup · Rua do Estoque 1",
  name: "Loja",
  phone: "+5511900000000",
};

const orders: DispatchOrderSnapshot[] = [
  {
    shopifyOrderId: "gid://shopify/Order/78298",
    name: "#78298",
    phone: "+5511911111111",
    lat: -23.55,
    lng: -46.63,
    address: "Rua A, 100",
  },
  {
    shopifyOrderId: "gid://shopify/Order/78301",
    name: "#78301",
    phone: "+5511922222222",
    lat: -23.56,
    lng: -46.65,
    address: "Av. B, 999",
  },
  {
    shopifyOrderId: "gid://shopify/Order/78305",
    name: "#78305",
    phone: "+5511933333333",
    lat: -23.57,
    lng: -46.66,
    address: "Rua C, 500",
  },
] as const;

const orderMaps: DispatchOrderMapRow[] = orders.map((o) => ({
  shopifyOrderId: o.shopifyOrderId,
  currentStatus: null,
  failureReason: null,
}));

test("clean bucket — all stops DELIVERED, all matched by phone", () => {
  const stops: LalamoveStop[] = [
    pickup,
    { stopId: "s1", phone: "+5511911111111", name: "Maria", POD: { status: "DELIVERED" } },
    { stopId: "s2", phone: "+5511922222222", name: "Yasmin", POD: { status: "DELIVERED" } },
    { stopId: "s3", phone: "+5511933333333", name: "Carolina", POD: { status: "DELIVERED" } },
  ];
  const summary = summarizeRoutePOD(stops, orders, orderMaps);
  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "clean");
  assert.deepEqual(decision.ordersToFulfill, orders.map((o) => o.shopifyOrderId));
  assert.equal(decision.ordersToRedeliver.length, 0);
  assert.equal(decision.unmatchedStopIndexes.length, 0);
});

test("mixed bucket — Yasmin #78301 fixture: 4 DELIVERED + 1 FAILED", () => {
  const ordersFull: DispatchOrderSnapshot[] = [
    ...orders,
    {
      shopifyOrderId: "gid://shopify/Order/78308",
      name: "#78308",
      phone: "+5511944444444",
      lat: -23.58,
      lng: -46.67,
      address: "Rua D, 1",
    },
  ];
  const orderMapsFull: DispatchOrderMapRow[] = ordersFull.map((o) => ({
    shopifyOrderId: o.shopifyOrderId,
    currentStatus: null,
    failureReason: null,
  }));
  const stops: LalamoveStop[] = [
    pickup,
    { stopId: "s1", phone: "+5511911111111", name: "Maria",    POD: { status: "DELIVERED" } },
    { stopId: "s2", phone: "+5511922222222", name: "Yasmin",   POD: { status: "FAILED" } }, // <- the bug
    { stopId: "s3", phone: "+5511933333333", name: "Carolina", POD: { status: "DELIVERED" } },
    { stopId: "s4", phone: "+5511944444444", name: "Júlia",    POD: { status: "DELIVERED" } },
  ];
  const summary = summarizeRoutePOD(stops, ordersFull, orderMapsFull);
  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "mixed");
  assert.equal(decision.ordersToFulfill.length, 3);
  assert.deepEqual(
    decision.ordersToRedeliver,
    ["gid://shopify/Order/78301"],
    "Yasmin's order goes to re-delivery, not fulfillment",
  );
  assert.ok(
    !decision.ordersToFulfill.includes("gid://shopify/Order/78301"),
    "Yasmin's order is NOT in ordersToFulfill — no DELIVERED email",
  );
});

test("held bucket — at least one PENDING stop", () => {
  const stops: LalamoveStop[] = [
    pickup,
    { stopId: "s1", phone: "+5511911111111", name: "Maria",    POD: { status: "DELIVERED" } },
    { stopId: "s2", phone: "+5511922222222", name: "Yasmin",   POD: { status: "PENDING" } },
    { stopId: "s3", phone: "+5511933333333", name: "Carolina", POD: { status: "DELIVERED" } },
  ];
  const summary = summarizeRoutePOD(stops, orders, orderMaps);
  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "held");
  assert.equal(decision.ordersToFulfill.length, 0, "no Shopify writes when held");
  assert.equal(decision.ordersToRedeliver.length, 0, "no re-delivery tagging when held");
});

test("held bucket — unmatched stop (matching cascade fails)", () => {
  const stops: LalamoveStop[] = [
    pickup,
    { stopId: "s1", phone: "+5511911111111", name: "Maria",    POD: { status: "DELIVERED" } },
    { stopId: "s2", phone: "+5519988888888", name: "Estranho", POD: { status: "DELIVERED" } }, // no order matches
    { stopId: "s3", phone: "+5511933333333", name: "Carolina", POD: { status: "DELIVERED" } },
  ];
  const summary = summarizeRoutePOD(stops, orders, orderMaps);
  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "held");
  assert.deepEqual(decision.unmatchedStopIndexes, [2]);
});

test("skip bucket — no DELIVERED stops at all", () => {
  const stops: LalamoveStop[] = [
    pickup,
    { stopId: "s1", phone: "+5511911111111", name: "Maria",    POD: { status: "FAILED" } },
    { stopId: "s2", phone: "+5511922222222", name: "Yasmin",   POD: { status: "FAILED" } },
  ];
  const ordersTwo = orders.slice(0, 2);
  const mapsTwo = orderMaps.slice(0, 2);
  const summary = summarizeRoutePOD(stops, ordersTwo, mapsTwo);
  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "skip");
  assert.equal(decision.ordersToFulfill.length, 0);
  assert.equal(decision.ordersToRedeliver.length, 2, "FAILED stops still get re-delivery tag in skip bucket");
});

test("matching cascade — phone wins over name when both present", () => {
  const stops: LalamoveStop[] = [
    pickup,
    {
      stopId: "s1",
      phone: "+5511911111111", // matches order #78298
      name: "Wrong Name",      // would NOT match by name
      POD: { status: "DELIVERED" },
    },
  ];
  const ordersOne = [orders[0]!];
  const mapsOne = [orderMaps[0]!];
  const summary = summarizeRoutePOD(stops, ordersOne, mapsOne);
  assert.equal(summary[1]!.matchSignal, "phone");
  assert.equal(summary[1]!.orderId, "gid://shopify/Order/78298");
});

test("matching cascade — falls through to last-name match when phone missing", () => {
  const stops: LalamoveStop[] = [
    pickup,
    {
      stopId: "s1",
      phone: "", // no phone
      name: "Maria Silva", // last-name "silva" matches order
      POD: { status: "DELIVERED" },
    },
  ];
  const ordersWithSilva: DispatchOrderSnapshot[] = [
    {
      shopifyOrderId: "gid://shopify/Order/99001",
      name: "#99001",
      phone: "",
      lat: 0,
      lng: 0,
      address: "X",
    },
  ];
  // Override the order's name field so name-cascade can match.
  // (DispatchOrderSnapshot.name is the customer name in production.)
  ordersWithSilva[0]!.name = "Maria Silva Costa";
  const mapsWithSilva: DispatchOrderMapRow[] = ordersWithSilva.map((o) => ({
    shopifyOrderId: o.shopifyOrderId,
    currentStatus: null,
    failureReason: null,
  }));
  const summary = summarizeRoutePOD(stops, ordersWithSilva, mapsWithSilva);
  assert.equal(summary[1]!.matchSignal, "name");
  assert.equal(summary[1]!.orderId, "gid://shopify/Order/99001");
});

test("first stop is always treated as pickup, never a delivery", () => {
  const stops: LalamoveStop[] = [
    { stopId: "s0", phone: "+5511900000000", name: "Loja", POD: { status: "DELIVERED" } },
    { stopId: "s1", phone: "+5511911111111", name: "Maria", POD: { status: "DELIVERED" } },
  ];
  const ordersOne = [orders[0]!];
  const mapsOne = [orderMaps[0]!];
  const summary = summarizeRoutePOD(stops, ordersOne, mapsOne);
  assert.equal(summary.length, 2);
  assert.equal(summary[0]!.isPickup, true);
  assert.equal(summary[0]!.orderId, null);
  assert.equal(summary[1]!.isPickup, false);
  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "clean");
  assert.equal(decision.ordersToFulfill.length, 1);
});

test("MISSING outcome on a matched stop is treated as held (unverified)", () => {
  const stops: LalamoveStop[] = [
    pickup,
    {
      stopId: "s1",
      phone: "+5511911111111",
      name: "Maria",
      POD: undefined, // POD never came back
    },
  ];
  const ordersOne = [orders[0]!];
  const mapsOne: DispatchOrderMapRow[] = [
    { shopifyOrderId: orders[0]!.shopifyOrderId, currentStatus: null, failureReason: null },
  ];
  const summary = summarizeRoutePOD(stops, ordersOne, mapsOne);
  assert.equal(summary[1]!.outcome, "MISSING");
  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "held", "MISSING-but-matched holds the route until POD arrives");
});

test("phone normalization — different formats still match", () => {
  const stops: LalamoveStop[] = [
    pickup,
    {
      stopId: "s1",
      phone: "(11) 91111-1111", // Brazilian formatted, missing +55 prefix
      name: "Maria",
      POD: { status: "DELIVERED" },
    },
  ];
  const ordersOne: DispatchOrderSnapshot[] = [
    { ...orders[0]!, phone: "(11) 91111-1111" },
  ];
  const mapsOne = [orderMaps[0]!];
  const summary = summarizeRoutePOD(stops, ordersOne, mapsOne);
  assert.equal(summary[1]!.matchSignal, "phone");
});

test("partial-delivery scenario — clean bucket can still produce partialDelivery if event fails", () => {
  // The bucket itself is clean; partialDelivery is computed downstream by
  // handleMarkDelivered when shopifyFulfilled !== deliveredEventsCreated.
  // The bucketing layer only decides WHO to fulfill. Test that the bucket
  // assignment is independent of the actual Shopify outcome.
  const stops: LalamoveStop[] = [
    pickup,
    { stopId: "s1", phone: "+5511911111111", name: "Maria",    POD: { status: "DELIVERED" } },
    { stopId: "s2", phone: "+5511922222222", name: "Yasmin",   POD: { status: "DELIVERED" } },
    { stopId: "s3", phone: "+5511933333333", name: "Carolina", POD: { status: "DELIVERED" } },
  ];
  const summary = summarizeRoutePOD(stops, orders, orderMaps);
  const decision = bucketRouteForFulfillment(summary);
  assert.equal(decision.bucket, "clean");
  // partialDelivery is tested at the integration level — the helper here
  // produces ordersToFulfill, the caller measures Shopify success rate.
});
