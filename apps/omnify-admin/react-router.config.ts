import type { Config } from "@react-router/dev/config";

const basePath = process.env.BASE_PATH || "/";

// Always a string so React Router's Vite plugin doesn't call .startsWith() on undefined (e.g. during shopify app dev)
export default {
  basename: basePath,
} satisfies Config;
