/**
 * State-level breakdown of unfulfilled orders at CD Extrema.
 *
 * For each Brazilian state, count orders. For states with a local store
 * (SP → Shops Jardins, RJ → RioSul, PE → Shopping Recife), drill down per
 * city and flag which ones are within Lalamove range of the local store.
 *
 * Quote step omitted for speed — uses 100 km haversine gate as a proxy for
 * "deliverable via local store"; matches the in-scope set from
 * extrema-rerouting-quote.ts. Add a `--quote` flag if you want live
 * Lalamove confirmation per order.
 */

import prisma from "../app/db.server";
import { unauthenticated } from "../app/shopify.server";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const MAX_RADIUS_KM = 100;

// State → preferred local store name (used to look up pickup coords).
const STATE_TO_STORE: Record<string, string> = {
  SP: "Shops Jardins",
  RJ: "RioSul",
  PE: "Shopping Recife",
};

// Override cities (deliverable regardless of distance).
const CITY_OVERRIDES: Record<string, string> = {
  niteroi: "RioSul",
  campinas: "Shops Jardins",
};

const normalize = (s: string | null | undefined): string =>
  (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const STATE_FULL_NAMES: Record<string, string> = {
  SP: "São Paulo", RJ: "Rio de Janeiro", PE: "Pernambuco", MG: "Minas Gerais",
  RS: "Rio Grande do Sul", PR: "Paraná", SC: "Santa Catarina", BA: "Bahia",
  DF: "Distrito Federal", GO: "Goiás", ES: "Espírito Santo", CE: "Ceará",
  PB: "Paraíba", PA: "Pará", AM: "Amazonas", MT: "Mato Grosso",
  MS: "Mato Grosso do Sul", AL: "Alagoas", RN: "Rio Grande do Norte",
  MA: "Maranhão", PI: "Piauí", SE: "Sergipe", TO: "Tocantins",
  RO: "Rondônia", RR: "Roraima", AP: "Amapá", AC: "Acre",
};

// Normalize province string from Shopify (might be "SP" or "São Paulo" depending on shop config).
function normalizeStateCode(province: string | null | undefined): string {
  if (!province) return "??";
  const trimmed = province.trim();
  // 2-letter code direct
  if (trimmed.length === 2) return trimmed.toUpperCase();
  // Full name → code
  const normalized = normalize(trimmed);
  for (const [code, name] of Object.entries(STATE_FULL_NAMES)) {
    if (normalize(name) === normalized) return code;
  }
  return trimmed;
}

const CANONICAL_CITY: Record<string, string> = {
  "sao paulo": "São Paulo", "rio de janeiro": "Rio de Janeiro",
  "niteroi": "Niterói", "campinas": "Campinas", "osasco": "Osasco",
  "taboao da serra": "Taboão da Serra", "embu das artes": "Embu das Artes",
  "sao bernardo do campo": "São Bernardo do Campo", "santo andre": "Santo André",
  "guarulhos": "Guarulhos", "santos": "Santos", "jundiai": "Jundiaí",
  "recife": "Recife", "olinda": "Olinda",
  "jaboatao dos guararapes": "Jaboatão dos Guararapes",
  "belo horizonte": "Belo Horizonte", "porto alegre": "Porto Alegre",
  "brasilia": "Brasília", "florianopolis": "Florianópolis",
  "curitiba": "Curitiba", "salvador": "Salvador", "goiania": "Goiânia",
  "vitoria": "Vitória", "fortaleza": "Fortaleza", "belem": "Belém",
  "manaus": "Manaus", "amparo": "Amparo",
};
const titleCase = (s: string): string =>
  s.split(" ").map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
const canonicalCity = (raw: string | null | undefined): string => {
  if (!raw) return "<unknown>";
  const key = normalize(raw);
  return CANONICAL_CITY[key] ?? titleCase(key);
};

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

type Store = { name: string; lat: number; lng: number };

(async () => {
  const client = await unauthenticated.admin(SHOP);

  // Load 3 store pickup coords from LalamoveLocationConfig.
  const locRows = await prisma.lalamoveLocationConfig.findMany({ where: { shop: SHOP } });
  const storeByName = new Map<string, Store>();
  for (const row of locRows) {
    const d = row.data as { locationName?: string; pickupLat?: number; pickupLng?: number };
    if (d?.pickupLat == null || d?.pickupLng == null) continue;
    for (const expectedName of ["RioSul", "Shopping Recife", "Shops Jardins"]) {
      if ((d.locationName ?? "").includes(expectedName)) {
        storeByName.set(expectedName, {
          name: expectedName,
          lat: d.pickupLat,
          lng: d.pickupLng,
        });
        break;
      }
    }
  }

  // Find CD Extrema id.
  const locRes = await client.admin.graphql(
    `#graphql
      query Locs { locations(first: 50) { nodes { id name } } }`,
  );
  const locJson = (await locRes.json()) as {
    data?: { locations?: { nodes?: Array<{ id: string; name: string }> } };
  };
  const extrema = (locJson?.data?.locations?.nodes ?? []).find((n) => /extrema/i.test(n.name));
  if (!extrema) {
    console.error("No CD Extrema location");
    await prisma.$disconnect();
    process.exit(1);
  }
  const extremaLegacy = extrema.id.replace("gid://shopify/Location/", "");
  const query = `fulfillment_location_id:${extremaLegacy} fulfillment_status:unshipped status:open`;

  type Row = {
    id: string;
    name: string;
    state: string;
    city: string;
    cityCanonical: string;
    lat: number | null;
    lng: number | null;
  };
  const orders: Row[] = [];
  let cursor: string | null = null;
  let noCoords = 0;
  for (let page = 0; page < 40; page += 1) {
    const res = await client.admin.graphql(
      `#graphql
        query O($query: String!, $first: Int!, $after: String) {
          orders(query: $query, first: $first, after: $after, sortKey: CREATED_AT) {
            edges { cursor node {
              id name displayFulfillmentStatus
              shippingAddress { city province latitude longitude }
            } }
            pageInfo { hasNextPage }
          }
        }`,
      { variables: { query, first: 100, after: cursor } },
    );
    const json = (await res.json()) as {
      data?: { orders?: { edges?: Array<{ cursor: string; node: {
        id: string; name: string; displayFulfillmentStatus: string;
        shippingAddress?: { city?: string | null; province?: string | null; latitude?: number | null; longitude?: number | null; } | null;
      } }>; pageInfo?: { hasNextPage?: boolean } } };
    };
    const edges = json?.data?.orders?.edges ?? [];
    for (const e of edges) {
      if (e.node.displayFulfillmentStatus !== "UNFULFILLED") continue;
      const addr = e.node.shippingAddress;
      const state = normalizeStateCode(addr?.province);
      const city = addr?.city ?? "";
      orders.push({
        id: e.node.id,
        name: e.node.name,
        state,
        city,
        cityCanonical: canonicalCity(city),
        lat: addr?.latitude ? Number(addr.latitude) : null,
        lng: addr?.longitude ? Number(addr.longitude) : null,
      });
      if (!addr?.latitude || !addr?.longitude) noCoords += 1;
    }
    if (!json?.data?.orders?.pageInfo?.hasNextPage || edges.length === 0) break;
    cursor = edges[edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }

  console.log(`Total unfulfilled at CD Extrema: ${orders.length}  (no lat/lng: ${noCoords})`);
  console.log();

  // Bucket by state.
  const byState = new Map<string, Row[]>();
  for (const o of orders) {
    const arr = byState.get(o.state) ?? [];
    arr.push(o);
    byState.set(o.state, arr);
  }
  const sortedStates = [...byState.entries()].sort((a, b) => b[1].length - a[1].length);

  // Header
  console.log("BY STATE (sorted by order count)");
  console.log("─".repeat(70));
  console.log(`| ${"State".padEnd(35)} | ${"Code".padEnd(4)} | Orders | Local | Out |`);
  console.log(`| ${"-".repeat(35)} | ${"-".repeat(4)} | ------ | ----- | --- |`);

  let grandLocal = 0;
  let grandOutOfRange = 0;
  for (const [code, rows] of sortedStates) {
    const stateName = STATE_FULL_NAMES[code] ?? code;
    const storeName = STATE_TO_STORE[code];
    const store = storeName ? storeByName.get(storeName) : null;
    let localCount = 0;
    let outCount = 0;
    if (store) {
      for (const r of rows) {
        const cityKey = normalize(r.city);
        const overrideStore = CITY_OVERRIDES[cityKey];
        const overrideHit = overrideStore && storeName === overrideStore;
        if (overrideHit) {
          localCount += 1;
          continue;
        }
        if (r.lat == null || r.lng == null) {
          outCount += 1;
          continue;
        }
        const km = haversineKm(r.lat, r.lng, store.lat, store.lng);
        if (km <= MAX_RADIUS_KM) localCount += 1;
        else outCount += 1;
      }
    } else {
      outCount = rows.length;
    }
    grandLocal += localCount;
    grandOutOfRange += outCount;
    const star = storeName ? " ★" : "  ";
    console.log(
      `| ${(stateName + star).padEnd(35)} | ${code.padEnd(4)} | ${String(rows.length).padStart(6)} | ${String(localCount).padStart(5)} | ${String(outCount).padStart(3)} |`,
    );
  }
  console.log(`| ${"-".repeat(35)} | ${"-".repeat(4)} | ------ | ----- | --- |`);
  console.log(
    `| ${"TOTAL".padEnd(35)} | ${"".padEnd(4)} | ${String(orders.length).padStart(6)} | ${String(grandLocal).padStart(5)} | ${String(grandOutOfRange).padStart(3)} |`,
  );
  console.log();
  console.log("★ = state has a local store; \"Local\" = within 100 km of store or override-city");
  console.log();

  // Drill-downs for the 3 states with local stores.
  for (const code of ["SP", "RJ", "PE"] as const) {
    const rows = byState.get(code) ?? [];
    const storeName = STATE_TO_STORE[code];
    const store = storeByName.get(storeName);
    if (rows.length === 0) continue;
    console.log(`DRILLDOWN — ${STATE_FULL_NAMES[code]} (${code}) → ${storeName}`);
    console.log("─".repeat(70));

    // Per-city breakdown.
    type CityRow = { city: string; total: number; local: number; out: number; minKm: number };
    const byCity = new Map<string, CityRow>();
    for (const r of rows) {
      const key = r.cityCanonical;
      let bucket = byCity.get(key);
      if (!bucket) {
        bucket = { city: key, total: 0, local: 0, out: 0, minKm: Infinity };
        byCity.set(key, bucket);
      }
      bucket.total += 1;
      const cityKeyNorm = normalize(r.city);
      const overrideStore = CITY_OVERRIDES[cityKeyNorm];
      const overrideHit = overrideStore && storeName === overrideStore;
      if (overrideHit) {
        bucket.local += 1;
        if (store && r.lat != null && r.lng != null) {
          const km = haversineKm(r.lat, r.lng, store.lat, store.lng);
          bucket.minKm = Math.min(bucket.minKm, km);
        }
      } else if (store && r.lat != null && r.lng != null) {
        const km = haversineKm(r.lat, r.lng, store.lat, store.lng);
        bucket.minKm = Math.min(bucket.minKm, km);
        if (km <= MAX_RADIUS_KM) bucket.local += 1;
        else bucket.out += 1;
      } else {
        bucket.out += 1;
      }
    }
    const cityArr = [...byCity.values()].sort((a, b) => b.total - a.total);
    const cityW = Math.max(28, ...cityArr.map((c) => c.city.length));
    console.log(`| ${"City".padEnd(cityW)} | Orders | Local | Out | Closest km |`);
    console.log(`| ${"-".repeat(cityW)} | ------ | ----- | --- | ---------- |`);
    for (const c of cityArr) {
      const kmStr = Number.isFinite(c.minKm) ? c.minKm.toFixed(1) : "—";
      console.log(
        `| ${c.city.padEnd(cityW)} | ${String(c.total).padStart(6)} | ${String(c.local).padStart(5)} | ${String(c.out).padStart(3)} | ${kmStr.padStart(10)} |`,
      );
    }
    console.log();
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
