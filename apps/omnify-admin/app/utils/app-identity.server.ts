export type AppIdentity = "cpg-labs" | "omnify" | "storytelling" | "storefront";

export function getAppIdentity(): AppIdentity {
  const raw = process.env.APP_IDENTITY;
  if (raw === "omnify" || raw === "storytelling" || raw === "storefront") return raw;
  return "cpg-labs";
}

/**
 * Route prefixes each identity is allowed to serve.
 * CPG Labs serves everything; focused apps serve only their domain.
 */
const IDENTITY_ROUTES: Record<Exclude<AppIdentity, "cpg-labs">, string[]> = {
  omnify: [
    "app.local-delivery",
    "app.carrier-service",
    "app.settings",
    "app.settings_.providers",
    "app.debug-delivery",
    "api.carrier-rates",
    "webhooks.lalamove",
    "app.sales-goals",
    "app.goals",
    "app.retail-footprint",
    "api.kpi",
    "api.cron.retail-analytics",
    "api.retail-proposal-file",
    "app.affiliates",
  ],
  storytelling: [
    "app.storytelling",
    "app.alt-text",
    "app.places",
    "app.brand-settings",
    "api.blog-posts",
  ],
  storefront: [
    "app.merchandising",
    "webhooks.products",
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

/** Home route each identity should redirect to from app._index. */
export function getHomeRoute(): string {
  const identity = getAppIdentity();
  switch (identity) {
    case "omnify":
      return "/app/local-delivery";
    case "storytelling":
      return "/app/storytelling";
    case "storefront":
      return "/app/merchandising";
    default:
      return "/app/local-delivery";
  }
}

/** Nav items to render for the current identity. */
export type NavItem = { href: string; labelKey: string };

const ALL_NAV_ITEMS: NavItem[] = [
  { href: "/app/local-delivery", labelKey: "common:nav.localDelivery" },
  { href: "/app/sales-goals", labelKey: "common:nav.salesGoals" },
  { href: "/app/retail-footprint", labelKey: "common:nav.retailExpansion" },
  { href: "/app/affiliates", labelKey: "common:nav.affiliates" },
  { href: "/app/merchandising", labelKey: "common:nav.merchandising" },
  { href: "/app/storytelling", labelKey: "common:nav.storytelling" },
  { href: "/app/settings", labelKey: "common:nav.settings" },
  { href: "/app", labelKey: "common:nav.extras" },
];

const IDENTITY_NAV: Record<Exclude<AppIdentity, "cpg-labs">, string[]> = {
  omnify: ["/app/local-delivery", "/app/retail-footprint", "/app/sales-goals", "/app/settings"],
  storytelling: ["/app/storytelling"],
  storefront: ["/app/merchandising"],
};

export function getNavItems(): NavItem[] {
  const identity = getAppIdentity();
  if (identity === "cpg-labs") return ALL_NAV_ITEMS;
  const allowed = IDENTITY_NAV[identity];
  return ALL_NAV_ITEMS.filter((item) => allowed.includes(item.href));
}
