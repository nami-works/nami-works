import type { FastifyInstance } from "fastify";
import {
  authorizeTenantRequest,
  type TenantLookup,
} from "../../auth/tenant-auth.js";
import { listPendingHypotheses } from "./service.js";

// REST endpoints for the tone-of-voice pipeline. Mirror the existing
// /:tenant MCP transport: same bearer-auth via authorizeTenantRequest,
// same per-tenant scope, just a different shape so external clients
// (the cpg-labs Shopify admin proxy, future operator scripts, the
// non-Shopify web UI in Phase 5) can consume the same data over plain
// HTTP without speaking MCP.
//
// Phase 1 ships read-only `/api/tone/hypotheses` to prove the auth path
// end-to-end. Write endpoints (accept/reject, refresh, integrations CRUD)
// land in Phase 2 alongside the equivalent confirm-gated MCP tools.

export type RouteDeps = {
  prisma?: TenantLookup;
};

export function mountToneRoutes(
  app: FastifyInstance,
  deps: RouteDeps = {},
): void {
  app.get("/:tenant/api/tone/hypotheses", async (request, reply) => {
    const { tenant: slug } = request.params as { tenant: string };
    const query = request.query as {
      status?: string;
      min_confidence?: string;
      batch_id?: string;
      limit?: string;
    };

    const authResult = await authorizeTenantRequest({
      slug,
      authorizationHeader: request.headers.authorization,
      ...(deps.prisma ? { prisma: deps.prisma } : {}),
    });

    if (!authResult.ok) {
      return reply
        .code(authResult.status)
        .send({ ok: false, error: authResult.error });
    }

    // Phase 1 only serves pending_review. The query param is reserved so
    // future status filters (`accepted`, `rejected`) don't change the URL.
    const status = query.status ?? "pending_review";
    if (status !== "pending_review") {
      return reply.code(400).send({
        ok: false,
        error: `Only status=pending_review is supported in Phase 1 (got ${status}).`,
      });
    }

    const minConfidence = query.min_confidence
      ? Number.parseFloat(query.min_confidence)
      : undefined;
    // Clamp the caller-supplied limit so a bearer can't ask for the whole
    // table. 1 ≤ limit ≤ 200; out-of-range or non-numeric falls through to
    // the service-layer default.
    const rawLimit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    const limit =
      rawLimit !== undefined && Number.isFinite(rawLimit)
        ? Math.min(Math.max(rawLimit, 1), 200)
        : undefined;

    const rows = await listPendingHypotheses(authResult.tenant.id, {
      ...(minConfidence !== undefined && Number.isFinite(minConfidence)
        ? { minConfidence }
        : {}),
      ...(query.batch_id ? { batchId: query.batch_id } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });

    return reply.send({
      ok: true,
      tenant: authResult.tenant.slug,
      count: rows.length,
      hypotheses: rows.map((r) => ({
        id: r.id,
        batchId: r.batchId,
        category: r.category,
        statement: r.statement,
        evidence: r.evidence,
        confidence: r.confidence,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
}
