/**
 * lalamove-special-requests.server.ts
 *
 * Shared helper used by every Lalamove dispatch path (manual dispatch, auto-
 * delivery cron, escalation reorder) to resolve the list of special request
 * keys to forward to Lalamove for a given shop + location.
 *
 * Reads the per-market configuration from `CarrierServiceConfig.data.lalamoveSpecialRequests`
 * and passes it through `resolveSpecialRequestsForCity` so per-city/service
 * filtering stays in one place.
 *
 * Never throws — returns `[]` on any failure so a misconfiguration can't block
 * a dispatch.
 */

import prisma from "../db.server";
import {
  resolveSpecialRequestsForCity,
  type LalamoveCredentials,
} from "./lalamove.server";
import type { CarrierServiceConfigData } from "./carrier/types";

export async function resolveConfiguredSpecialRequests(
  shop: string,
  config: { market: string; city?: string | null; preferredServiceType?: string },
  credentials: LalamoveCredentials,
): Promise<string[]> {
  try {
    const row = await prisma.carrierServiceConfig.findUnique({ where: { shop } });
    const carrierConfig = row?.data as CarrierServiceConfigData | undefined;
    const configured = carrierConfig?.lalamoveSpecialRequests?.[config.market] ?? [];

    if (configured.length === 0) {
      console.info(
        `[lalamove:special-requests] shop=${shop} market=${config.market} city=${config.city ?? "?"} configured=0 resolved=0`,
      );
      return [];
    }

    const resolved = await resolveSpecialRequestsForCity(configured, config, credentials);
    console.info(
      `[lalamove:special-requests] shop=${shop} market=${config.market} city=${config.city ?? "?"} configured=${configured.length} resolved=${resolved.length} keys=[${resolved.join(", ")}]`,
    );
    return resolved;
  } catch (err) {
    console.warn(
      `[lalamove:special-requests] shop=${shop} market=${config.market} FAILED — returning empty`,
      err,
    );
    return [];
  }
}
