/**
 * Shop Ingest — canonical customer write path.
 *
 * Same pattern as orders.server.ts: one canonicalizer that accepts either
 * a REST webhook payload (snake_case) or a GraphQL node (camelCase), and
 * one idempotent upsert. Feature tables (RetailCustomer etc.) still run
 * alongside during shadow mode.
 */

import prisma from "../../db.server";
import { toJsonInput, toJsonArrayInput } from "./json-helpers";

export type ShopCustomerIngestSource = "webhook" | "reconcile" | "backfill";

type UnknownRecord = Record<string, unknown>;

const asString = (v: unknown): string | null => {
  if (v == null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return null;
};

const asNumber = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asDate = (v: unknown): Date | null => {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
};

const asInt = (v: unknown): number | null => {
  const n = asNumber(v);
  if (n == null) return null;
  return Math.trunc(n);
};

const parseTags = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
};

export function canonicalizeCustomerPayload(
  shop: string,
  payload: UnknownRecord,
  source: ShopCustomerIngestSource,
): {
  shop: string;
  id: string;
  legacyId: string | null;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date | null;
  shopifyUpdatedAt: Date;
  ordersCount: number | null;
  totalSpent: number | null;
  defaultAddressJson: UnknownRecord | null;
  addressesJson: UnknownRecord[] | null;
  tagsJson: string[];
  ingestedVia: ShopCustomerIngestSource;
} | null {
  const idRaw = payload.admin_graphql_api_id ?? payload.id;
  const id = asString(idRaw);
  if (!id) return null;
  const gid = id.startsWith("gid://shopify/Customer/")
    ? id
    : `gid://shopify/Customer/${id}`;

  const legacyId = payload.id != null ? asString(payload.id) : null;

  const createdAt = asDate(
    (payload as UnknownRecord).created_at ?? (payload as UnknownRecord).createdAt,
  );
  const shopifyUpdatedAt =
    asDate(
      (payload as UnknownRecord).updated_at ??
        (payload as UnknownRecord).updatedAt,
    ) ??
    createdAt ??
    new Date();

  const firstName = asString(
    (payload as UnknownRecord).first_name ??
      (payload as UnknownRecord).firstName,
  );
  const lastName = asString(
    (payload as UnknownRecord).last_name ??
      (payload as UnknownRecord).lastName,
  );
  const displayName =
    asString(
      (payload as UnknownRecord).displayName ??
        (payload as UnknownRecord).display_name,
    ) ??
    ([firstName, lastName].filter(Boolean).join(" ").trim() || null);

  const ordersCount =
    asInt(
      (payload as UnknownRecord).orders_count ??
        (payload as UnknownRecord).ordersCount ??
        (payload as UnknownRecord).numberOfOrders,
    );

  // total_spent is a string in REST, a money object in GraphQL.
  let totalSpent: number | null = asNumber(
    (payload as UnknownRecord).total_spent,
  );
  if (totalSpent == null) {
    const amountSpent = (payload as UnknownRecord).amountSpent as
      | UnknownRecord
      | null
      | undefined;
    if (amountSpent && typeof amountSpent === "object") {
      totalSpent = asNumber(amountSpent.amount);
    }
  }

  const defaultAddressRaw =
    ((payload as UnknownRecord).default_address as UnknownRecord | null) ??
    ((payload as UnknownRecord).defaultAddress as UnknownRecord | null) ??
    null;
  const defaultAddressJson = defaultAddressRaw;

  const addressesRaw =
    (payload as UnknownRecord).addresses ??
    ((payload as UnknownRecord).addresses as unknown[]);
  const addressesJson = Array.isArray(addressesRaw)
    ? (addressesRaw as UnknownRecord[])
    : null;

  return {
    shop,
    id: gid,
    legacyId,
    email: asString((payload as UnknownRecord).email),
    phone: asString((payload as UnknownRecord).phone),
    displayName,
    firstName,
    lastName,
    createdAt,
    shopifyUpdatedAt,
    ordersCount,
    totalSpent,
    defaultAddressJson,
    addressesJson,
    tagsJson: parseTags((payload as UnknownRecord).tags),
    ingestedVia: source,
  };
}

export async function ingestCustomer(
  shop: string,
  payload: UnknownRecord,
  source: ShopCustomerIngestSource,
): Promise<{ ok: boolean; id: string | null; reason?: string }> {
  const row = canonicalizeCustomerPayload(shop, payload, source);
  if (!row) return { ok: false, id: null, reason: "canonicalize-failed" };

  try {
    const jsonFields = {
      defaultAddressJson: toJsonInput(row.defaultAddressJson),
      addressesJson: toJsonArrayInput(row.addressesJson),
      tagsJson: toJsonArrayInput(row.tagsJson) ?? [],
    };
    await prisma.shopCustomer.upsert({
      where: { shop_id: { shop: row.shop, id: row.id } },
      create: {
        shop: row.shop,
        id: row.id,
        legacyId: row.legacyId,
        email: row.email,
        phone: row.phone,
        displayName: row.displayName,
        firstName: row.firstName,
        lastName: row.lastName,
        createdAt: row.createdAt,
        shopifyUpdatedAt: row.shopifyUpdatedAt,
        ordersCount: row.ordersCount,
        totalSpent: row.totalSpent,
        ingestedVia: row.ingestedVia,
        ...jsonFields,
      },
      update: {
        legacyId: row.legacyId,
        email: row.email,
        phone: row.phone,
        displayName: row.displayName,
        firstName: row.firstName,
        lastName: row.lastName,
        createdAt: row.createdAt,
        shopifyUpdatedAt: row.shopifyUpdatedAt,
        ordersCount: row.ordersCount,
        totalSpent: row.totalSpent,
        ingestedVia: row.ingestedVia,
        ...jsonFields,
      },
    });

    await prisma.shopIngestMeta.upsert({
      where: { shop },
      create: {
        shop,
        customersLastSeenUpdatedAt: row.shopifyUpdatedAt,
      },
      update: {
        customersLastSeenUpdatedAt: row.shopifyUpdatedAt,
      },
    });

    return { ok: true, id: row.id };
  } catch (err) {
    console.error(
      `[shop-ingest:customers] upsert FAILED shop=${shop} customerId=${row.id}`,
      err,
    );
    return { ok: false, id: row.id, reason: "db-error" };
  }
}

export async function deleteIngestedCustomer(
  shop: string,
  customerId: string,
): Promise<void> {
  const gid = customerId.startsWith("gid://shopify/Customer/")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;
  await prisma.shopCustomer
    .delete({ where: { shop_id: { shop, id: gid } } })
    .catch(() => {
      // swallow — delete-on-missing is fine
    });
}
