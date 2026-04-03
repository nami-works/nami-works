import type { HeadersFunction } from "react-router";
import { Outlet, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import styles from "./app.merchandising/styles.module.css";

export default function MerchandisingLayout() {
  const { t } = useTranslation("merchandising");
  const location = useLocation();

  const tabs = [
    { id: "overview", label: t("tabs.overview"), href: "/app/merchandising" },
    { id: "metaobjects", label: t("tabs.metaobjects"), href: "/app/merchandising/metaobjects" },
    { id: "discounts", label: t("tabs.discounts"), href: "/app/merchandising/discounts" },
    { id: "pricing", label: t("tabs.pricing"), href: "/app/merchandising/pricing" },
    { id: "collections", label: t("tabs.collections"), href: "/app/merchandising/collections" },
    { id: "campaigns", label: t("tabs.campaigns"), href: "/app/merchandising/campaigns" },
  ];

  const activeId =
    location.pathname.includes("/metaobjects") ? "metaobjects"
    : location.pathname.includes("/discounts") ? "discounts"
    : location.pathname.includes("/pricing") ? "pricing"
    : location.pathname.includes("/collections") ? "collections"
    : location.pathname.includes("/campaigns") ? "campaigns"
    : "overview";

  return (
    <s-page heading={t("heading")}>
      <s-section>
        <div className={styles.tabsRow}>
          {tabs.map((tab) => (
            <a
              key={tab.id}
              href={tab.href}
              className={`${styles.tab}${tab.id === activeId ? ` ${styles.tabActive}` : ""}`}
            >
              {tab.label}
            </a>
          ))}
        </div>
      </s-section>
      <Outlet />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
