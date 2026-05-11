import type { FastifyInstance } from "fastify";
import { NAMI_LOGO_PNG_BASE64 } from "./nami-logo-png.js";

/**
 * NAMI Works monochrome mark (SVG fallback) — kept for the browser favicon
 * route and as a transparent placeholder.
 */
export const NAMI_WORKS_ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="6" fill="#1f1e1c"/>
  <text x="16" y="22" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="14" font-weight="700" text-anchor="middle" fill="#ffffff">NW</text>
</svg>`;

const NAMI_LOGO_PNG_BUFFER = Buffer.from(NAMI_LOGO_PNG_BASE64, "base64");

export function mountIconRoutes(app: FastifyInstance): void {
  // Browser tab favicon — lightweight SVG, no need for the full PNG.
  app.get("/favicon.ico", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/svg+xml").send(NAMI_WORKS_ICON_SVG);
  });

  // SVG variant kept for backward compatibility — MCP clients that landed
  // on the old icon URL between deploys still resolve here.
  app.get("/icon.svg", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/svg+xml").send(NAMI_WORKS_ICON_SVG);
  });

  // Canonical MCP serverInfo icon — the full-color NAMI Works square mark.
  // Referenced from src/mcp/registry.ts in the serverInfo.icons array.
  app.get("/icon.png", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/png").send(NAMI_LOGO_PNG_BUFFER);
  });
}
