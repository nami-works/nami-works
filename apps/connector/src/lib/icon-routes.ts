import type { FastifyInstance } from "fastify";
import { HOLO_ICON_PNG_BASE64 } from "./ge-holo-icon.js";

/**
 * GE Beauty mark (SVG) for the browser favicon / legacy icon route. Small flat
 * mark — the full-color holographic tile is served as the PNG serverInfo icon.
 */
export const GE_ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7" fill="#DF372F"/>
  <text x="16" y="22" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="15" font-weight="700" text-anchor="middle" fill="#ffffff">ge</text>
</svg>`;

const HOLO_ICON_PNG_BUFFER = Buffer.from(HOLO_ICON_PNG_BASE64, "base64");

export function mountIconRoutes(app: FastifyInstance): void {
  // Browser tab favicon — lightweight SVG.
  app.get("/favicon.ico", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/svg+xml").send(GE_ICON_SVG);
  });

  // SVG variant kept for clients that resolved the old icon URL between deploys.
  app.get("/icon.svg", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/svg+xml").send(GE_ICON_SVG);
  });

  // Canonical MCP serverInfo icon — the GE Beauty holographic square tile.
  // Referenced from src/mcp/registry.ts in the serverInfo.icons array.
  app.get("/icon.png", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/png").send(HOLO_ICON_PNG_BUFFER);
  });
}
