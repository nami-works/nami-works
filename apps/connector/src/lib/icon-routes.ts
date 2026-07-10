import type { FastifyInstance } from "fastify";
import { HOLO_ICON_PNG_BASE64 } from "./ge-holo-icon.js";

// GE Beauty holographic tile, served at EVERY icon route (favicon, icon.svg,
// and the MCP serverInfo icon.png) so whichever one a client resolves shows the
// same brand mark. Served with `no-store` so a client can never hold a stale
// copy — if claude.ai ever refetches (on connector re-add), it gets this.
// Note: as of 2026-07 claude.ai may not fetch a server icon at all for custom
// connectors (renders a name-derived monogram); these routes are still correct
// for every other client.
const HOLO_ICON_PNG_BUFFER = Buffer.from(HOLO_ICON_PNG_BASE64, "base64");

const HOLO_ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256" width="256" height="256">
  <image width="256" height="256" xlink:href="data:image/png;base64,${HOLO_ICON_PNG_BASE64}"/>
</svg>`;

export function mountIconRoutes(app: FastifyInstance): void {
  // Browser-tab favicon.
  app.get("/favicon.ico", async (_req, reply) => {
    reply.header("Cache-Control", "no-store, max-age=0");
    return reply.type("image/png").send(HOLO_ICON_PNG_BUFFER);
  });

  // SVG icon — this is what claude.ai renders in the Connectors list.
  app.get("/icon.svg", async (_req, reply) => {
    reply.header("Cache-Control", "no-store, max-age=0");
    return reply.type("image/svg+xml").send(HOLO_ICON_SVG);
  });

  // Canonical MCP serverInfo icon (registry.ts serverInfo.icons array).
  app.get("/icon.png", async (_req, reply) => {
    reply.header("Cache-Control", "no-store, max-age=0");
    return reply.type("image/png").send(HOLO_ICON_PNG_BUFFER);
  });
}
