import { ENTREGA_LOCAL_RADIUS_KM, type Location } from "./locations.js";

const EARTH_RADIUS_KM = 6371;

// Haversine distance. No external geo library — this is the one calculation
// the whole Entrega-local eligibility model rests on, worth keeping
// dependency-free and directly testable.
export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

export type ExpansionBand = "entrega_local" | "vizinhas" | "estado" | "nacional";

// Distance bands beyond the 20km Entrega-local radius, used to expand a
// rep's pool once it runs dry (Lucas, 2026-08-12): nearby cities first, then
// the whole state, before falling back to nationwide (Prateleira infinita,
// no distance constraint at all — every remaining eligible customer).
const VIZINHAS_RADIUS_KM = 120;
const ESTADO_RADIUS_KM = 600;

export function expansionBand(customerLat: number, customerLng: number, location: Location): ExpansionBand {
  const km = distanceKm(customerLat, customerLng, location.lat, location.lng);
  if (km <= ENTREGA_LOCAL_RADIUS_KM) return "entrega_local";
  if (km <= VIZINHAS_RADIUS_KM) return "vizinhas";
  if (km <= ESTADO_RADIUS_KM) return "estado";
  return "nacional";
}

export function isEntregaLocalEligible(customerLat: number, customerLng: number, location: Location): boolean {
  return distanceKm(customerLat, customerLng, location.lat, location.lng) <= ENTREGA_LOCAL_RADIUS_KM;
}

const BAND_ORDER: ExpansionBand[] = ["entrega_local", "vizinhas", "estado", "nacional"];

// Progressive expansion per Lucas's design (2026-08-12): a location's
// worklist starts as its Entrega-local pool; once that's empty, it widens
// to nearby cities, then the whole state, then nationwide (Prateleira
// infinita, no distance constraint) — absorbing everyone else rather than
// leaving an unowned "Sem região" bucket.
//
// Per-request, not per-day: this widens within a SINGLE loader call if the
// narrowest band is empty for THIS rep right now. A more advanced version
// would only widen once the narrower band is confirmed dry across all 4
// reps over time (avoiding one location "stealing" candidates a
// temporarily-slow-but-not-actually-exhausted narrower band would have
// gotten) — flagged as a real future refinement, not implemented here.
export function selectByProgressiveExpansion<T>(
  items: T[],
  bandOf: (item: T) => ExpansionBand,
): { selected: T[]; band: ExpansionBand } {
  for (const band of BAND_ORDER) {
    const maxIndex = BAND_ORDER.indexOf(band);
    const selected = items.filter((item) => BAND_ORDER.indexOf(bandOf(item)) <= maxIndex);
    if (selected.length > 0) return { selected, band };
  }
  return { selected: [], band: "nacional" };
}
