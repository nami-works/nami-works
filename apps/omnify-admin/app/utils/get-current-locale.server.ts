import { normalizeLocale, type SupportedLocale } from "../i18n/config";

const LOCALE_COOKIE_NAME = "omnify_locale";
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Resolve the merchant's *current* admin locale for this request.
 *
 * Priority:
 *   1. Online session's user locale -- `session.onlineAccessInfo
 *      .associated_user.locale`. This is the canonical Shopify signal:
 *      per-user, refreshed via token exchange on every authenticate.admin
 *      call. Requires `useOnlineTokens: true` in the shopifyApp config
 *      (see packages/shared-auth/src/index.ts).
 *   2. URL `?locale=` -- Shopify wraps every iframe HTML reload with
 *      the live locale. Belt-and-suspenders for the initial /app load.
 *   3. Cookie `omnify_locale` -- persisted on `/app` loads so React
 *      Router child `.data` fetches (which don't carry `?locale=`) can
 *      still serve the right language during pure SPA navigation if
 *      the online session is somehow missing.
 *   4. Offline `session.locale` -- shop-level, set at install time and
 *      never refreshed. Last-resort fallback for non-embedded code paths.
 *   5. Default ("en").
 *
 * Background: pre-online-tokens this app used only offline sessions, so
 * `session.locale` was the install-time shop value. Switching the merchant
 * to Portuguese updated Shopify chrome but not the embedded app. The 6d3e153
 * URL-only fix worked for /app (initial iframe URL has `?locale=`) but
 * broke on child routes because RR child `.data` fetches have no query
 * params. The 3f08ce9 cookie fix patched child routes. The proper fix is
 * the canonical Shopify pattern: enable online tokens and read the user's
 * locale off the session itself.
 */
export function getCurrentLocale(
  request: Request,
  session: unknown,
): SupportedLocale {
  // 1. Online session user locale (canonical Shopify signal).
  const onlineLocale = readOnlineSessionLocale(session);
  if (onlineLocale) return normalizeLocale(onlineLocale);

  // 2. URL search param (initial iframe load).
  const url = new URL(request.url);
  const fromUrl = url.searchParams.get("locale");
  if (fromUrl) return normalizeLocale(fromUrl);

  // 3. Cookie (set by the root /app loader; survives SPA navigation).
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieMatch = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE_NAME}=([^;]+)`),
  );
  if (cookieMatch?.[1]) {
    return normalizeLocale(decodeURIComponent(cookieMatch[1]));
  }

  // 4. Offline session.locale (install-time, may be stale).
  const sessionLocale =
    session && typeof session === "object" && "locale" in session
      ? ((session as { locale?: string | null }).locale ?? null)
      : null;
  return normalizeLocale(sessionLocale);
}

/**
 * If the current request URL carries `?locale=`, return a `Set-Cookie`
 * header value that persists it for 30 days. Returns null when there's
 * nothing to persist. Called from the root `/app` loader as a defensive
 * fallback -- with `useOnlineTokens` enabled, this cookie is rarely the
 * source of truth, but it keeps SPA navigation working even if a request
 * misses online-session refresh for any reason.
 *
 * `SameSite=None; Secure` is required because the app runs inside an
 * iframe hosted by admin.shopify.com (a different origin). Without
 * `SameSite=None`, modern browsers treat the cookie as cross-site and
 * drop it on subsequent `.data` fetches from inside the iframe.
 */
export function buildLocalePersistenceHeader(
  request: Request,
): string | null {
  const url = new URL(request.url);
  const fromUrl = url.searchParams.get("locale");
  if (!fromUrl) return null;
  const value = encodeURIComponent(fromUrl);
  return `${LOCALE_COOKIE_NAME}=${value}; Path=/; SameSite=None; Secure; Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}`;
}

/**
 * Pull `associated_user.locale` from an online Shopify session. Returns
 * null for offline sessions, sessions without onlineAccessInfo, or any
 * type-mismatch. Shopify's `OnlineAccessInfo.associated_user` shape:
 *   { id, first_name, last_name, email, ..., locale, ... }
 */
function readOnlineSessionLocale(session: unknown): string | null {
  if (!session || typeof session !== "object") return null;
  const onlineAccessInfo = (session as { onlineAccessInfo?: unknown })
    .onlineAccessInfo;
  if (!onlineAccessInfo || typeof onlineAccessInfo !== "object") return null;
  const associatedUser = (onlineAccessInfo as { associated_user?: unknown })
    .associated_user;
  if (!associatedUser || typeof associatedUser !== "object") return null;
  const locale = (associatedUser as { locale?: unknown }).locale;
  return typeof locale === "string" && locale.length > 0 ? locale : null;
}
