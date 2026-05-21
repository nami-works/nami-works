/**
 * Quote the 7 borderline CD Extrema orders against Lalamove to determine
 * which are actually within Shops Jardins / RioSul coverage. Standalone
 * script — does NOT initialize the Shopify SDK, so works with just .env
 * Prisma access + decrypted Lalamove credentials in DB.
 */
import prisma from "../app/db.server";
import { createLalamoveQuotation } from "../app/services/lalamove.server";
import { getRuntimeCredentialsForShop } from "../app/services/lalamove-credentials.server";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";

type OrderInput = {
  name: string;
  lat: number;
  lng: number;
  address1: string;
  address2: string;
  city: string;
  province: string;
  country: string;
  targetStore: "Shops Jardins" | "RioSul";
  reason: string;
};

const ORDERS: OrderInput[] = [
  // Nova Iguaçu → RioSul (~30 km)
  { name: "80657", lat: -22.7616187, lng: -43.4550274, address1: "Rua Ivan vigne, 264", address2: "Apto 1701 bloco 2, Centro", city: "Nova Iguaçu", province: "Rio de Janeiro", country: "Brazil", targetStore: "RioSul", reason: "Nova Iguaçu ~30km from RioSul" },
  { name: "80774", lat: -22.7485016, lng: -43.4480286, address1: "Rua Guilhem Duarte, 57", address2: "602, Caonze", city: "Nova Iguaçu", province: "Rio de Janeiro", country: "Brazil", targetStore: "RioSul", reason: "Nova Iguaçu ~30km from RioSul" },
  // Indaiatuba → Shops Jardins (~95 km, but ~25 km from Campinas)
  { name: "80643", lat: -23.0843456, lng: -47.1897446, address1: "Avenida Presidente Vargas, 2921", address2: "Sala 8 andar intermediario, Vila Homero", city: "Indaiatuba", province: "São Paulo", country: "Brazil", targetStore: "Shops Jardins", reason: "Indaiatuba ~95km from SP, ~25km from Campinas" },
  { name: "80714", lat: -23.0857224, lng: -47.23378899999999, address1: "Avenida Fábio Ferraz Bicudo, 1100", address2: "Quadra L5, Condominio Dona Lucilla", city: "Indaiatuba", province: "São Paulo", country: "Brazil", targetStore: "Shops Jardins", reason: "Indaiatuba ~95km from SP, ~25km from Campinas" },
  { name: "80813", lat: -23.0669454, lng: -47.2466427, address1: "Rua Carolina Ferrarezzi Zoppi, 838", address2: "Casa, Altos da Bela Vista", city: "Indaiatuba", province: "São Paulo", country: "Brazil", targetStore: "Shops Jardins", reason: "Indaiatuba ~95km from SP, ~25km from Campinas" },
  // Suzano (state typo'd Acre, but coords place it in SP metro)
  { name: "80680", lat: -23.5450205, lng: -46.306029, address1: "Rua Vereador Romeu Graciano, 90", address2: "Residência sem campainha, Vila Mazza", city: "Suzano", province: "São Paulo", country: "Brazil", targetStore: "Shops Jardins", reason: "Suzano ~50km from SP (province typo'd Acre, coords confirm SP metro)" },
  // Paracambi → RioSul (~75 km)
  { name: "80617", lat: -22.6033662, lng: -43.7059888, address1: "Rua maria jose costa ferreira, 02", address2: "Casa, Boqueirao", city: "Paracambi", province: "Rio de Janeiro", country: "Brazil", targetStore: "RioSul", reason: "Paracambi ~75km from RioSul" },
];

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const credentials = await getRuntimeCredentialsForShop(SHOP);
  if (!credentials) {
    console.error("No Lalamove credentials in DB for", SHOP);
    process.exit(1);
  }
  console.log(`Loaded Lalamove credentials (keyPrefix=${credentials.apiKey.slice(0, 6)}…)`);

  // Pull the two pickup stores' config from Prisma
  const locs = await prisma.lalamoveLocationConfig.findMany({ where: { shop: SHOP } });
  type PickupStore = { name: string; lat: number; lng: number; market: string; language: string; serviceType: string; address: string };
  const stores: Record<string, PickupStore> = {};
  for (const row of locs) {
    const d = row.data as Record<string, unknown>;
    const locationName = String(d.locationName ?? "");
    let key: "Shops Jardins" | "RioSul" | null = null;
    if (locationName.includes("Shops Jardins")) key = "Shops Jardins";
    if (locationName.includes("RioSul")) key = "RioSul";
    if (!key) continue;
    if (typeof d.pickupLat !== "number" || typeof d.pickupLng !== "number") continue;
    stores[key] = {
      name: key,
      lat: d.pickupLat,
      lng: d.pickupLng,
      market: String(d.market ?? "BR"),
      language: String(d.language ?? "pt_BR"),
      serviceType: String(d.preferredServiceType ?? "LALAGO"),
      address: String(d.locationAddress ?? key),
    };
  }
  console.log(`Pickup stores loaded: ${Object.keys(stores).join(", ")}`);
  if (!stores["Shops Jardins"] || !stores["RioSul"]) {
    console.error("Missing pickup config for Shops Jardins or RioSul");
    process.exit(1);
  }

  console.log();
  console.log("=== Quoting 7 borderline orders ===");
  console.log();

  type Result = { order: OrderInput; pickup: PickupStore; distanceKm: number; totalBRL: number | null; error: string | null };
  const results: Result[] = [];

  for (const o of ORDERS) {
    const pickup = stores[o.targetStore]!;
    const distanceKm = haversineKm(pickup.lat, pickup.lng, o.lat, o.lng);
    try {
      const quote = await createLalamoveQuotation(
        {
          market: pickup.market,
          language: pickup.language,
          serviceType: pickup.serviceType,
          stops: [
            { coordinates: { lat: String(pickup.lat), lng: String(pickup.lng) }, address: pickup.address },
            {
              coordinates: { lat: String(o.lat), lng: String(o.lng) },
              address: [o.address1, o.city, o.province, o.country].filter(Boolean).join(", "),
              sourceAddress2: o.address2 || undefined,
            },
          ],
          isRouteOptimized: false,
        },
        credentials,
      );
      const total = parseFloat(quote?.priceBreakdown?.total ?? "0") || 0;
      results.push({ order: o, pickup, distanceKm, totalBRL: total, error: null });
      console.log(`  ✓ #${o.name} ${o.city.padEnd(15)} → ${pickup.name.padEnd(14)} ${distanceKm.toFixed(1).padStart(5)} km   R$ ${total.toFixed(2).padStart(7)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ order: o, pickup, distanceKm, totalBRL: null, error: msg.slice(0, 200) });
      console.log(`  ✗ #${o.name} ${o.city.padEnd(15)} → ${pickup.name.padEnd(14)} ${distanceKm.toFixed(1).padStart(5)} km   REJECTED: ${msg.slice(0, 100)}`);
    }
    await sleep(300);
  }

  console.log();
  console.log("=== Summary ===");
  const ok = results.filter((r) => r.error == null);
  const failed = results.filter((r) => r.error != null);
  console.log(`Flippable (Lalamove quoted): ${ok.length} / ${results.length}`);
  console.log(`Not flippable (out of coverage): ${failed.length} / ${results.length}`);
  if (ok.length > 0) {
    const totalCost = ok.reduce((a, r) => a + (r.totalBRL ?? 0), 0);
    console.log(`Total Lalamove cost for the flippable subset: R$ ${totalCost.toFixed(2)}`);
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
