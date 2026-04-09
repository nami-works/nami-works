import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import prisma from "../db.server";

export type RetailLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  city?: string | null;
  province?: string | null;
  neighborhood?: string | null;
  tenantMixFit?: number | null;
  subjectiveFit?: number | null;
  predominantAudience?: "A" | "B" | "C" | "N/A" | null;
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
  latitude: number | null;
  longitude: number | null;
  city?: string | null;
  createdAt: string | null;
};

export type OrderGeo = {
  id: string;
  name: string;
  customerId: string | null;
  customerName: string | null;
  city: string | null;
  province?: string | null;
  country?: string | null;
  latitude: number | null;
  longitude: number | null;
  totalAmount: number | null;
  currencyCode: string | null;
  createdAt: string | null;
  fulfillmentLocationId?: string | null;
};

export type AnalyticsCache = {
  customers: CustomerGeo[];
  orders: OrderGeo[];
  cityGeocodes?: Record<string, { latitude: number; longitude: number }>;
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
        latitude: typeof c.latitude === "number" ? c.latitude : null,
        longitude: typeof c.longitude === "number" ? c.longitude : null,
        city: typeof c.city === "string" ? c.city : null,
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
      latitude: typeof customer.latitude === "number" ? customer.latitude : null,
      longitude: typeof customer.longitude === "number" ? customer.longitude : null,
      city: typeof customer.city === "string" ? customer.city : null,
      createdAt: typeof customer.createdAt === "string" ? customer.createdAt : null,
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

// ─── Proposal helpers ────────────────────────────────────────────────────────

export type LocationProposal = {
  id: string;
  locationSetId: string;
  locationId: string;
  leasingValue: number | null;
  currency: string | null;
  notes: string | null;
  fileName: string | null;
  fileType: string | null;
  fileSize: number | null;
  createdAt: string;
};

export const readProposals = async (
  shop: string,
  locationSetId?: string,
): Promise<LocationProposal[]> => {
  const where = locationSetId ? { shop, locationSetId } : { shop };
  const rows = await prisma.retailLocationProposal.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      locationSetId: true,
      locationId: true,
      leasingValue: true,
      currency: true,
      notes: true,
      fileName: true,
      fileType: true,
      fileSize: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  }));
};

export const upsertProposal = async (
  shop: string,
  data: {
    id?: string;
    locationSetId: string;
    locationId: string;
    leasingValue: number | null;
    currency: string | null;
    notes: string | null;
    fileName?: string | null;
    fileType?: string | null;
    fileSize?: number | null;
    fileData?: Buffer | null;
  },
): Promise<LocationProposal> => {
  const selectFields = {
    id: true,
    locationSetId: true,
    locationId: true,
    leasingValue: true,
    currency: true,
    notes: true,
    fileName: true,
    fileType: true,
    fileSize: true,
    createdAt: true,
  };

  if (data.id) {
    const updateData: Record<string, unknown> = {
      leasingValue: data.leasingValue,
      currency: data.currency,
      notes: data.notes,
    };
    if (data.fileData !== undefined) {
      updateData.fileName = data.fileName ?? null;
      updateData.fileType = data.fileType ?? null;
      updateData.fileSize = data.fileSize ?? null;
      updateData.fileData = data.fileData;
    }
    const row = await prisma.retailLocationProposal.update({
      where: { id: data.id },
      data: updateData,
      select: selectFields,
    });
    return { ...row, createdAt: row.createdAt.toISOString() };
  }

  const row = await prisma.retailLocationProposal.create({
    data: {
      shop,
      locationSetId: data.locationSetId,
      locationId: data.locationId,
      leasingValue: data.leasingValue,
      currency: data.currency,
      notes: data.notes,
      fileName: data.fileName ?? null,
      fileType: data.fileType ?? null,
      fileSize: data.fileSize ?? null,
      fileData: data.fileData ? (data.fileData as unknown as Uint8Array<ArrayBuffer>) : null,
    },
    select: selectFields,
  });
  return { ...row, createdAt: row.createdAt.toISOString() };
};

export const deleteProposal = async (
  shop: string,
  proposalId: string,
): Promise<void> => {
  await prisma.retailLocationProposal.deleteMany({
    where: { id: proposalId, shop },
  });
};

