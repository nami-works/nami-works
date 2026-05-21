import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../../db/prisma.js";
import { getLocationConfig } from "../config.js";
import { getLalamoveCredentials } from "../credentials.js";
import {
  createLalamoveQuotation,
  type LalamoveStop,
} from "../vendored/lalamove-quote.js";
import { optimizeByCarrierQuotation } from "../vendored/optimizer.js";
import type { OptimizerOrderInput } from "../vendored/google-routes-shared.js";
import { getOrComputeRoutePolyline } from "./polylines.js";

const STATIC_DIR = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "static",
);

const STATIC_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

type BatchPayload = {
  orders: BatchOrder[];
  routes: BatchRoute[];
};

type BatchOrder = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  shippingAddress: {
    firstName: string | null;
    lastName: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    zip: string | null;
    phone: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  tags: string[];
};

type BatchRoute = {
  routeNumber: number;
  routeTag: string;
  orderIds: string[];
};

type ProposedRoute = {
  routeIndex: number;
  orderIds: string[];
};

function sendStatic(reply: FastifyReply, filePath: string): FastifyReply {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return reply.code(404).send({ error: "not found" });
  }
  const ext = extname(filePath).toLowerCase();
  const mime = STATIC_MIME[ext] ?? "application/octet-stream";
  reply.header("content-type", mime);
  return reply.send(createReadStream(filePath));
}

async function resolveTenantId(slug: string): Promise<string> {
  const tenant = await prisma.integrationTenant.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!tenant) {
    throw new Error(`tenant "${slug}" not found in DB`);
  }
  return tenant.id;
}

