import type { HeadersFunction } from "react-router";
import { Outlet } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";

export default function PriceTagsLayout() {
  const { t } = useTranslation("priceTags");

  return (
    <s-page heading={t("pageHeading")}>
      <Outlet />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
