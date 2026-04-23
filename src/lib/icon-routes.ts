import type { FastifyInstance } from "fastify";

/**
 * NAMI Works monochrome mark. Single SVG used for both the browser tab
 * favicon and the MCP server icon advertised in serverInfo.icons. Inline as
 * a string so we don't ship a binary asset that would inflate the container
 * image and require build-time copy hooks.
 */
export const NAMI_WORKS_ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="6" fill="#1f1e1c"/>
  <text x="16" y="22" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="14" font-weight="700" text-anchor="middle" fill="#ffffff">NW</text>
</svg>`;

export function mountIconRoutes(app: FastifyInstance): void {
  // Browsers fetching the tab icon when an operator visits mcp.nami.works
  // directly. Modern browsers accept SVG content under the .ico filename when
  // the response Content-Type says so.
  app.get("/favicon.ico", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/svg+xml").send(NAMI_WORKS_ICON_SVG);
  });

  // The canonical icon URL referenced from MCP serverInfo.icons. Using a
  // dedicated /icon.svg route (instead of just /favicon.ico) makes the
  // intent explicit for MCP clients and keeps the favicon as a tiny browser
  // affordance rather than a load-bearing endpoint.
  app.get("/icon.svg", async (_req, reply) => {
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.type("image/svg+xml").send(NAMI_WORKS_ICON_SVG);
  });
}