export async function mountLocalDeliveryRoutes(
  app: FastifyInstance,
): Promise<void> {
  const tenantSlug =
    process.env.LOCAL_DELIVERY_SIMULATOR_TENANT?.trim() || "gebeauty";

  app.log.info(
    `[local-delivery] mounting simulator at /local-delivery/simulator (tenant=${tenantSlug})`,
  );

  // ── Static UI ──────────────────────────────────────────────────────────────

  app.get("/local-delivery/simulator/", async (_req, reply) => {
    return sendStatic(reply, join(STATIC_DIR, "index.html"));
  });

  app.get<{ Params: { file: string } }>(
    "/local-delivery/simulator/static/:file",
    async (req, reply) => {
      const file = req.params.file;
      if (file.includes("..") || file.includes("/") || file.includes("\\")) {
        return reply.code(400).send({ error: "invalid path" });
      }
      return sendStatic(reply, join(STATIC_DIR, file));
    },
  );

  // ── API ────────────────────────────────────────────────────────────────────

  app.get("/local-delivery/simulator/api/config", async (_req, reply) => {
    const styles: Array<{ label: string; mapId: string }> = [];
    const push = (label: string, envVar: string) => {
      const v = process.env[envVar]?.trim();
      if (v) styles.push({ label, mapId: v });
    };
    push("Default", "GOOGLE_MAPS_MAP_ID");
    push("Light", "GOOGLE_MAPS_MAP_ID_LIGHT");
    push("Dark", "GOOGLE_MAPS_MAP_ID_DARK");
    push("Satellite", "GOOGLE_MAPS_MAP_ID_SATELLITE");
    push("Retro", "GOOGLE_MAPS_MAP_ID_RETRO");
    return reply.send({
      googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
      mapStyles: styles,
    });
  });

  app.get("/local-delivery/simulator/api/batches", async (_req, reply) => {
    const tenantId = await resolveTenantId(tenantSlug);
    const rows = await prisma.ldSimBatch.findMany({
      where: { tenantId },
      orderBy: [{ date: "desc" }, { locationName: "asc" }],
      select: {
        id: true,
        date: true,
        locationId: true,
        locationName: true,
        pickupLat: true,
        pickupLng: true,
        fetchedAt: true,
        payload: true,
      },
    });

    const summaries = rows.map((r) => {
      const payload = (r.payload ?? {
        orders: [],
        routes: [],
      }) as unknown as BatchPayload;
      const { payload: _omit, ...rest } = r;
      return {
        ...rest,
        orderCount: payload.orders.length,
        routeCount: payload.routes.length,
      };
    });

    return reply.send({ batches: summaries });
  });

  app.get<{ Params: { id: string } }>(
    "/local-delivery/simulator/api/batches/:id",
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const row = await prisma.ldSimBatch.findUnique({ where: { id } });
      if (!row) return reply.code(404).send({ error: "not found" });
      const tweaks = await prisma.ldSimTweak.findMany({
        where: { batchId: id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          proposedRoutes: true,
          proposedQuote: true,
          baselineQuote: true,
          annotation: true,
          tags: true,
          createdAt: true,
        },
      });
      return reply.send({ batch: row, tweaks });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { routes: ProposedRoute[] };
  }>("/local-delivery/simulator/api/batches/:id/quote", async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "invalid id" });
    }
    const row = await prisma.ldSimBatch.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ error: "not found" });

    const config = getLocationConfig(row.locationId);
    if (!config) {
      return reply
        .code(400)
        .send({ error: `no LalamoveConfig for location ${row.locationId}` });
    }
    if (config.data.pickupLat == null || config.data.pickupLng == null) {
      return reply
        .code(400)
        .send({ error: `pickup coords missing for ${row.locationId}` });
    }

    const tenant = await prisma.integrationTenant.findFirst({
      where: { slug: tenantSlug },
      select: { ssmPrefix: true },
    });
    if (!tenant) {
      return reply.code(500).send({ error: `tenant ${tenantSlug} not found` });
    }
    const credentials = await getLalamoveCredentials({
      ssmPrefix: tenant.ssmPrefix,
    });

    const payload = row.payload as unknown as BatchPayload;
    const orderById = new Map(payload.orders.map((o) => [o.id, o] as const));

    const perRoute: Array<
      | {
          routeIndex: number;
          orderIds: string[];
          ok: true;
          priceTotal: string;
          currency: string;
        }
      | { routeIndex: number; orderIds: string[]; ok: false; error: string }
    > = [];

    for (const r of req.body.routes) {
      const stops: LalamoveStop[] = [
        {
          coordinates: {
            lat: String(config.data.pickupLat),
            lng: String(config.data.pickupLng),
          },
          address:
            config.data.locationAddress ??
            `${config.data.pickupLat},${config.data.pickupLng}`,
        },
      ];
      let stopMissing = false;
      for (const oid of r.orderIds) {
        const o = orderById.get(oid);
        if (
          !o ||
          o.shippingAddress.latitude == null ||
          o.shippingAddress.longitude == null
        ) {
          stopMissing = true;
          break;
        }
        stops.push({
          coordinates: {
            lat: String(o.shippingAddress.latitude),
            lng: String(o.shippingAddress.longitude),
          },
          address: [
            o.shippingAddress.address1,
            o.shippingAddress.address2,
            o.shippingAddress.city,
            o.shippingAddress.zip,
            o.shippingAddress.country,
          ]
            .filter(Boolean)
            .join(", "),
        });
      }
      if (stopMissing || stops.length < 2) {
        perRoute.push({
          routeIndex: r.routeIndex,
          orderIds: r.orderIds,
          ok: false,
          error: "missing stop coordinates",
        });
        continue;
      }
      try {
        const q = await createLalamoveQuotation(
          {
            market: config.data.market,
            language: config.data.language,
            serviceType: config.data.preferredServiceType,
            stops,
            isRouteOptimized: false,
          },
          credentials,
        );
        perRoute.push({
          routeIndex: r.routeIndex,
          orderIds: r.orderIds,
          ok: true,
          priceTotal: q.priceBreakdown?.total ?? "0",
          currency: q.priceBreakdown?.currency ?? "BRL",
        });
      } catch (e) {
        perRoute.push({
          routeIndex: r.routeIndex,
          orderIds: r.orderIds,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const total = perRoute.reduce(
      (sum, r) => (r.ok ? sum + parseFloat(r.priceTotal || "0") : sum),
      0,
    );
    const currency = perRoute.find((r) => r.ok)?.currency ?? "BRL";
    return reply.send({ routes: perRoute, total: total.toFixed(2), currency });
  });

  app.post<{ Params: { id: string } }>(
    "/local-delivery/simulator/api/batches/:id/optimize",
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const row = await prisma.ldSimBatch.findUnique({ where: { id } });
      if (!row) return reply.code(404).send({ error: "not found" });

      const config = getLocationConfig(row.locationId);
      if (!config) {
        return reply
          .code(400)
          .send({ error: `no LalamoveConfig for location ${row.locationId}` });
      }
      if (config.data.pickupLat == null || config.data.pickupLng == null) {
        return reply
          .code(400)
          .send({ error: `pickup coords missing for ${row.locationId}` });
      }

      const tenant = await prisma.integrationTenant.findFirst({
        where: { slug: tenantSlug },
        select: { ssmPrefix: true },
      });
      if (!tenant) {
        return reply.code(500).send({ error: `tenant ${tenantSlug} not found` });
      }
      const credentials = await getLalamoveCredentials({
        ssmPrefix: tenant.ssmPrefix,
      });

      const payload = row.payload as unknown as BatchPayload;
      const inputs: OptimizerOrderInput[] = [];
      const skipped: string[] = [];
      for (const o of payload.orders) {
        if (
          o.shippingAddress.latitude == null ||
          o.shippingAddress.longitude == null
        ) {
          skipped.push(o.id);
          continue;
        }
        inputs.push({
          orderId: o.id,
          locationId: row.locationId,
          shippingCoordinates: {
            latitude: o.shippingAddress.latitude,
            longitude: o.shippingAddress.longitude,
          },
          locationCoordinates: {
            latitude: config.data.pickupLat,
            longitude: config.data.pickupLng,
          },
        });
      }

      if (inputs.length === 0) {
        return reply
          .code(400)
          .send({ error: "no orders with coordinates", skipped });
      }

      const result = await optimizeByCarrierQuotation(
        inputs,
        config.data,
        credentials,
        Math.max(1, Math.min(10, Math.ceil(inputs.length / 5))),
        { primary: config.data.preferredServiceType },
        7, // §6.1 hard cap: 7 deliveries per route
      );

      return reply.send({ result, skipped });
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      proposedRoutes: ProposedRoute[];
      proposedQuote?: unknown;
      baselineQuote?: unknown;
      annotation?: string;
      tags?: string;
    };
  }>(
    "/local-delivery/simulator/api/batches/:id/save-tweak",
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const row = await prisma.ldSimBatch.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!row) return reply.code(404).send({ error: "not found" });

      type InputJson = import("@prisma/client-connector").Prisma.InputJsonValue;
      const created = await prisma.ldSimTweak.create({
        data: {
          batchId: id,
          proposedRoutes: req.body.proposedRoutes as unknown as InputJson,
          ...(req.body.proposedQuote !== undefined
            ? { proposedQuote: req.body.proposedQuote as unknown as InputJson }
            : {}),
          ...(req.body.baselineQuote !== undefined
            ? { baselineQuote: req.body.baselineQuote as unknown as InputJson }
            : {}),
          annotation: req.body.annotation ?? null,
          tags: req.body.tags ?? null,
        },
      });
      return reply.send({ tweak: created });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { routes: ProposedRoute[] };
  }>(
    "/local-delivery/simulator/api/batches/:id/polylines",
    async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return reply.code(400).send({ error: "invalid id" });
      }
      const row = await prisma.ldSimBatch.findUnique({ where: { id } });
      if (!row) return reply.code(404).send({ error: "not found" });

      const config = getLocationConfig(row.locationId);
      if (!config?.data.pickupLat || !config?.data.pickupLng) {
        return reply.code(400).send({ error: "pickup coords missing" });
      }
      const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";

      const payload = row.payload as unknown as BatchPayload;
      const orderById = new Map(payload.orders.map((o) => [o.id, o] as const));
      const origin = {
        lat: config.data.pickupLat,
        lng: config.data.pickupLng,
      };

      type PerRoute =
        | { routeIndex: number; ok: true; polyline: string; cached: boolean }
        | { routeIndex: number; ok: false; error: string };
      const results: PerRoute[] = [];

      for (const r of req.body.routes) {
        const stops: { lat: number; lng: number }[] = [];
        let missing = false;
        for (const oid of r.orderIds) {
          const o = orderById.get(oid);
          if (
            !o ||
            o.shippingAddress.latitude == null ||
            o.shippingAddress.longitude == null
          ) {
            missing = true;
            break;
          }
          stops.push({
            lat: o.shippingAddress.latitude,
            lng: o.shippingAddress.longitude,
          });
        }
        if (missing || stops.length === 0) {
          results.push({
            routeIndex: r.routeIndex,
            ok: false,
            error: "missing stop coordinates",
          });
          continue;
        }
        // origin → stops[0..n-2] (intermediates) → stops[n-1] (destination)
        const destination = stops[stops.length - 1]!;
        const intermediates = stops.slice(0, -1);
        const out = await getOrComputeRoutePolyline(
          row.locationId,
          r.orderIds,
          origin,
          intermediates,
          destination,
          apiKey,
        );
        if (out.ok) {
          results.push({
            routeIndex: r.routeIndex,
            ok: true,
            polyline: out.polyline,
            cached: out.cached,
          });
        } else {
          results.push({
            routeIndex: r.routeIndex,
            ok: false,
            error: out.error,
          });
        }
      }
      return reply.send({ routes: results });
    },
  );

  app.get<{ Querystring: { tag?: string } }>(
    "/local-delivery/simulator/api/lessons",
    async (req, reply) => {
      const tag = req.query.tag?.trim();
      const tenantId = await resolveTenantId(tenantSlug);

      const tweaks = await prisma.ldSimTweak.findMany({
        where: {
          batch: { tenantId },
          ...(tag ? { tags: { contains: tag } } : {}),
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          batchId: true,
          proposedRoutes: true,
          annotation: true,
          tags: true,
          createdAt: true,
          batch: {
            select: { date: true, locationName: true, locationId: true },
          },
        },
      });

      return reply.send({ lessons: tweaks });
    },
  );

  // Probe the static dir at boot so a missing dir surfaces as a clear error.
  if (!existsSync(STATIC_DIR)) {
    app.log.warn(
      `[local-delivery] simulator static dir missing: ${STATIC_DIR}`,
    );
  }
}
