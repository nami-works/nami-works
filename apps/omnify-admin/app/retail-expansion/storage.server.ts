import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import prisma from "../db.server";

export type RetailLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  createdAt: string;
};

export type LocationSet = {
  id: string;
  name: string;
  locations: RetailLocation[];
  createdAt: string;
};

export type CustomerGeo = {
  id: string;
  name: string | null;
  latitude: number;
  longitude: number;
  createdAt: string | null;
};

export type OrderGeo = {
  id: string;
  name: string;
  customerId: string | null;
  customerName: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  totalAmount: number | null;
  currencyCode: string | null;
  createdAt: string | null;
};

export type AnalyticsCache = {
  customers: CustomerGeo[];
  orders: OrderGeo[];
  updatedAt: string | null;
};

type StoragePaths = {
  locations: string;
  locationSets: string;
  analytics: string;
};

const sanitizeShop = (shop: string) =>
  shop.replace(/[^a-zA-Z0-9.-]/g, "_");

const getStoragePaths = (shop?: string): StoragePaths => {
  const baseDir = shop
    ? path.join(
        process.cwd(),
        "storage",
        "retail-expansion",
        sanitizeShop(shop),
      )
    : path.join(process.cwd(), "storage", "retail-expansion");
  return {
    locations: path.join(baseDir, "custom_locations.json"),
    locationSets: path.join(baseDir, "location_sets.json"),
    analytics: path.join(baseDir, "analytics_cache.json"),
  };
};

const ensureDir = async (shop?: string) => {
  const baseDir = shop
    ? path.join(
        process.cwd(),
        "storage",
        "retail-expansion",
        sanitizeShop(shop),
      )
    : path.join(process.cwd(), "storage", "retail-expansion");
  await mkdir(baseDir, { recursive: true });
};

const readJson = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const writeJson = async <T>(filePath: string, data: T, shop?: string) => {
  await ensureDir(shop);
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
};

export const readLocations = async (
  shop?: string,
): Promise<RetailLocation[]> => {
  if (shop) {
    const row = await prisma.retailCurrentLocations.findUnique({
      where: { shop },
    });
    const locations = (row?.locations ?? []) as RetailLocation[];
    return Array.isArray(locations) ? locations : [];
  }
  const { locations } = getStoragePaths(shop);
  return readJson<RetailLocation[]>(locations, []);
};

export const writeLocations = async (
  locations: RetailLocation[],
  shop?: string,
) => {
  if (shop) {
    await prisma.retailCurrentLocations.upsert({
      where: { shop },
      create: { shop, locations: locations as unknown as object },
      update: { locations: locations as unknown as object },
    });
    return;
  }
  const { locations: locationsPath } = getStoragePaths(shop);
  await writeJson(locationsPath, locations, shop);
};

export const readLocationSets = async (
  shop?: string,
): Promise<LocationSet[]> => {
  if (shop) {
    const rows = await prisma.retailLocationSet.findMany({
      where: { shop },
      orderBy: { updatedAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      locations: (r.locations as RetailLocation[]) ?? [],
      createdAt: r.createdAt,
    }));
  }
  const { locationSets } = getStoragePaths(shop);
  return readJson<LocationSet[]>(locationSets, []);
};

export const writeLocationSets = async (sets: LocationSet[], shop?: string) => {
  if (shop) {
    await prisma.retailLocationSet.deleteMany({ where: { shop } });
    if (sets.length > 0) {
      await prisma.retailLocationSet.createMany({
        data: sets.map((s) => ({
          id: s.id,
          shop,
          name: s.name,
          locations: s.locations as unknown as object,
          createdAt: s.createdAt,
        })),
      });
    }
    return;
  }
  const { locationSets } = getStoragePaths(shop);
  await writeJson(locationSets, sets, shop);
};

export const readAnalyticsCache = async (
  shop?: string,
): Promise<AnalyticsCache> => {
  if (shop) {
    const row = await prisma.retailAnalyticsCache.findUnique({
      where: { shop },
    });
    if (!row) {
      return { customers: [], orders: [], updatedAt: null };
    }
    const customers = (row.customers as CustomerGeo[]) ?? [];
    const orders = (row.orders as OrderGeo[]) ?? [];
    return {
      customers: customers.map((c) => ({
        ...c,
        createdAt: typeof c.createdAt === "string" ? c.createdAt : null,
      })),
      orders: orders.map((o) => ({
        ...o,
        city: typeof o.city === "string" ? o.city : null,
        latitude: typeof o.latitude === "number" ? o.latitude : null,
        longitude: typeof o.longitude === "number" ? o.longitude : null,
        createdAt: typeof o.createdAt === "string" ? o.createdAt : null,
      })),
      updatedAt: row.updatedAt?.toISOString() ?? null,
    };
  }
  const { analytics } = getStoragePaths(shop);
  const raw = await readJson<AnalyticsCache>(analytics, {
    customers: [],
    orders: [],
    updatedAt: null,
  });
  return {
    ...raw,
    customers: (raw.customers ?? []).map((customer) => ({
      ...customer,
      createdAt:
        typeof customer.createdAt === "string" ? customer.createdAt : null,
    })),
    orders: (raw.orders ?? []).map((order) => ({
      ...order,
      city: typeof order.city === "string" ? order.city : null,
      latitude: typeof order.latitude === "number" ? order.latitude : null,
      longitude: typeof order.longitude === "number" ? order.longitude : null,
      createdAt: typeof order.createdAt === "string" ? order.createdAt : null,
    })),
  };
};

export const writeAnalyticsCache = async (
  cache: AnalyticsCache,
  shop?: string,
) => {
  if (shop) {
    await prisma.retailAnalyticsCache.upsert({
      where: { shop },
      create: {
        shop,
        customers: (cache.customers ?? []) as unknown as object,
        orders: (cache.orders ?? []) as unknown as object,
      },
      update: {
        customers: (cache.customers ?? []) as unknown as object,
        orders: (cache.orders ?? []) as unknown as object,
      },
    });
    return;
  }
  const { analytics } = getStoragePaths(shop);
  await writeJson(analytics, cache, shop);
};

export const clearAnalyticsCache = async (shop?: string) => {
  if (shop) {
    await prisma.retailAnalyticsCache.upsert({
      where: { shop },
      create: { shop, customers: [], orders: [] },
      update: { customers: [], orders: [] },
    });
    return;
  }
  const { analytics } = getStoragePaths(shop);
  await writeJson(
    analytics,
    { customers: [], orders: [], updatedAt: null },
    shop,
  );
};
