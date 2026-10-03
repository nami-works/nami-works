// The 4 active GE Beauty locations this app serves, and the reps granted
// access to each. Hardcoded for v1 — matches the "hardcode first,
// admin-editable later" sequencing already used elsewhere in this program
// (e.g. the wave tag in retention-experiments.md). Coordinates are the real
// lat/long from each Shopify Location's registered address (fetched via
// Admin API 2026-08-12), not approximated.
//
// locationKey is a stable slug, not the raw Shopify Location GID — keeps the
// grant table and the worklist query readable, while gidForLocation() below
// is the single place that maps back to the real Shopify object.
export type LocationKey = "shopping-recife" | "shops-jardins" | "riomar-recife" | "riosul";

export type Location = {
  key: LocationKey;
  label: string;
  shopifyLocationGid: string;
  lat: number;
  lng: number;
};

export const LOCATIONS: Record<LocationKey, Location> = {
  "shopping-recife": {
    key: "shopping-recife",
    label: "Shopping Recife",
    shopifyLocationGid: "gid://shopify/Location/97397014848",
    lat: -8.1170441,
    lng: -34.9013576,
  },
  "shops-jardins": {
    key: "shops-jardins",
    label: "Shops Jardins",
    shopifyLocationGid: "gid://shopify/Location/97784398144",
    lat: -23.5645459,
    lng: -46.6689673,
  },
  "riomar-recife": {
    key: "riomar-recife",
    label: "RioMar Recife",
    shopifyLocationGid: "gid://shopify/Location/97397047616",
    lat: -8.0874565,
    lng: -34.891664,
  },
  "riosul": {
    key: "riosul",
    label: "RioSul",
    shopifyLocationGid: "gid://shopify/Location/101298569536",
    lat: -22.9569089,
    lng: -43.1761858,
  },
};

// Same radius as the native Shopify local-delivery setting already
// configured for these locations (confirmed with Lucas 2026-08-12). A
// dedicated local-delivery carrier integration is planned later — when it
// lands, it replaces this constant/check, not the rest of the app.
export const ENTREGA_LOCAL_RADIUS_KM = 20;

// Hardcoded rep → single-location grants (2026-09-28, Lucas): only the
// geb00* retail-rep accounts are scoped down to their own store — everyone
// else who can open a Shopify app at all (owner/ops, other staff) sees
// every location merged into one worklist by default. Each geb00* email
// sees only its granted location — resolved from the real Shopify staff
// user via the App Bridge session token, not a self-selected tab. See
// auth.ts.
const GEB_REP_EMAIL = /^geb00.*@gebeauty\.com\.br$/;

export const REP_LOCATION_GRANTS: Record<string, LocationKey[]> = {
  "geb002@gebeauty.com.br": ["shopping-recife"],
  "geb003@gebeauty.com.br": ["shops-jardins"],
  "geb004@gebeauty.com.br": ["riomar-recife"],
  "geb007@gebeauty.com.br": ["riosul"],
};

const ALL_LOCATIONS = Object.values(LOCATIONS);

export function locationsForRep(email: string): Location[] {
  const normalized = email.toLowerCase();
  if (!GEB_REP_EMAIL.test(normalized)) {
    return ALL_LOCATIONS;
  }
  const keys = REP_LOCATION_GRANTS[normalized] ?? [];
  return keys.map((k) => LOCATIONS[k]);
}
