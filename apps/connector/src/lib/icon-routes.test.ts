import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { GE_ICON_SVG, mountIconRoutes } from "./icon-routes.js";

describe("icon routes", () => {
  it("serves the GE Beauty mark at /favicon.ico with image/svg+xml type", async () => {
    const app = Fastify({ logger: false });
    mountIconRoutes(app);
    const res = await app.inject({ method: "GET", url: "/favicon.ico" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.body).toContain("<svg");
    await app.close();
  });

  it("serves the same SVG at /icon.svg", async () => {
    const app = Fastify({ logger: false });
    mountIconRoutes(app);
    const res = await app.inject({ method: "GET", url: "/icon.svg" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.body).toBe(GE_ICON_SVG);
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
