import type { Config } from "@react-router/dev/config";

// BASE_PATH (2026-08-14): apps.gebeauty.com.br is a shared host for GE
// Beauty's internal Shopify apps, path-routed — this app lives at
// /beautyback. Same pattern as omnify-admin's BASE_PATH (always a string
// so the Vite plugin doesn't call .startsWith() on undefined).
const basePath = process.env.BASE_PATH || "/";

export default {
  ssr: true,
  basename: basePath,
} satisfies Config;
