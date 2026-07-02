import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { mountIconRoutes } from "./icon-routes.js";

describe("icon routes", () => {
  it("serves the holographic PNG tile at /favicon.ico (claude.ai reads the connector icon here)", async () => {
    const app = Fastify({ logger: false });
    mountIconRoutes(app);
    const res = await app.inject({ method: "GET", url: "/favicon.ico" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.rawPayload.length).toBeGreaterThan(1000);
    await app.close();
  });

  it("serves the holo tile as an SVG at /icon.svg (claude.ai's connector-list icon)", async () => {
    const app = Fastify({ logger: false });
    mountIconRoutes(app);
    const res = await app.inject({ method: "GET", url: "/icon.svg" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.body).toContain("<svg");
    // Wraps the holo PNG tile rather than a flat mark.
    expect(res.body).toContain("data:image/png;base64,");
    await app.close();
  });

  it("serves the holographic PNG tile at /icon.png", async () => {
    const app = Fastify({ logger: false });
    mountIconRoutes(app);
    const res = await app.inject({ method: "GET", url: "/icon.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.rawPayload.length).toBeGreaterThan(1000);
    await app.close();
  });

  it("sets a 1-day Cache-Control header so MCP clients and browsers cache the icon", async () => {
    const app = Fastify({ logger: false });
    mountIconRoutes(app);
    const res = await app.inject({ method: "GET", url: "/icon.svg" });
    expect(res.headers["cache-control"]).toContain("max-age=86400");
    await app.close();
  });
});
