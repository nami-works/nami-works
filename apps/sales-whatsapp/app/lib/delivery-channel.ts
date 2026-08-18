// Resolves the delivery-method badge shown per order in the customer
// highlights modal (mockup: inputs/mockups/ge-sales-whatsapp-customer-highlights-v1.html).
//
// Primary signal is Shopify's own fulfillmentOrders[0].deliveryMethod.methodType
// — the same field apps/omnify-admin already relies on for Local Delivery
// and Retail Sales. It's unreliable for IGLU/Hexagon POS orders though: a
// dedicated audit (gebeauty/scripts/_verify_hexagon_methodtype_48h.py) found
// methodType can disagree with the order's actual intent for that
// integration, and apps/omnify-admin/app/sales-goals/classification.ts
// documents the same integration also misreporting physicalLocation. For
// those orders, this falls back to the shipping_additional_delivery_method_type
// custom attribute the Hexagon audit script cross-checks against.

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

function fromMethodType(methodType: string | null): ChannelType | null {
  if (methodType === "SHIPPING") return "standard";
  if (methodType === "LOCAL") return "local";
  if (methodType === "PICK_UP") return "pickup";
  if (methodType === "RETAIL") return "instore";
  return null;
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
  methodType: string | null;
  customAttributes: { key: string; value: string }[];
  shippingLineTitle: string | null;
  locationName: string | null;
};

export type ResolvedChannel = {
  type: ChannelType;
  label: string; // generic badge text, e.g. "Entrega local"
  specific: string; // carrier/store name, e.g. "Lalamove", "Shops Jardins"
};

export function resolveChannel(order: OrderForChannel): ResolvedChannel {
  let type: ChannelType | null = null;

  if (isIgluHexagonOrder(order.sourceName, order.appGid)) {
    const attr = order.customAttributes.find((a) => a.key === "shipping_additional_delivery_method_type");
    type = fromCustomAttribute(attr?.value ?? null);
  }
  type = type ?? fromMethodType(order.methodType) ?? "fallback";

  const specific =
    type === "instore" || type === "pickup"
      ? order.locationName ?? "Loja"
      : type === "local"
        ? "Lalamove"
        : type === "standard"
          ? order.shippingLineTitle ?? "Transportadora"
          : order.sourceName ?? "—";

  return { type, label: CHANNEL_LABELS[type], specific };
}
