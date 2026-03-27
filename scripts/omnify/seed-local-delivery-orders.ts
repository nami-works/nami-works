import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

type AddressRow = {
  address1: string;
  address2: string;
  company: string;
  city: string;
  zip: string;
  province: string;
  country: string;
};

type LocalOrderJson = {
  order?: {
    currency?: string;
    shipping_lines?: Array<{
      title?: string;
      code?: string | null;
      source?: string | null;
      price?: string;
    }>;
    shipping_address?: { company?: string | null };
    billing_address?: { company?: string | null };
  };
};

type CsvOrderLine = {
  sku: string;
  name: string;
  price: string;
  quantity: number;
};

type CsvOrderSeed = {
  name: string;
  email: string;
  currency: string;
  shippingAmount: string;
  discountAmount: string;
  discountCode: string;
  shippingMethod: string;
  createdAt: string;
  tags: string[];
  billing: {
    name: string;
    company: string;
    address1: string;
    address2: string;
    city: string;
    zip: string;
    province: string;
    country: string;
    phone: string;
  };
  shipping: {
    name: string;
    company: string;
    address1: string;
    address2: string;
    city: string;
    zip: string;
    province: string;
    country: string;
    phone: string;
  };
  lineitems: CsvOrderLine[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-10";
const SHOP_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.SHOPIFY_SHOP_DOMAIN ||
  process.env.SHOPIFY_STORE ||
  "";
const ADMIN_TOKEN =
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ||
  process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN ||
  process.env.SHOPIFY_ACCESS_TOKEN ||
  "";
const LOCAL_DELIVERY_RADIUS_KM = Number(
  process.env.LOCAL_DELIVERY_RADIUS_KM || "30",
);


const args = process.argv.slice(2);
const limitArg = args.find((arg) => arg.startsWith("--limit="));
const countPerZipArg = args.find((arg) => arg.startsWith("--count-per-zip="));
const dryRun = args.includes("--dry-run");
const verify = args.includes("--verify");
const introspectLocalizedFields = args.includes("--introspect-localized-fields");
const shippingArg = args.find((arg) => arg.startsWith("--shipping="));
const shippingMode = (
  shippingArg ? shippingArg.split("=")[1] : "local"
) as "local" | "regular" | "mixed";
const csvArg = args.find((arg) => arg.startsWith("--csv="));
const csvDirArg = args.find((arg) => arg.startsWith("--csv-dir="));
const maxOrdersArg = args.find((arg) => arg.startsWith("--max-orders="));
const progressFileArg = args.find((arg) => arg.startsWith("--progress-file="));
const resetProgress = args.includes("--reset-progress");
const debugRouting = args.includes("--debug-routing");
const completeDraft = args.includes("--complete");
const keepLocalDrafts = args.includes("--keep-local-drafts");

const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const countPerZip = countPerZipArg
  ? Number(countPerZipArg.split("=")[1])
  : undefined;
const maxOrders = maxOrdersArg ? Number(maxOrdersArg.split("=")[1]) : undefined;
const progressFile = progressFileArg
  ? path.resolve(process.cwd(), progressFileArg.split("=")[1] || "")
  : path.resolve(__dirname, "..", "storage", "seed-progress.json");

const requireEnv = () => {
  if (!SHOP_DOMAIN) {
    throw new Error(
      "Missing SHOPIFY_STORE_DOMAIN. Example: nami-works.myshopify.com",
    );
  }
  if (!ADMIN_TOKEN) {
    throw new Error(
      "Missing SHOPIFY_ADMIN_ACCESS_TOKEN (or SHOPIFY_ADMIN_API_ACCESS_TOKEN).",
    );
  }
};

const readJson = async <T>(relativePath: string): Promise<T> => {
  const filePath = path.resolve(__dirname, "..", relativePath);
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
};

const parseCsvRows = (raw: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    const next = raw[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.length > 1 || row.some((value) => value.trim())) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
};

const parseCsv = (raw: string): AddressRow[] => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split(";").map((value) => value.trim());

  const headerIndex = (name: string) => headers.indexOf(name);
  const get = (cols: string[], name: string) => {
    const idx = headerIndex(name);
    return idx >= 0 ? cols[idx]?.trim() ?? "" : "";
  };

  return lines.slice(1).map((line) => {
    const cols = line.split(";");
    return {
      address1: get(cols, "Shipping Address1"),
      address2: get(cols, "Shipping Address2"),
      company: get(cols, "Shipping Company"),
      city: get(cols, "Shipping City"),
      zip: get(cols, "Shipping Zip"),
      province: get(cols, "Shipping Province"),
      country: get(cols, "Shipping Country"),
    };
  });
};

type SeedProgress = {
  lastSeededOrderName: string | null;
  seededOrderNames: string[];
};

const loadSeedProgress = async (): Promise<SeedProgress> => {
  try {
    const raw = await fs.readFile(progressFile, "utf-8");
    try {
      const parsed = JSON.parse(raw) as SeedProgress;
      const seededOrderNames = Array.isArray(parsed.seededOrderNames)
        ? parsed.seededOrderNames.filter((name) => typeof name === "string")
        : [];
      if (!seededOrderNames.length && parsed.lastSeededOrderName) {
        seededOrderNames.push(parsed.lastSeededOrderName);
      }
      return {
        lastSeededOrderName:
          typeof parsed.lastSeededOrderName === "string"
            ? parsed.lastSeededOrderName
            : null,
        seededOrderNames,
      };
    } catch {
      const fallback = { lastSeededOrderName: null, seededOrderNames: [] };
      await saveSeedProgress(fallback);
      return fallback;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { lastSeededOrderName: null, seededOrderNames: [] };
    }
    throw error;
  }
};

const saveSeedProgress = async (progress: SeedProgress) => {
  await fs.mkdir(path.dirname(progressFile), { recursive: true });
  await fs.writeFile(progressFile, JSON.stringify(progress, null, 2));
};

const isRetryableStatus = (status: number) =>
  status === 429 || (status >= 500 && status <= 599);

const isRetryableNetworkError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND"
  );
};

