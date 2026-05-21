export type AppIdentity = "cpg-labs" | "omnify" | "storytelling" | "storefront" | "flywheel";

export function getAppIdentity(): AppIdentity {
  const raw = process.env.APP_IDENTITY;
  if (raw === "omnify" || raw === "storytelling" || raw === "storefront" || raw === "flywheel") return raw;
  return "cpg-labs";
}

const APP_DISPLAY_NAMES: Record<AppIdentity, string> = {
  "cpg-labs": "Omnify",
  omnify: "Omnify",
  storytelling: "Storytelling",
  storefront: "Storefront",
  flywheel: "Flywheel",
};

export function getAppDisplayName(identity: AppIdentity = getAppIdentity()): string {
  return APP_DISPLAY_NAMES[identity];
}

/**
 * Route prefixes each identity is allowed to serve.
 * CPG Labs serves everything; focused apps serve only their domain.
 */
const IDENTITY_ROUTES: Record<Exclude<AppIdentity, "cpg-labs">, string[]> = {
  omnify: [
    "app.local-delivery",
    "app.local-delivery-mobile",
    "app.carrier-service",
    "app.settings",
    "app.settings_.providers",
    "app.debug-delivery",
    "api.carrier-rates",
    "webhooks.lalamove",
    "app.retail-sales",
    "app.goals",
    "app.footprint-expansion",
    "app.retail-footprint",
    "api.kpi",
    "api.cron.retail-analytics",
    "api.retail-proposal-file",
  ],
  storytelling: [
    "app.storytelling",
    "app.alt-text",
    "app.places",
    "app.settings_.brand",
    "app.settings_.brand_.tone-sources",
    "api.blog-posts",
  ],
  storefront: [
    "app.merchandising",
    "webhooks.products",
  ],
  flywheel: [
    // Affiliates + Loyalty live here under the Flywheel umbrella.
    // For now everything still ships inside the CPG Labs full surface (displayed
    // as "Omnify" to merchants) — these prefixes go live the moment a flywheel
    // container is wired up. See shopify.app.flywheel.toml.
    "app.affiliates",
    "api.cron.affiliates-sync",
    // Loyalty A/B test + cross-campaign IssuedIncentive watchdog (added 2026-05-19).
    // Brief: inputs/growth-gebeauty-loyalty-ab-test-2026-05-16.md
    "app.loyalty",
    "api.cron.loyalty-orchestrator",
    "webhooks.orders.cancelled",
    "webhooks.orders.refunded",
  ],
};

/** Shared routes every identity can access (auth, health, webhooks, etc.). */
const ALWAYS_ALLOWED = [
  "auth",
  "health",
  "privacy",
  "webhooks",          // base webhook + compliance
  "webhooks.orders",
  "webhooks.customers",
  "webhooks.compliance",
  "webhooks.app",
  "app._index",
  "app",               // layout route
];

/**
 * Check whether a React Router route ID is enabled for the current identity.
 * Route IDs follow the flat-file convention: `routes/app.local-delivery` → `"app.local-delivery"`.
 * Pass the basename without the `routes/` prefix.
 */
export function isRouteEnabled(routeId: string): boolean {
  const identity = getAppIdentity();
  if (identity === "cpg-labs") return true;

  // Always-allowed routes
  if (ALWAYS_ALLOWED.some((prefix) => routeId === prefix || routeId.startsWith(`${prefix}.`))) {
    return true;
  }

  const allowed = IDENTITY_ROUTES[identity];
  return allowed.some((prefix) => routeId === prefix || routeId.startsWith(`${prefix}.`));
}

/** Nav items to render for the current identity. */
export type NavItem = { href: string; labelKey: string };

const ALL_NAV_ITEMS: NavItem[] = [
  { href: "/app/local-delivery", labelKey: "common:nav.localDelivery" },
  { href: "/app/retail-sales", labelKey: "common:nav.retailSales" },
  { href: "/app/footprint-expansion", labelKey: "common:nav.footprintExpansion" },
  { href: "/app/affiliates", labelKey: "common:nav.affiliates" },
  { href: "/app/loyalty", labelKey: "common:nav.loyalty" },
  { href: "/app/merchandising", labelKey: "common:nav.merchandising" },
  { href: "/app/storytelling", labelKey: "common:nav.storytelling" },
  { href: "/app/settings", labelKey: "common:nav.settings" },
];

const IDENTITY_NAV: Record<Exclude<AppIdentity, "cpg-labs">, string[]> = {
  omnify: [
    "/app/local-delivery",
    "/app/footprint-expansion",
    "/app/retail-sales",
    "/app/settings",
  ],
  storytelling: ["/app/storytelling"],
  storefront: ["/app/merchandising"],
  flywheel: ["/app/affiliates", "/app/loyalty"],
};

export function getNavItems(): NavItem[] {
  const identity = getAppIdentity();
  if (identity === "cpg-labs") return ALL_NAV_ITEMS;
  const allowed = IDENTITY_NAV[identity];
  return ALL_NAV_ITEMS.filter((item) => allowed.includes(item.href));
}
