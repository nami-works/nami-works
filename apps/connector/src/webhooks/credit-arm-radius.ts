// Radius override for the just-bought-credit 30/45/60-day arm experiment
// (Lucas, 2026-09-01): any order delivered within 100km of a physical GE
// Beauty store, or picked up in-store / sold at a physical store (no
// shipping address at all), ALWAYS gets the 60-day arm — the 3-arm
// randomized experiment (armFor() in just-bought-credit.ts) only applies to
// orders shipped outside that radius.
//
// Store coordinates are the same real lat/lng already used for
// apps/sales-whatsapp's Entrega-local eligibility (app/lib/locations.ts,
// fetched from each Shopify Location's registered address, 2026-08-12) —
// duplicated here rather than cross-imported, since the two apps don't
// share a build (each is its own workspace/Docker image).
const GE_PHYSICAL_LOCATIONS = [
  { name: "Shopping Recife", lat: -8.1170441, lng: -34.9013576 },
  { name: "Shops Jardins", lat: -23.5645459, lng: -46.6689673 },
  { name: "RioMar Recife", lat: -8.0874565, lng: -34.891664 },
  { name: "RioSul", lat: -22.9569089, lng: -43.1761858 },
] as const;

export const FORCED_ARM_RADIUS_KM = 100;
export const FORCED_ARM_DAYS = 60;

const EARTH_RADIUS_KM = 6371;

// Same haversine formula as apps/sales-whatsapp's geo-eligibility.ts —
// dependency-free, directly testable.
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export type ShippingAddressForArm = { latitude: number | null; longitude: number | null } | null;

// Null (no override) leaves the random 3-arm draw in place; a string names
// the reason for the DB's audit trail (JustBoughtCreditIssuance.armForcedReason).
export function resolveForcedArmReason(shippingAddress: ShippingAddressForArm): string | null {
  // No shipping address at all = sold/picked up at a physical location
  // (POS in-store, or online "pickup in store") — confirmed live against
  // real orders (source_name:pos orders always have shippingAddress: null,
  // shippingLines: []), 2026-09-01.
  if (!shippingAddress) return "pickup_or_instore";

  const { latitude, longitude } = shippingAddress;
  // Address exists but wasn't geocoded — can't confirm proximity, so don't
  // force. Same conservative default as sales-whatsapp's geo-eligibility.
  if (latitude == null || longitude == null) return null;

  for (const loc of GE_PHYSICAL_LOCATIONS) {
    if (distanceKm(latitude, longitude, loc.lat, loc.lng) <= FORCED_ARM_RADIUS_KM) {
      return `within_100km_${loc.name.toLowerCase().replace(/\s+/g, "_")}`;
    }
  }
  return null;
}