const shopifyGraphql = async <T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> => {
  const maxRetries = 8;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
  const response = await fetch(
    `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ADMIN_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

      if (!response.ok) {
        const retryAfter = response.headers.get("Retry-After");
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          const retryDelayMs = retryAfter
            ? Number(retryAfter) * 1000
            : 1000 * Math.pow(2, attempt);
          console.warn(
            `Shopify API ${response.status} - retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${maxRetries}).`,
          );
          await sleep(retryDelayMs + Math.round(Math.random() * 250));
          continue;
        }
        throw new Error(`Shopify API error: ${response.status}`);
      }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  if (!payload.data) {
    throw new Error("Shopify API returned no data.");
  }
  return payload.data;
    } catch (error) {
      if (attempt >= maxRetries || !isRetryableNetworkError(error)) {
        throw error;
      }
      const retryDelayMs = 1000 * Math.pow(2, attempt);
      console.warn(
        `Network error - retrying in ${retryDelayMs}ms (attempt ${attempt + 1}/${maxRetries}).`,
      );
      await sleep(retryDelayMs + Math.round(Math.random() * 250));
    }
  }

  throw new Error("Shopify API request failed after retries.");
};

const runLocalizedFieldIntrospection = async () => {
  const data = await shopifyGraphql<{
    localizedFieldInput: {
      inputFields: Array<{
        name: string;
        type: {
          kind: string;
          name: string | null;
          ofType: { kind: string; name: string | null; ofType: any | null } | null;
        };
      }>;
    } | null;
    localizedFieldKey: {
      kind: string;
      enumValues: Array<{ name: string }>;
    } | null;
    localizedFieldPurpose: {
      kind: string;
      enumValues: Array<{ name: string }>;
    } | null;
    draftOrderInput: {
      inputFields: Array<{
        name: string;
        type: {
          kind: string;
          name: string | null;
          ofType: { kind: string; name: string | null; ofType: any | null } | null;
        };
      }>;
    } | null;
  }>(
    `#graphql
      query LocalizedFieldIntrospection {
        localizedFieldInput: __type(name: "LocalizedFieldInput") {
          inputFields {
            name
            type {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
        localizedFieldKey: __type(name: "LocalizedFieldKey") {
          kind
          enumValues {
            name
          }
        }
        localizedFieldPurpose: __type(name: "LocalizedFieldPurpose") {
          kind
          enumValues {
            name
          }
        }
        draftOrderInput: __type(name: "DraftOrderInput") {
          inputFields {
            name
            type {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
        }
      }
    `,
  );

  console.log("LocalizedFieldInput:");
  console.log(JSON.stringify(data.localizedFieldInput, null, 2));
  console.log("LocalizedFieldKey:");
  console.log(JSON.stringify(data.localizedFieldKey, null, 2));
  console.log("LocalizedFieldPurpose:");
  console.log(JSON.stringify(data.localizedFieldPurpose, null, 2));
  console.log("DraftOrderInput fields:");
  console.log(JSON.stringify(data.draftOrderInput, null, 2));
};

const splitName = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
};

const parseMoney = (value: string) => {
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(",", ".");
  const amount = Number.parseFloat(cleaned);
  if (Number.isNaN(amount)) return "0.00";
  return amount.toFixed(2);
};

const parseCreatedAt = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
};

const maskEmail = (email: string) => {
  const trimmed = email.trim();
  if (!trimmed) return "";
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (local.length <= 5) return `*****@${domain}`;
  return `${local.slice(0, -5)}*****@${domain}`;
};

const loadCsvOrders = async (filePaths: string[]) => {
  const orders = new Map<string, CsvOrderSeed>();

  for (const filePath of filePaths) {
    const raw = await fs.readFile(filePath, "utf-8");
    const rows = parseCsvRows(raw);
    if (rows.length < 2) continue;
    const headers = rows[0].map((header) => header.trim());
    const indexOf = (name: string) => headers.indexOf(name);

    for (const row of rows.slice(1)) {
      if (!row.length) continue;
      const get = (name: string) => row[indexOf(name)]?.trim() ?? "";
      const orderName = get("Name") || get("Id");
      if (!orderName) continue;

      const seed =
        orders.get(orderName) ||
        ({
          name: orderName,
          email: maskEmail(get("Email")),
          currency: get("Currency") || "BRL",
          shippingAmount: parseMoney(get("Shipping")),
          discountAmount: parseMoney(get("Discount Amount")),
          discountCode: get("Discount Code"),
          shippingMethod: get("Shipping Method"),
          createdAt: get("Created at"),
          tags: get("Tags")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          billing: {
            name: get("Billing Name"),
            company: get("Billing Company"),
            address1: get("Billing Address1") || get("Billing Street"),
            address2: get("Billing Address2"),
            city: get("Billing City"),
            zip: get("Billing Zip"),
            province: get("Billing Province"),
            country: get("Billing Country"),
            phone: get("Billing Phone"),
          },
          shipping: {
            name: get("Shipping Name"),
            company: get("Shipping Company"),
            address1: get("Shipping Address1") || get("Shipping Street"),
            address2: get("Shipping Address2"),
            city: get("Shipping City"),
            zip: get("Shipping Zip"),
            province: get("Shipping Province"),
            country: get("Shipping Country"),
            phone: get("Shipping Phone"),
          },
          lineitems: [],
        } as CsvOrderSeed);

      if (
        seed.shippingMethod &&
        /local/i.test(seed.shippingMethod) &&
        !seed.tags.includes("LOCAL")
      ) {
        seed.tags.push("LOCAL");
      }

      const lineitem: CsvOrderLine = {
        sku: get("Lineitem sku"),
        name: get("Lineitem name"),
        price: parseMoney(get("Lineitem price")),
        quantity: Number.parseInt(get("Lineitem quantity") || "1", 10) || 1,
      };

      if (lineitem.name) {
        seed.lineitems.push(lineitem);
      }

      orders.set(orderName, seed);
    }
  }

  return Array.from(orders.values());
};

const resolveCsvPaths = async () => {
  if (csvArg) {
    return csvArg
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => path.resolve(__dirname, "..", value));
  }
  if (csvDirArg) {
    const dirValue = csvDirArg.split("=")[1]?.trim();
    if (!dirValue) return [];
    const dirPath = path.resolve(__dirname, "..", dirValue);
    const entries = await fs.readdir(dirPath);
    return entries
      .filter((entry) => entry.toLowerCase().endsWith(".csv"))
      .map((entry) => path.join(dirPath, entry));
  }
  return [];
};

const fetchVariantIdBySku = async (sku: string) => {
  if (!sku) return null;
  const data = await shopifyGraphql<{
    productVariants: { nodes: Array<{ id: string }> };
  }>(
    `#graphql
      query VariantBySku($query: String!) {
        productVariants(first: 1, query: $query) {
          nodes {
            id
          }
        }
      }
    `,
    { query: `sku:${sku}` },
  );
  return data.productVariants.nodes[0]?.id ?? null;
};

const normalizeTaxId = (value?: string | null) => {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 || digits.length === 14) {
    return digits;
  }
  return null;
};

const formatTaxId = (digits: string) => {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(
      6,
      9,
    )}-${digits.slice(9, 11)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(
      5,
      8,
    )}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
  }
  return digits;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) => {
  const earthRadius = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

type LocationWithCoords = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

type LocalDeliveryMethod = {
  name: string;
  priceAmount: string;
  currencyCode: string;
};

let cachedLocations: LocationWithCoords[] | null = null;
let cachedDeliveryProfiles:
  | Array<{
      locationIds: string[];
      methodDefinitions: Array<{
        name: string;
        priceAmount: string | null;
        currencyCode: string | null;
      }>;
    }>
  | null = null;

const fetchLocationsWithCoords = async () => {
  if (cachedLocations) return cachedLocations;
  const data = await shopifyGraphql<{
    locations: {
      nodes: Array<{
        id: string;
        name: string;
        address: { latitude: number | null; longitude: number | null } | null;
      }>;
    };
  }>(
    `#graphql
      query LocationsForRouting {
        locations(first: 50) {
          nodes {
            id
            name
            address {
              latitude
              longitude
            }
          }
        }
      }`,
  );
  cachedLocations = data.locations.nodes
    .map((location) => ({
      id: location.id,
      name: location.name,
      latitude: location.address?.latitude ?? null,
      longitude: location.address?.longitude ?? null,
    }))
    .filter(
      (location): location is LocationWithCoords =>
        location.latitude !== null && location.longitude !== null,
    );
  return cachedLocations;
};

const fetchDeliveryProfiles = async () => {
  if (cachedDeliveryProfiles) return cachedDeliveryProfiles;
  try {
    const data = await shopifyGraphql<{
      deliveryProfiles: {
        nodes: Array<{
          profileLocationGroups: Array<{
            locationGroup: { locations: Array<{ id: string }> };
            locationGroupZones: Array<{
              zone: {
                methodDefinitions: Array<{
                  name: string;
                  rateDefinition: {
                    __typename: string;
                    price?: { amount: string; currencyCode: string };
                  } | null;
                }>;
              };
            }>;
          }>;
        }>;
      };
    }>(
      `#graphql
        query DeliveryProfiles {
          deliveryProfiles(first: 20) {
            nodes {
              profileLocationGroups {
                locationGroup {
                  locations {
                    id
                  }
                }
                locationGroupZones {
                  zone {
                    methodDefinitions {
                      name
                      rateDefinition {
                        __typename
                        ... on DeliveryRateDefinition {
                          price {
                            amount
                            currencyCode
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
    );

    cachedDeliveryProfiles = data.deliveryProfiles.nodes.flatMap((profile) =>
      profile.profileLocationGroups.map((group) => ({
        locationIds: group.locationGroup.locations.map((location) => location.id),
        methodDefinitions: group.locationGroupZones.flatMap((zone) =>
          zone.zone.methodDefinitions.map((method) => ({
            name: method.name,
            priceAmount: method.rateDefinition?.price?.amount ?? null,
            currencyCode: method.rateDefinition?.price?.currencyCode ?? null,
          })),
        ),
      })),
    );
    return cachedDeliveryProfiles;
  } catch (error) {
    console.warn(
      "Delivery profiles query failed; skipping shipping method update.",
      error,
    );
    cachedDeliveryProfiles = [];
    return cachedDeliveryProfiles;
  }
};

const findLocalDeliveryMethod = async (
  locationId: string,
): Promise<LocalDeliveryMethod | null> => {
  const profiles = await fetchDeliveryProfiles();
  const group = profiles.find((entry) => entry.locationIds.includes(locationId));
  if (!group) return null;
  const method = group.methodDefinitions.find((definition) =>
    definition.name.toLowerCase().includes("local"),
  );
  if (!method) return null;
  return {
    name: method.name,
    priceAmount: method.priceAmount || "0.00",
    currencyCode: method.currencyCode || "BRL",
  };
};

const updateOrderShippingLine = async (
  orderId: string,
  method: LocalDeliveryMethod,
) => {
  const data = await shopifyGraphql<{
    order: {
      shippingLines: { nodes: Array<{ id: string }> };
    } | null;
  }>(
    `#graphql
      query OrderShippingLines($id: ID!) {
        order(id: $id) {
          shippingLines(first: 10) {
            nodes {
              id
            }
          }
        }
      }`,
    { id: orderId },
  );

  if (!data.order) {
    console.warn("Update shipping line: order not found.");
    return;
  }

  const edit = await shopifyGraphql<{
    orderEditBegin: { calculatedOrder: { id: string } | null; userErrors: any[] };
  }>(
    `#graphql
      mutation BeginOrderEdit($id: ID!) {
        orderEditBegin(id: $id) {
          calculatedOrder {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { id: orderId },
  );

  const calculatedOrderId = edit.orderEditBegin.calculatedOrder?.id;
  if (!calculatedOrderId) {
    console.warn("Update shipping line: orderEditBegin failed.");
    return;
  }

  for (const line of data.order.shippingLines.nodes) {
    await shopifyGraphql<{
      orderEditRemoveShippingLine: { userErrors: any[] };
    }>(
      `#graphql
        mutation RemoveShippingLine($id: ID!, $shippingLineId: ID!) {
          orderEditRemoveShippingLine(id: $id, shippingLineId: $shippingLineId) {
            userErrors {
              field
              message
            }
          }
        }`,
      { id: calculatedOrderId, shippingLineId: line.id },
    );
  }

  await shopifyGraphql<{
    orderEditAddShippingLine: { userErrors: any[] };
  }>(
    `#graphql
      mutation AddShippingLine($id: ID!, $shippingLine: OrderEditShippingLineInput!) {
        orderEditAddShippingLine(id: $id, shippingLine: $shippingLine) {
          userErrors {
            field
            message
          }
        }
      }`,
    {
      id: calculatedOrderId,
      shippingLine: {
        title: method.name,
        price: {
          amount: method.priceAmount,
          currencyCode: method.currencyCode,
        },
      },
    },
  );

  await shopifyGraphql<{
    orderEditCommit: { order: { id: string } | null; userErrors: any[] };
  }>(
    `#graphql
      mutation CommitOrderEdit($id: ID!) {
        orderEditCommit(id: $id) {
          order {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    { id: calculatedOrderId },
  );
};

const logRoutingDebug = async (orderId: string) => {
  const data = await shopifyGraphql<{
    order: {
      name: string;
      shippingAddress: {
        city: string | null;
        province: string | null;
        latitude: number | null;
        longitude: number | null;
      } | null;
      shippingLines: { nodes: Array<{ title: string | null; code: string | null }> };
      fulfillmentOrders: {
        nodes: Array<{
          id: string;
          deliveryMethod: { methodType: string | null; presentedName: string | null };
          assignedLocation: { location: { id: string; name: string } | null } | null;
        }>;
      };
    } | null;
  }>(
    `#graphql
      query OrderRoutingDebug($id: ID!) {
        order(id: $id) {
          name
          shippingAddress {
            city
            province
            latitude
            longitude
          }
          shippingLines(first: 3) {
            nodes {
              title
              code
            }
          }
          fulfillmentOrders(first: 10) {
            nodes {
              id
              deliveryMethod {
                methodType
                presentedName
              }
              assignedLocation {
                location {
                  id
                  name
                }
              }
            }
          }
        }
      }`,
    { id: orderId },
  );

  if (!data.order) {
    console.warn("Routing debug: order not found.");
    return;
  }

  const shipping = data.order.shippingAddress;
  console.log(
    `Routing debug ${data.order.name}: shippingLines=${data.order.shippingLines.nodes
      .map((line) => line.title || line.code || "unknown")
      .join(", ")}`,
  );
  data.order.fulfillmentOrders.nodes.forEach((fulfillment) => {
    console.log(
      `Routing debug fulfillment ${fulfillment.id}: method=${fulfillment.deliveryMethod?.methodType} (${fulfillment.deliveryMethod?.presentedName}) location=${fulfillment.assignedLocation?.location?.name ?? "unassigned"}`,
    );
  });

  if (shipping?.latitude == null || shipping.longitude == null) {
    console.log("Routing debug: shipping coordinates missing.");
    return;
  }

  const locations = await fetchLocationsWithCoords();
  if (locations.length === 0) {
    console.log("Routing debug: no locations with coordinates found.");
    return;
  }

  const distances = locations
    .map((location) => ({
      ...location,
      distanceKm: haversineKm(
        shipping.latitude!,
        shipping.longitude!,
        location.latitude,
        location.longitude,
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 5);

  console.log(
    `Routing debug: nearest locations to ${shipping.city ?? "unknown"}, ${
      shipping.province ?? "unknown"
    }`,
  );
  distances.forEach((location) => {
    console.log(
      `- ${location.name} (${location.id}): ${location.distanceKm.toFixed(2)} km`,
    );
  });
};

const moveFulfillmentToNearestLocation = async (orderId: string) => {
  const data = await shopifyGraphql<{
    order: {
      name: string;
      shippingAddress: {
        city: string | null;
        province: string | null;
        latitude: number | null;
        longitude: number | null;
      } | null;
      fulfillmentOrders: {
        nodes: Array<{
          id: string;
          assignedLocation: { location: { id: string; name: string } | null } | null;
        }>;
      };
    } | null;
  }>(
    `#graphql
      query OrderForMove($id: ID!) {
        order(id: $id) {
          name
          shippingAddress {
            city
            province
            latitude
            longitude
          }
          fulfillmentOrders(first: 10) {
            nodes {
              id
              assignedLocation {
                location {
                  id
                  name
                }
              }
            }
          }
        }
      }`,
    { id: orderId },
  );

  if (!data.order) {
    console.warn("Move fulfillment: order not found.");
    return;
  }

  const shipping = data.order.shippingAddress;
  if (shipping?.latitude == null || shipping.longitude == null) {
    console.log(
      `Move fulfillment: missing coordinates for ${data.order.name} (${shipping?.city ?? "unknown"}, ${shipping?.province ?? "unknown"}).`,
    );
    return;
  }

  const locations = await fetchLocationsWithCoords();
  if (locations.length === 0) {
    console.log("Move fulfillment: no locations with coordinates found.");
    return;
  }

  const nearest = locations
    .map((location) => ({
      ...location,
      distanceKm: haversineKm(
        shipping.latitude!,
        shipping.longitude!,
        location.latitude,
        location.longitude,
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];

  if (!nearest) return;

  for (const fulfillment of data.order.fulfillmentOrders.nodes) {
    const currentId = fulfillment.assignedLocation?.location?.id ?? null;
    if (currentId === nearest.id) {
      continue;
    }
    const moveData = await shopifyGraphql<{
      fulfillmentOrderMove: {
        movedFulfillmentOrder: { id: string } | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>(
      `#graphql
        mutation MoveFulfillment($id: ID!, $newLocationId: ID!) {
          fulfillmentOrderMove(id: $id, newLocationId: $newLocationId) {
            movedFulfillmentOrder {
              id
            }
            userErrors {
              field
              message
            }
          }
        }`,
      { id: fulfillment.id, newLocationId: nearest.id },
    );

    if (moveData.fulfillmentOrderMove.userErrors.length) {
      console.warn(
        `Move fulfillment: ${data.order.name} -> ${nearest.name} failed: ${moveData.fulfillmentOrderMove.userErrors
          .map((error) => error.message)
          .join(", ")}`,
      );
    } else {
      console.log(
        `Move fulfillment: ${data.order.name} moved to ${nearest.name} (${nearest.id}).`,
      );
    }
  }

  if (nearest.distanceKm <= LOCAL_DELIVERY_RADIUS_KM) {
    const method = await findLocalDeliveryMethod(nearest.id);
    if (method) {
      await updateOrderShippingLine(orderId, method);
      console.log(
        `Move fulfillment: ${data.order.name} shipping line set to ${method.name}.`,
      );
    } else {
      console.warn(
        `Move fulfillment: no local delivery method found for ${nearest.name}.`,
      );
    }
  }
};

const CUSTOMER_SAMPLES = [
  {
    firstName: "Lucas",
    lastName: "Guimarães",
    cpf: "07165036628",
  },
  {
    firstName: "Augusto",
    lastName: "C Guimarães",
    cpf: "96835540834",
  },
  {
    firstName: "Selma",
    lastName: "S Guimarães",
    cpf: "48111414668",
  },
];

type ShippingPreset = {
  key: "local" | "regular";
  shippingLines: Array<{
    title: string;
    code: string | null;
    source: string | null;
    price: { amount: string; currencyCode: string };
  }>;
  referenceTitle: string;
  defaultCompany: string;
};

const loadShippingPreset = async (
  key: "local" | "regular",
): Promise<ShippingPreset> => {
  const filePath =
    key === "local"
      ? "sample-data/local-delivery_order.json"
      : "sample-data/regular-delivery-order.json";
  const orderJson = await readJson<LocalOrderJson>(filePath);
  const currency = orderJson.order?.currency || "BRL";
  const shippingLine = orderJson.order?.shipping_lines?.[0];
  const defaultCompany =
    normalizeTaxId(orderJson.order?.shipping_address?.company) ||
    normalizeTaxId(orderJson.order?.billing_address?.company) ||
    "";

  if (!shippingLine) {
    const fallbackTitle = key === "local" ? "Local Delivery" : "Shipping";
    return {
      key,
      shippingLines: [
        {
          title: fallbackTitle,
          code: fallbackTitle,
          source: "shopify",
          price: { amount: "0.00", currencyCode: currency },
        },
      ],
      referenceTitle: fallbackTitle,
      defaultCompany,
    };
  }

  return {
    key,
    shippingLines: [
      {
        title: shippingLine.title || (key === "local" ? "Local Delivery" : "Shipping"),
        code: shippingLine.code || (key === "local" ? "Local Delivery" : "Shipping"),
        source: shippingLine.source || "shopify",
        price: { amount: shippingLine.price || "0.00", currencyCode: currency },
      },
    ],
    referenceTitle:
      shippingLine.title || (key === "local" ? "Local Delivery" : "Shipping"),
    defaultCompany,
  };
};

const loadAddresses = async (): Promise<AddressRow[]> => {
  const csvPath = path.resolve(__dirname, "..", "sample-data/addresses.csv");
  const raw = await fs.readFile(csvPath, "utf-8");
  return parseCsv(raw);
};

const buildSeedRows = (
  rows: AddressRow[],
  perZip?: number,
  max?: number,
) => {
  // Default: one order per CSV row.
  if (!perZip) return max ? rows.slice(0, max) : rows;
  const grouped = new Map<string, AddressRow[]>();
  rows.forEach((row) => {
    const key = row.zip || "unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  });

  const seeded: AddressRow[] = [];
  grouped.forEach((entries) => {
    const base = entries[0];
    for (let i = 0; i < perZip; i += 1) {
      seeded.push(base);
    }
  });
  return max ? seeded.slice(0, max) : seeded;
};

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const fetchVariants = async () => {
  const data = await shopifyGraphql<{
    productVariants: { nodes: Array<{ id: string }> };
  }>(
    `#graphql
      query SeedVariants {
        productVariants(first: 3) {
          nodes {
            id
          }
        }
      }
    `,
  );
  return data.productVariants.nodes;
};

const upsertCustomer = async (
  sample: {
    firstName: string;
    lastName: string;
  },
  cpfDigits?: string | null,
) => {
  const metafields = cpfDigits
    ? [
    {
      namespace: "custom",
      key: "cpf_cnpj",
      type: "single_line_text_field",
      value: cpfDigits,
    },
      ]
    : [];

  const create = await shopifyGraphql<{
    customerCreate: {
        customer: { id: string } | null;
        userErrors: Array<{ field: string[] | null; message: string }>;
      };
    }>(
      `#graphql
      mutation CreateCustomer($input: CustomerInput!) {
        customerCreate(input: $input) {
            customer {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        input: {
          firstName: sample.firstName,
          lastName: sample.lastName,
        ...(metafields.length ? { metafields } : {}),
        },
      },
    );

  if (create.customerCreate.userErrors.length) {
    const errors = create.customerCreate.userErrors
        .map((error) => error.message)
        .join(", ");
    throw new Error(`Customer create failed: ${errors}`);
  }

  if (!create.customerCreate.customer) {
    throw new Error("Customer create did not return a customer.");
  }

  return create.customerCreate.customer.id;
};

const createCustomerFromAddress = async (input: {
  firstName: string;
  lastName: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  zip: string;
  province?: string;
  country: string;
  cpfDigits?: string | null;
}) => {
  const metafields = input.cpfDigits
    ? [
        {
          namespace: "custom",
          key: "cpf_cnpj",
          type: "single_line_text_field",
          value: input.cpfDigits,
        },
      ]
    : [];
  const create = await shopifyGraphql<{
    customerCreate: {
      customer: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    `#graphql
      mutation CreateCustomer($input: CustomerInput!) {
        customerCreate(input: $input) {
          customer {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      input: {
        firstName: input.firstName,
        lastName: input.lastName,
        addresses: [
          {
            address1: input.address1,
            address2: input.address2,
            city: input.city,
            zip: input.zip,
            province: input.province,
            country: input.country,
            company: input.company,
          },
        ],
        ...(metafields.length ? { metafields } : {}),
      },
    },
  );

  if (create.customerCreate.userErrors.length) {
    const errors = create.customerCreate.userErrors
      .map((error) => error.message)
      .join(", ");
    throw new Error(`Customer create failed: ${errors}`);
  }

  if (!create.customerCreate.customer) {
    throw new Error("Customer create did not return a customer.");
  }

  return create.customerCreate.customer.id;
};

const createOrder = async (
  row: AddressRow,
  index: number,
  variantIds: string[],
  defaultCompany: string,
) => {
  const sample = CUSTOMER_SAMPLES[(index - 1) % CUSTOMER_SAMPLES.length];
  const companyDigits = normalizeTaxId(sample.cpf) || "07165036628";
  const companyValue = companyDigits;
  const customerId = await createCustomerFromAddress({
    firstName: sample.firstName,
    lastName: sample.lastName,
    company: companyValue,
    address1: row.address1,
    address2: row.address2 || undefined,
    city: row.city,
    zip: row.zip,
    province: row.province || undefined,
    country: row.country,
    cpfDigits: companyDigits,
  });
  const shippingAddress = {
    firstName: sample.firstName,
    lastName: sample.lastName,
    address1: row.address1,
    address2: row.address2 || undefined,
    city: row.city,
    zip: row.zip,
    provinceCode: row.province || undefined,
    countryCode: row.country.length === 2 ? row.country : undefined,
    country: row.country.length !== 2 ? row.country : undefined,
    company: companyValue,
    phone: undefined,
  };

  const draftInput = {
    customerId,
    shippingAddress,
    billingAddress: shippingAddress,
    localizedFields: [
      {
        key: "TAX_CREDENTIAL_BR",
        value: companyDigits,
      },
    ],
    customAttributes: [
      { key: "CPF/CNPJ", value: companyDigits },
      { key: "cpf_cnpj", value: companyDigits },
    ],
    lineItems: variantIds.map((variantId) => ({
      variantId,
      quantity: 1,
    })),
  };

  if (dryRun) {
    return { id: "dry-run", name: `#DRY${index}` };
  }

  const data = await shopifyGraphql<{
    draftOrderCreate: {
      draftOrder: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    `#graphql
      mutation SeedDraftOrder($draft: DraftOrderInput!) {
        draftOrderCreate(input: $draft) {
          draftOrder {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { draft: draftInput },
  );

  if (data.draftOrderCreate.userErrors.length) {
    const errors = data.draftOrderCreate.userErrors
      .map((error) => error.message)
      .join(", ");
    throw new Error(`Draft order create failed: ${errors}`);
  }

  if (!data.draftOrderCreate.draftOrder) {
    throw new Error("Draft order create did not return a draft order.");
  }

  if (!completeDraft) {
    return { id: data.draftOrderCreate.draftOrder.id, name: `Draft ${index}` };
  }

  const completeData = await shopifyGraphql<{
    draftOrderComplete: {
      draftOrder: {
        order: { id: string; name: string } | null;
      } | null;
      userErrors: Array<{
        field: string[] | null;
        message: string;
      }>;
    };
  }>(
    `#graphql
      mutation CompleteDraftOrder($id: ID!) {
        draftOrderComplete(id: $id, paymentPending: false) {
          draftOrder {
            order {
              id
              name
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { id: data.draftOrderCreate.draftOrder.id },
  );

  if (completeData.draftOrderComplete.userErrors.length) {
    console.error(
      "draftOrderComplete userErrors:",
      JSON.stringify(completeData.draftOrderComplete.userErrors, null, 2),
    );
    const errors = completeData.draftOrderComplete.userErrors
      .map((error) => error.message)
      .join(", ");
    throw new Error(`Draft order complete failed: ${errors}`);
  }

  const completedOrder = completeData.draftOrderComplete.draftOrder?.order;
  if (!completedOrder) {
    throw new Error("Draft order complete did not return an order.");
  }

  return completedOrder;
};

const fulfillOrder = async (orderId: string) => {
  const data = await shopifyGraphql<{
    order: {
      fulfillmentOrders: {
        nodes: Array<{
          id: string;
          lineItems: { nodes: Array<{ id: string; remainingQuantity: number }> };
        }>;
      };
    } | null;
  }>(
    `#graphql
      query SeedFulfillmentOrders($id: ID!) {
        order(id: $id) {
          fulfillmentOrders(first: 10) {
            nodes {
              id
              lineItems(first: 50) {
                nodes {
                  id
                  remainingQuantity
                }
              }
            }
          }
        }
      }
    `,
    { id: orderId },
  );

  if (!data.order) {
    throw new Error("Order not found after creation.");
  }

  const lineItemsByFulfillmentOrder = data.order.fulfillmentOrders.nodes.map(
    (fulfillmentOrder) => ({
      fulfillmentOrderId: fulfillmentOrder.id,
      fulfillmentOrderLineItems: fulfillmentOrder.lineItems.nodes.map(
        (lineItem) => ({
          id: lineItem.id,
          quantity: lineItem.remainingQuantity,
        }),
      ),
    }),
  );

  if (lineItemsByFulfillmentOrder.length === 0) {
    return;
  }

  await shopifyGraphql<{
    fulfillmentCreateV2: {
      fulfillment: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(
    `#graphql
      mutation SeedFulfillment($fulfillment: FulfillmentV2Input!) {
        fulfillmentCreateV2(fulfillment: $fulfillment) {
          fulfillment {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      fulfillment: {
        notifyCustomer: false,
        lineItemsByFulfillmentOrder,
      },
    },
  );
};

const verifyOrder = async (orderId: string) => {
  const data = await shopifyGraphql<{
    order: {
      name: string;
      shippingLines: { nodes: Array<{ title: string | null }> };
    } | null;
  }>(
    `#graphql
      query VerifyOrder($id: ID!) {
        order(id: $id) {
          name
          shippingLines(first: 10) {
            nodes {
              title
            }
          }
        }
      }
    `,
    { id: orderId },
  );

  if (!data.order) {
    throw new Error("Order not found during verification.");
  }

  const titles = data.order.shippingLines.nodes
    .map((n) => n.title ?? "(none)")
    .join(", ");
  if (data.order.shippingLines.nodes.length === 0) {
    console.warn(`Order ${data.order.name} has no shipping lines.`);
  } else {
    console.log(`Order ${data.order.name} shipping: ${titles}`);
  }
};

const main = async () => {
  requireEnv();
  if (introspectLocalizedFields) {
    await runLocalizedFieldIntrospection();
    return;
  }
  const csvPaths = await resolveCsvPaths();
  if (csvPaths.length) {
    const orders = await loadCsvOrders(csvPaths);
    if (orders.length === 0) {
      throw new Error("No CSV orders found to seed.");
    }
    const progress = await loadSeedProgress();
    if (resetProgress) {
      progress.lastSeededOrderName = null;
      progress.seededOrderNames = [];
      await saveSeedProgress(progress);
    }
    const seededOrders = new Set(progress.seededOrderNames);
    const seededWithDates = orders
      .filter((order) => seededOrders.has(order.name))
      .map((order) => parseCreatedAt(order.createdAt))
      .filter((value): value is number => value !== null);
    const newestSeededAt =
      seededWithDates.length > 0 ? Math.max(...seededWithDates) : null;
    const oldestSeededAt =
      seededWithDates.length > 0 ? Math.min(...seededWithDates) : null;
    const skuCache = new Map<string, string | null>();

    let createdCount = 0;
    for (let index = 0; index < orders.length; index += 1) {
      if (maxOrders && createdCount >= maxOrders) {
        break;
      }
      const orderSeed = orders[index];
      if (!orderSeed.name) {
        console.warn("Skipping CSV row without order name.");
        continue;
      }
      if (seededOrders.has(orderSeed.name)) {
        console.log(`Skipping ${orderSeed.name}: already seeded.`);
        continue;
      }
      if (newestSeededAt !== null && oldestSeededAt !== null) {
        const createdAt = parseCreatedAt(orderSeed.createdAt);
        if (createdAt !== null) {
          const isNewerThanNewest = createdAt > newestSeededAt;
          const isOlderThanOldest = createdAt < oldestSeededAt;
          if (!isNewerThanNewest && !isOlderThanOldest) {
            console.log(
              `Skipping ${orderSeed.name}: within seeded date window.`,
            );
            continue;
          }
        }
      }
      const billingName = splitName(orderSeed.billing.name);
      const shippingName = splitName(orderSeed.shipping.name);
      const companyRaw = orderSeed.billing.company || orderSeed.shipping.company || "";
      const companyDigits = normalizeTaxId(companyRaw) || "07165036628";
      const customer = {
        firstName: shippingName.firstName || billingName.firstName,
        lastName: shippingName.lastName || billingName.lastName,
        phone: "",
        email: "",
      };

      const shippingSource =
        orderSeed.shipping.address1 ||
        orderSeed.shipping.city ||
        orderSeed.shipping.zip ||
        orderSeed.shipping.country
          ? orderSeed.shipping
          : orderSeed.billing;
      if (shippingSource === orderSeed.billing) {
        console.warn(
          `Shipping address missing for ${orderSeed.name}; using billing address instead.`,
        );
      }
      const shippingAddressBase = {
        firstName: shippingName.firstName || billingName.firstName,
        lastName: shippingName.lastName || billingName.lastName,
        address1: shippingSource.address1,
        address2: shippingSource.address2 || undefined,
        city: shippingSource.city,
        zip: shippingSource.zip,
        provinceCode: shippingSource.province || undefined,
        countryCode:
          shippingSource.country.length === 2
            ? shippingSource.country
            : undefined,
        country:
          shippingSource.country.length !== 2
            ? shippingSource.country
            : undefined,
        phone: undefined,
      };

      const billingAddressBase = {
        firstName: billingName.firstName,
        lastName: billingName.lastName,
        address1: orderSeed.billing.address1,
        address2: orderSeed.billing.address2 || undefined,
        city: orderSeed.billing.city,
        zip: orderSeed.billing.zip,
        provinceCode: orderSeed.billing.province || undefined,
        countryCode:
          orderSeed.billing.country.length === 2
            ? orderSeed.billing.country
            : undefined,
        country:
          orderSeed.billing.country.length !== 2
            ? orderSeed.billing.country
            : undefined,
        phone: undefined,
      };

      const customerId =
        !dryRun && (shippingAddressBase.address1 || billingAddressBase.address1)
          ? await createCustomerFromAddress({
              firstName: shippingAddressBase.firstName,
              lastName: shippingAddressBase.lastName,
              company: (shippingAddressBase as any).company,
              address1:
                shippingAddressBase.address1 || billingAddressBase.address1,
              address2:
                shippingAddressBase.address2 || billingAddressBase.address2,
              city: shippingAddressBase.city || billingAddressBase.city,
              zip: shippingAddressBase.zip || billingAddressBase.zip,
              province:
                shippingAddressBase.provinceCode || billingAddressBase.provinceCode,
              country:
                shippingAddressBase.country ||
                billingAddressBase.country ||
                shippingAddressBase.countryCode ||
                billingAddressBase.countryCode ||
                "BR",
              cpfDigits: companyDigits,
            })
          : null;

      const lineItems: Array<{ variantId?: string; title?: string; quantity: number; originalUnitPrice?: string }> = [];
      for (const item of orderSeed.lineitems) {
        if (!item.name) continue;
        let variantId = null;
        if (item.sku) {
          if (!skuCache.has(item.sku)) {
            skuCache.set(item.sku, await fetchVariantIdBySku(item.sku));
          }
          variantId = skuCache.get(item.sku) || null;
        }
        if (variantId) {
          lineItems.push({ variantId, quantity: item.quantity });
        } else {
          lineItems.push({
            title: item.name,
            originalUnitPrice: item.price,
            quantity: item.quantity,
          });
        }
      }

      if (lineItems.length === 0) {
        console.warn(`Skipping ${orderSeed.name}: no line items.`);
        continue;
      }

      const discountValue = Number.parseFloat(orderSeed.discountAmount);

      const buildDraftInput = (cpfOverride?: string) => {
        const cpfValue = cpfOverride || companyDigits;
        const shippingAddress = {
          ...shippingAddressBase,
          company: cpfValue || undefined,
        };
        const billingAddress = {
          ...billingAddressBase,
          company: cpfValue || undefined,
        };

        return {
          ...(customerId ? { customerId } : {}),
          shippingAddress,
          billingAddress,
          ...(cpfValue
            ? {
                localizedFields: [
                  {
                    key: "TAX_CREDENTIAL_BR",
                    value: cpfValue,
                  },
                ],
                customAttributes: [
                  { key: "CPF/CNPJ", value: cpfValue },
                  { key: "cpf_cnpj", value: cpfValue },
                ],
              }
            : {}),
          ...(Number.isFinite(discountValue) && discountValue > 0
            ? {
                appliedDiscount: {
                  description: orderSeed.discountCode || "Discount",
                  value: discountValue,
                  valueType: "FIXED_AMOUNT",
                },
              }
            : {}),
          lineItems,
        };
      };

      if (dryRun) {
        console.log(`Dry run ${orderSeed.name}`);
        continue;
      }

      let data: any;
      const createDraft = async (cpfOverride?: string) =>
        shopifyGraphql<{
          draftOrderCreate: {
            draftOrder: { id: string } | null;
            userErrors: Array<{ field: string[] | null; message: string }>;
          };
        }>(
          `#graphql
            mutation SeedDraftOrder($draft: DraftOrderInput!) {
              draftOrderCreate(input: $draft) {
                draftOrder {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          { draft: buildDraftInput(cpfOverride) },
        );

      const getUserErrors = (payload: any) =>
        payload.draftOrderCreate.userErrors
          .map((error: { message: string }) => error.message)
          .join(", ");

      try {
        data = await createDraft();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("CPF/CNPJ")) {
          console.warn(
            `Retrying ${orderSeed.name} with fallback CPF 07165036628.`,
          );
          data = await createDraft("07165036628");
        } else {
          throw error;
        }
      }

      if (data.draftOrderCreate.userErrors.length) {
        const errors = getUserErrors(data);
        if (errors.includes("CPF/CNPJ")) {
          console.warn(
            `Retrying ${orderSeed.name} with fallback CPF 07165036628.`,
          );
          data = await createDraft("07165036628");
        } else {
          throw new Error(
            `Draft order create failed for ${orderSeed.name}: ${errors}`,
          );
        }
      }

      if (data.draftOrderCreate.userErrors.length) {
        const errors = getUserErrors(data);
        throw new Error(
          `Draft order create failed for ${orderSeed.name}: ${errors}`,
        );
      }

      const draftId = data.draftOrderCreate.draftOrder?.id;
      if (!draftId) {
        console.error(`Draft order create did not return a draft order for ${orderSeed.name}.`);
        continue;
      }

      const shouldComplete = keepLocalDrafts
        ? !orderSeed.tags.includes("LOCAL")
        : true;
      if (shouldComplete) {
        const completeData = await shopifyGraphql<{
          draftOrderComplete: {
            draftOrder: {
              order: { id: string; name: string } | null;
            } | null;
            userErrors: Array<{ field: string[] | null; message: string }>;
          };
        }>(
          `#graphql
            mutation CompleteDraftOrder($id: ID!) {
              draftOrderComplete(id: $id, paymentPending: false) {
                draftOrder {
                  order {
                    id
                    name
                  }
                }
                userErrors {
                  field
                  message
                }
              }
            }
          `,
          { id: draftId },
        );

        if (completeData.draftOrderComplete.userErrors.length) {
          const errors = completeData.draftOrderComplete.userErrors
            .map((error) => error.message)
            .join(", ");
          console.error(`Draft order complete failed for ${orderSeed.name}: ${errors}`);
          continue;
        }

        const completedOrder = completeData.draftOrderComplete.draftOrder?.order;
        if (!completedOrder) {
          console.error(`Draft order complete did not return an order for ${orderSeed.name}.`);
          continue;
        }

        await moveFulfillmentToNearestLocation(completedOrder.id);

        if (debugRouting) {
          await logRoutingDebug(completedOrder.id);
        }

        if (verify) {
          await verifyOrder(completedOrder.id);
        }

        createdCount += 1;
        console.log(`Seeded order ${completedOrder.name}`);
      } else {
        createdCount += 1;
        console.log(`Draft order created ${orderSeed.name}`);
      }
      seededOrders.add(orderSeed.name);
      progress.seededOrderNames = Array.from(seededOrders);
      progress.lastSeededOrderName = orderSeed.name;
      await saveSeedProgress(progress);
      await sleep(350);
    }
    return;
  }
  const addresses = await loadAddresses();
  const seedRows = buildSeedRows(addresses, countPerZip, limit);
  if (seedRows.length === 0) {
    throw new Error("No addresses found to seed.");
  }

  const preset = await loadShippingPreset("local");
  const variants = await fetchVariants();
  if (variants.length === 0) {
    throw new Error("No product variants found to seed line items.");
  }

  const variantIds = variants.map((variant) => variant.id);

  for (let index = 0; index < seedRows.length; index += 1) {
    const row = seedRows[index];
    const order = await createOrder(
      row,
      index + 1,
      variantIds,
      preset.defaultCompany,
    );
    if (!dryRun && completeDraft) {
      await moveFulfillmentToNearestLocation(order.id);
      await fulfillOrder(order.id);
      if (debugRouting) {
        await logRoutingDebug(order.id);
      }
      if (verify) {
        await verifyOrder(order.id);
    }
    console.log(`Seeded order ${order.name}`);
    } else {
      console.log(`Draft order ${order.name}`);
    }
    await sleep(250);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
