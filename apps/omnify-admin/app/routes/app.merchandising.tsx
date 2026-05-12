import type { HeadersFunction } from "react-router";
import { Outlet, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import { PageTabs, type PageTab } from "../components/page-tabs";

export default function MerchandisingLayout() {
  const { t } = useTranslation("merchandising");
  const location = useLocation();

  const activeId =
    location.pathname.includes("/metaobjects") ? "metaobjects"
    : location.pathname.includes("/discounts") ? "discounts"
    : location.pathname.includes("/pricing") ? "pricing"
    : location.pathname.includes("/collections") ? "collections"
    : location.pathname.includes("/sale") ? "sale"
    : "overview";

  const merchandisingPageTabs: PageTab[] = [
    { key: "overview", label: t("tabs.overview"), to: "/app/merchandising" },
    { key: "metaobjects", label: t("tabs.metaobjects"), to: "/app/merchandising/metaobjects" },
    { key: "discounts", label: t("tabs.discounts"), to: "/app/merchandising/discounts" },
    { key: "pricing", label: t("tabs.pricing"), to: "/app/merchandising/pricing" },
    { key: "collections", label: t("tabs.collections"), to: "/app/merchandising/collections" },
    { key: "sale", label: t("tabs.sale"), to: "/app/merchandising/sale" },
  ];

  return (
    <s-page heading={t("heading")}>
      <PageTabs activeKey={activeId} tabs={merchandisingPageTabs} ariaLabel={t("heading") as string} />
      <Outlet />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
