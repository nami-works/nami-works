import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://nami.works",
  output: "static",
  trailingSlash: "never",
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  integrations: [sitemap()],
  build: { format: "file" },
  // Old pipeline pages -> new single "How it works" page; old self-service
  // form -> the new free self-assessment; old booking widget -> home.
  // Astro emits static meta-refresh + canonical pages for these under
  // `output: "static"` (no server to issue real 301s).
  redirects: {
    "/metodo": "/como-funciona",
    "/implantacao": "/como-funciona",
    "/operacao": "/como-funciona",
    "/diagnostico": "/por-onde-comecar",
    "/agenda": "/",
  },
});
