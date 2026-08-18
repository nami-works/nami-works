// Resolves the delivery-method badge shown per order in the customer
// highlights modal (mockup: inputs/mockups/ge-sales-whatsapp-customer-highlights-v1.html).
//
// INCIDENT (2026-08-18): the original design read
// fulfillmentOrders[0].deliveryMethod.methodType (the field
// apps/omnify-admin relies on for Local Delivery/Retail Sales) — but this
// app's OAuth scopes don't include whatever fulfillmentOrders requires
// ("Access denied for fulfillmentOrders field", live in production).
// Adding that scope means an app-config change PLUS the shop re-consenting
// to a new permission — not a same-day fix. So this derives the badge from
// fields already covered by this app's existing scopes instead:
// shippingLines (read_orders) and the IGLU/Hexagon custom attribute
// (read_orders). Less precise than methodType — no direct
// assignedLocation.location.name, so "instore"/"pickup" can't show the
// specific store name — but it keeps the app up without a new scope grant.
// Revisit if the fulfillmentOrders scope ever gets approved.

export type ChannelType = "standard" | "local" | "pickup" | "instore" | "fallback";

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  standard: "Entrega padrão",
  local: "Entrega local",
  pickup: "Retirada em loja",
  instore: "Em loja",
  fallback: "Delivery",
};

// s-badge only has a fixed tone set (no purple/brown) — pickup and instore
// share "neutral"/"caution", distinguished by their label text instead.
export const CHANNEL_BADGE_TONE: Record<ChannelType, "info" | "success" | "caution" | "neutral"> = {
  standard: "info",
  local: "success",
  pickup: "caution",
  instore: "neutral",
  fallback: "neutral",
};

// Orders with no shipping line at all are the sold-in-person case — an
// online order always carries a shippingLines entry (even a $0 free-
// shipping one); a POS/in-store sale doesn't.
function fromShippingLineTitle(title: string | null): ChannelType {
  if (title === null) return "instore";
  const t = title.toLowerCase();
  if (t.startsWith("entrega local")) return "local";
  if (t.includes("retirada") || t.includes("pickup") || t.includes("pick up") || t.includes("pick-up")) return "pickup";
  return "standard";
}

function fromCustomAttribute(value: string | null): ChannelType | null {
  const v = (value ?? "").toUpperCase();
  if (v === "SHIPPING" || v === "SHIP") return "standard";
  if (v === "LOCAL" || v === "LOCAL_DELIVERY") return "local";
  if (v === "PICKUP" || v === "PICK_UP" || v === "PICK-UP") return "pickup";
  return null;
}

// Same strong-signal check as _verify_hexagon_methodtype_48h.py's
// strong_hexagon(): sourceName 'hexagon', or app id 316281618433 (raw or as
// a gid).
function isIgluHexagonOrder(sourceName: string | null, appGid: string | null): boolean {
  const sn = (sourceName ?? "").toLowerCase();
  const appId = appGid?.split("/").pop() ?? null;
  return sn === "hexagon" || sn === "316281618433" || appId === "316281618433";
}

export type OrderForChannel = {
  sourceName: string | null;
  appGid: string | null;
  customAttributes: { key: string; value: string }[];
  shippingLineTitle: string | null;
};

export type ResolvedChannel = {
  type: ChannelType;
  label: string; // generic badge text, e.g. "Entrega local"
  specific: string; // carrier/store name, e.g. "Lalamove", "Total Express MG"
};

export function resolveChannel(order: OrderForChannel): ResolvedChannel {
  let type: ChannelType | null = null;

  if (isIgluHexagonOrder(order.sourceName, order.appGid)) {
    const attr = order.customAttributes.find((a) => a.key === "shipping_additional_delivery_method_type");
    type = fromCustomAttribute(attr?.value ?? null);
  }
  type = type ?? fromShippingLineTitle(order.shippingLineTitle);

  const specific =
    type === "local"
      ? "Lalamove"
      : type === "standard" || type === "pickup"
        ? order.shippingLineTitle ?? "Transportadora"
        : type === "instore"
          ? "Loja"
          : order.sourceName ?? "—";

  return { type, label: CHANNEL_LABELS[type], specific };
}
