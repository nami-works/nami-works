import { normalizeLocale, type SupportedLocale } from "../i18n/config";

const LOCALE_COOKIE_NAME = "omnify_locale";
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Resolve the merchant's *current* admin locale for this request.
 *
 * Priority: URL `?locale=` > cookie `omnify_locale` > session.locale > default.
 *
 * Shopify only appends `?locale=` to the iframe's full HTML page load
 * (e.g. `/app?embedded=1&...&locale=pt-BR&...`). React Router's
 * client-side navigations between child routes refetch only the child
 * `.data` endpoint with no params, so the URL signal disappears on
 * every nav.
 *
 * Without persistence, only the root `/app` page rendered in the
 * merchant's current language; every other tab fell back to the stale
 * offline session.locale (still set to install-time value). Lucas
 * reported the symptom 2026-05-21: Home in pt-BR, every other page in
 * English after flipping the Shopify admin to Portuguese.
 *
 * Fix: when a request DOES carry `?locale=`, the root loader persists
 * it to a cookie (see buildLocalePersistenceHeader below). Subsequent
 * `.data` fetches read the cookie. Offline session.locale is still
 * checked as a last resort for non-embedded code paths.
 */
export function getCurrentLocale(
  request: Request,
  session: unknown,
): SupportedLocale {
  const url = new URL(request.url);
  const fromUrl = url.searchParams.get("locale");
  if (fromUrl) return normalizeLocale(fromUrl);

  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieMatch = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE_NAME}=([^;]+)`),
  );
  if (cookieMatch?.[1]) {
    return normalizeLocale(decodeURIComponent(cookieMatch[1]));
  }

  // Shopify's published `Session` type does not declare `locale`, but the
  // runtime object carries it. Read defensively.
  const sessionLocale =
    session && typeof session === "object" && "locale" in session
      ? ((session as { locale?: string | null }).locale ?? null)
      : null;
  return normalizeLocale(sessionLocale);
}

/**
 * If the current request URL carries `?locale=`, return a `Set-Cookie`
 * header value that persists it for 30 days. Returns null when there's
 * nothing to persist. Call from the root `/app` loader, which is the
 * only request Shopify reliably wraps with `?locale=`.
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
