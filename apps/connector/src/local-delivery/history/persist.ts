import type { Prisma } from "@prisma/client-connector";
import { prisma } from "../../db/prisma.js";
import type { FetchBatch } from "./fetch.js";

/**
 * Persist a fetched batch to `LdSimBatch`. Idempotent — uses
 * (tenantId, date, locationId) as the conflict key.
 */
export async function upsertBatch(
  tenantId: string,
  batch: FetchBatch,
): Promise<{ id: number; created: boolean }> {
  const payload: Prisma.InputJsonValue = {
    orders: batch.orders,
    routes: batch.routes,
  } as unknown as Prisma.InputJsonValue;

  const existing = await prisma.ldSimBatch.findUnique({
    where: {
      tenantId_date_locationId: {
        tenantId,
        date: batch.date,
        locationId: batch.locationId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.ldSimBatch.update({
      where: { id: existing.id },
      data: {
        locationName: batch.locationName,
        pickupLat: batch.pickupLat,
        pickupLng: batch.pickupLng,
        payload,
      },
    });
    return { id: existing.id, created: false };
  }

  const row = await prisma.ldSimBatch.create({
    data: {
      tenantId,
      date: batch.date,
      locationId: batch.locationId,
      locationName: batch.locationName,
      pickupLat: batch.pickupLat,
      pickupLng: batch.pickupLng,
      payload,
    },
    select: { id: true },
  });
  return { id: row.id, created: true };
}

/** Persist many batches sequentially (Postgres idempotent — fine to repeat). */
export async function upsertBatches(
  tenantId: string,
  batches: FetchBatch[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const b of batches) {
    const r = await upsertBatch(tenantId, b);
    if (r.created) created += 1;
    else updated += 1;
  }
  return { created, updated };
}
