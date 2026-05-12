import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { I18nextProvider } from "react-i18next";

import { authenticate } from "../shopify.server";
import {
  createI18nInstance,
  normalizeLocale,
  type SupportedLocale,
} from "../i18n/config";
import { getAppDisplayName, getAppIdentity, getNavItems } from "../utils/app-identity.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const locale = normalizeLocale(
    (session as { locale?: string }).locale,
  );
  const basePath = process.env.BASE_PATH || "";
  const appIdentity = getAppIdentity();
  const appDisplayName = getAppDisplayName(appIdentity);
  const navItems = getNavItems();

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", basePath, locale, appIdentity, appDisplayName, navItems };
};

export default function App() {
  const { apiKey, locale, navItems, basePath } = useLoaderData<typeof loader>();
  const logoSrc = `${basePath}/omnify_map-2x.png`.replace(/\/+/g, "/");
  const navigation = useNavigation();
  const isPageNavigation = navigation.state === "loading" && !!navigation.location;
  // Default true so cold-start paints the overlay immediately, hiding the
  // unstyled custom-element flash before App Bridge upgrades <s-*> tags.
  const [showOverlay, setShowOverlay] = useState(true);
  const [customElementsReady, setCustomElementsReady] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof customElements === "undefined") {
      setCustomElementsReady(true);
      return;
    }
    let cancelled = false;
    // Safety: never let the overlay stick longer than 3s even if a custom
    // element fails to define (App Bridge bundle delay, network hiccup, etc.).
    const safetyTimeout = setTimeout(() => {
      if (!cancelled) setCustomElementsReady(true);
    }, 3000);
    Promise.all([
      customElements.whenDefined("s-app-nav"),
      customElements.whenDefined("s-page"),
      customElements.whenDefined("s-section"),
    ]).then(() => {
      if (!cancelled) {
        clearTimeout(safetyTimeout);
        setCustomElementsReady(true);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(safetyTimeout);
    };
  }, []);

  useEffect(() => {
    if (isPageNavigation) {
      timerRef.current = setTimeout(() => setShowOverlay(true), 400);
    } else if (customElementsReady) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowOverlay(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPageNavigation, customElementsReady]);

  const i18nInstance = useMemo(
    () => createI18nInstance(locale as SupportedLocale),
    [locale],
  );
  const t = i18nInstance.t.bind(i18nInstance);

  useEffect(() => {
    document.documentElement.lang = locale === "pt-BR" ? "pt-BR" : "en";
  }, [locale]);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <I18nextProvider i18n={i18nInstance}>
        {/* Preload logo so it's cached before the overlay renders */}
        <img src={logoSrc} alt="" aria-hidden="true" style={{ display: "none" }} />
        {showOverlay && (
          <div
            className="cpg-loading-overlay"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              // 2026-05-12: 12pt (16px) min padding between logo and the
              // loading bar. Prior gap:0 had the bar visually crowding the
              // logo.
              gap: 16,
              background: "#f6f6f7",
              // Inline so it applies even before the <style> block is parsed
              // and even if the Shopify CDN Inter stylesheet hasn't loaded.
              fontFamily:
                'ShopifySans, -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif',
            }}
          >
            <img
              src={logoSrc}
              alt="Loading"
              style={{ width: "clamp(64px, 20vw, 120px)", height: "auto" }}
            />
            <div
              style={{
                width: 110,
                height: 3,
                background: "rgba(0,0,0,0.08)",
                borderRadius: 99,
                overflow: "hidden",
              }}
            >
              <div className="cpg-holo-bar" />
            </div>
            <style>{`
              @keyframes omnify-holo-bar {
                0%   { background-position: 100% 0; }
                100% { background-position: -100% 0; }
              }
              /* 2026-05-12: bar renders as FILLING (left-to-right progress
                 sweep) instead of the prior indeterminate shimmer. Matches
                 the optimize-route progress bar's holo fill. The width
                 animates 0%→100% and loops; the gradient still scrolls so
                 the fill keeps the signature holographic feel. */
              @keyframes omnify-bar-fill {
                0%   { width: 0%; }
                90%  { width: 100%; }
                100% { width: 100%; }
              }
              .cpg-holo-bar {
                height: 100%;
                width: 0%;
                border-radius: 99px;
                background: linear-gradient(90deg, #5ecece, #b09fda, #d4a8d4, #5ecece);
                background-size: 200% 100%;
                animation: omnify-bar-fill 1.8s ease-out infinite,
                           omnify-holo-bar 1.4s linear infinite;
              }
              .cpg-loading-msg {
                font-size: 13px;
                font-weight: 500;
                letter-spacing: 0.1px;
                text-align: center;
              }
              /* .cpg-holo-signature text-clip rule removed 2026-05-12 —
                 was defined but never used anywhere in the codebase. Per
                 Lucas's "holo signature only on loading bars" rule, the
                 in-block bar (.cpg-holo-bar) stays and text-treatments go. */
            `}</style>
          </div>
        )}
        <s-app-nav>
          {navItems.map((item: { href: string; labelKey: string }) => (
            // App Bridge prepends application_url's path component to absolute
            // <s-link> hrefs. With application_url="https://.../full" and
            // href="/app/foo", the backend gets "/full/app/foo" (correct).
            // Prepending basePath manually produces "/full/full/app/foo" (404).
            // Verified from CloudWatch:
            //   GET /full/__manifest?paths=%2Ffull%2Ffull%2Fapp%2Fretail-sales
            // on v18 (with prefix). Single-/full on v19 (without). CLAUDE.md
            // "Subpath (BASE_PATH)" + scripts/check-no-basepath-in-nav-links.ts
            // forbid basePath on <s-link>.
            <s-link key={item.href} href={item.href}>
              {t(item.labelKey)}
            </s-link>
          ))}
        </s-app-nav>
        <div style={showOverlay ? { visibility: "hidden" } : undefined}>
          <Outlet />
        </div>
      </I18nextProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
