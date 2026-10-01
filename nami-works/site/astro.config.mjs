import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://nami.works",
  output: "static",
  trailingSlash: "never",
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  integrations: [sitemap()],
  build: { format: "file" },
  // nami.works pivoted to a single-page matchmaking funnel (2026-09-30);
  // these pages from the prior AI-consulting site are retired. Redirect
  // the externally-linkable ones rather than letting them 404.
  redirects: {
    "/agenda": "/",
    "/contato": "/",
    "/diagnostico": "/",
    "/implantacao": "/",
    "/metodo": "/",
    "/operacao": "/",
    "/obrigado": "/",
  },
});
