/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

declare namespace NodeJS {
  interface ProcessEnv {
    // Blog Gen API (Visibility feature)
    BLOG_GEN_API_URL?: string;
    BLOG_GEN_API_KEY?: string;
    // Content Scraper API (Visibility feature)
    SCRAPER_API_URL?: string;
    SCRAPER_API_KEY?: string;
  }
}
