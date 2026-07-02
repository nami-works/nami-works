import type { FastifyInstance } from "fastify";
import { HOLO_ICON_PNG_BASE64 } from "./ge-holo-icon.js";

// GE Beauty holographic tile, served at EVERY icon route so whichever one a
// client resolves (favicon, icon.svg, or the MCP serverInfo icon.png) shows the
// same brand mark. claude.ai's connector-list icon is fetched from /icon.svg
// (SVG preferred over the favicon), which is why the flat red mark persisted
// after only favicon/icon.png were changed. The SVG simply wraps the PNG tile.
const HOLO_ICON_PNG_BUFFER = Buffer.from(HOLO_ICON_PNG_BASE64, "base64");

const HOLO_ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 256 256" width="256" height="256">
  <image width="256" height="256" xlink:href="data:image/png;base64,${HOLO_ICON_PNG_BASE64}"/>
</svg>`;

export function mountIconRoutes(app: FastifyInstance): void {
  // Browser-tab favicon.
  app.get("/favicon.ico", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/png").send(HOLO_ICON_PNG_BUFFER);
  });

  // SVG icon — this is what claude.ai renders in the Connectors list.
  app.get("/icon.svg", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/svg+xml").send(HOLO_ICON_SVG);
  });

  // Canonical MCP serverInfo icon (registry.ts serverInfo.icons array).
  app.get("/icon.png", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/png").send(HOLO_ICON_PNG_BUFFER);
  });
}
