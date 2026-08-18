import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

// Simplified vs. omnify-admin's vite.config.ts — no BASE_PATH/multi-brand
// complexity, since this app is single-purpose (GE Beauty only).
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL || process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
  delete process.env.HOST;
}

const host = new URL(process.env.SHOPIFY_APP_URL || "http://localhost").hostname;
const allowedHosts = host === "localhost" ? [host] : [host, ".trycloudflare.com"];

// BASE_PATH (2026-08-14): apps.gebeauty.com.br is a shared path-routed host
// — this app lives at /beautyback. Same normalization as omnify-admin's
// vite.config.ts (Vite's `base` needs leading+trailing slashes, "/" as-is).
const rawBasePath = process.env.BASE_PATH || "/";
const basePath = rawBasePath === "/" ? "/" : `/${rawBasePath.replace(/^\/+|\/+$/g, "")}/`;

export default defineConfig({
  base: basePath,
  server: {
    allowedHosts,
    cors: { preflightContinue: true },
    port: Number(process.env.PORT || 3100),
    fs: { allow: ["app", "node_modules"] },
  },
  plugins: [reactRouter()],
  build: {
    assetsInlineLimit: 0,
  },
});
