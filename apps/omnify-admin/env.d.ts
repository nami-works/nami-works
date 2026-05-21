/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

declare namespace NodeJS {
  interface ProcessEnv {
    // Content Gen API (Story-telling feature)
    CONTENT_GEN_API_URL?: string;
    CONTENT_GEN_API_KEY?: string;
    // Content Scraper API (Story-telling feature)
    SCRAPER_API_URL?: string;
    SCRAPER_API_KEY?: string;
  }
}
