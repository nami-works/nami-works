import { normalizeLocale, type SupportedLocale } from "../i18n/config";

/**
 * Resolve the merchant's *current* admin locale for this request.
 *
 * Shopify exposes the active admin language in two places that update on
 * every request when the merchant changes their language preference:
 *
 *   1. The iframe URL search param `?locale=<ietf-tag>` (e.g. `pt-BR`).
 *   2. The session-token JWT `locale` claim.
 *
 * The persisted offline session's `locale` field, by contrast, is set at
 * OAuth-install time and does NOT refresh when the merchant flips their
 * admin language. Reading it directly produces a stale UI: the merchant
 * switches to Portuguese, Shopify chrome flips, our embedded app stays
 * in English. Fixed in 2026-05-21 after Lucas reported the bug.
 *
 * Prefer the URL param (cheapest to read, always present in embedded
 * requests) and fall back to the offline session for non-embedded code
 * paths and as a safety net.
 */
export function getCurrentLocale(
  request: Request,
  session: unknown,
): SupportedLocale {
  const url = new URL(request.url);
  const fromUrl = url.searchParams.get("locale");
  // Shopify's published `Session` type does not declare `locale`, but the
  // runtime object carries it. Read defensively.
  const sessionLocale =
    session && typeof session === "object" && "locale" in session
      ? ((session as { locale?: string | null }).locale ?? null)
      : null;
  return normalizeLocale(fromUrl ?? sessionLocale);
}
