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

export default defineConfig({
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
