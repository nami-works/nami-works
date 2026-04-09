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
import { getAppIdentity, getNavItems } from "../utils/app-identity.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const locale = normalizeLocale(
    (session as { locale?: string }).locale,
  );
  const basePath = process.env.BASE_PATH || "";
  const appIdentity = getAppIdentity();
  const navItems = getNavItems();

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", basePath, locale, appIdentity, navItems };
};

export default function App() {
  const { apiKey, locale, navItems, basePath } = useLoaderData<typeof loader>();
  const logoSrc = `${basePath}/delivery-box_holographic.png`.replace(/\/+/g, "/");
  const navigation = useNavigation();
  const isPageNavigation = navigation.state === "loading" && !!navigation.location;
  const [showOverlay, setShowOverlay] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isPageNavigation) {
      timerRef.current = setTimeout(() => setShowOverlay(true), 400);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShowOverlay(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPageNavigation]);

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
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 20,
              background: "#f6f6f7",
            }}
          >
            <img
              src={logoSrc}
              alt="Loading"
              style={{ width: 88, height: "auto" }}
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
              <div
                style={{
                  height: "100%",
                  borderRadius: 99,
                  background: "linear-gradient(90deg, #5ecece, #b09fda, #d4a8d4, #5ecece)",
                  backgroundSize: "200% 100%",
                  animation: "omnify-holo-bar 1.4s linear infinite",
                }}
              />
            </div>
            <style>{`
              @keyframes omnify-holo-bar {
                0%   { background-position: 100% 0; }
                100% { background-position: -100% 0; }
              }
            `}</style>
          </div>
        )}
        <s-app-nav>
          {navItems.map((item: { href: string; labelKey: string }) => (
            <s-link key={item.href} href={item.href}>{t(item.labelKey)}</s-link>
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