export const readProposalFile = async (
  shop: string,
  proposalId: string,
): Promise<{ fileData: Buffer; fileName: string; fileType: string } | null> => {
  const row = await prisma.retailLocationProposal.findFirst({
    where: { id: proposalId, shop },
    select: { fileData: true, fileName: true, fileType: true },
  });
  if (!row || !row.fileData || !row.fileName || !row.fileType) return null;
  return {
    fileData: Buffer.from(row.fileData),
    fileName: row.fileName,
    fileType: row.fileType,
  };
};

/* ── Stats Config ── */

export type StatsConfig = {
  showNeighborhood: boolean;
  radii: { value: number; enabled: boolean }[];
  customRadiusKm: number | null;
  radiusUnit?: "km" | "mi";
  qualitative: {
    predominantAudience: boolean;
    tenantMix: boolean;
    subjectiveFit: boolean;
    customCriteria: string | null;
  };
};

export const DEFAULT_STATS_CONFIG: StatsConfig = {
  showNeighborhood: true,
  radii: [
    { value: 5, enabled: true },
    { value: 10, enabled: true },
    { value: 15, enabled: true },
    { value: 20, enabled: true },
  ],
  customRadiusKm: null,
  radiusUnit: "km",
  qualitative: {
    predominantAudience: true,
    tenantMix: true,
    subjectiveFit: true,
    customCriteria: null,
  },
};

export const readStatsConfig = async (
  shop: string,
  setId?: string | null,
): Promise<StatsConfig> => {
  const row = await prisma.retailStatsConfig.findFirst({
    where: { shop, setId: setId ?? null },
    select: { data: true },
  });
  if (!row) return { ...DEFAULT_STATS_CONFIG };
  return row.data as StatsConfig;
};

export const writeStatsConfig = async (
  shop: string,
  setId: string | null,
  config: StatsConfig,
): Promise<void> => {
  await prisma.retailStatsConfig.upsert({
    where: { shop_setId: { shop, setId: setId ?? "" } },
    create: { shop, setId: setId ?? "", data: config as any },
    update: { data: config as any },
  });
};

export const resetStatsConfig = async (
  shop: string,
  setId: string | null,
): Promise<void> => {
  await prisma.retailStatsConfig.deleteMany({
    where: { shop, setId },
  });
};

// ─── Analytics sync status ────────────────────────────────────────────────────

export type SyncStatusRecord = {
  status: "idle" | "running" | "failed";
  errorMessage: string | null;
  updatedAt: string | null;
  phase: "customers" | "orders" | null;
  progressCount: number | null;
  startedAt: string | null;
  lastCustomersTotal: number | null;
  lastOrdersTotal: number | null;
};

export const readSyncStatus = async (shop: string): Promise<SyncStatusRecord> => {
  const row = await prisma.retailAnalyticsSyncStatus.findUnique({ where: { shop } });
  if (!row) return { status: "idle", errorMessage: null, updatedAt: null, phase: null, progressCount: null, startedAt: null, lastCustomersTotal: null, lastOrdersTotal: null };
  return {
    status: row.status as SyncStatusRecord["status"],
    errorMessage: row.errorMessage ?? null,
    updatedAt: row.updatedAt.toISOString(),
    phase: (row.phase as "customers" | "orders" | null) ?? null,
    progressCount: row.progressCount ?? null,
    startedAt: (row as any).startedAt ? new Date((row as any).startedAt).toISOString() : null,
    lastCustomersTotal: (row as any).lastCustomersTotal ?? null,
    lastOrdersTotal: (row as any).lastOrdersTotal ?? null,
  };
};

export const writeSyncStatus = async (
  shop: string,
  status: "idle" | "running" | "failed",
  errorMessage?: string | null,
  totals?: { customers: number; orders: number },
): Promise<void> => {
  const data: Record<string, unknown> = { status, errorMessage: errorMessage ?? null };
  if (status === "running") {
    data.startedAt = new Date();
    data.phase = null;
    data.progressCount = null;
  }
  if (status === "idle") {
    data.phase = null;
    data.progressCount = null;
    if (totals) {
      data.lastCustomersTotal = totals.customers;
      data.lastOrdersTotal = totals.orders;
    }
  }
  await prisma.retailAnalyticsSyncStatus.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
};

export const writeSyncProgress = async (
  shop: string,
  phase: "customers" | "orders",
  count: number,
): Promise<void> => {
  await prisma.retailAnalyticsSyncStatus.upsert({
    where: { shop },
    create: { shop, status: "running", phase, progressCount: count },
    update: { phase, progressCount: count },
  });
};
