import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[storytelling] loader shop=${shop}`);
  return null;
};

export default function StorytellingIndex() {
  const { t } = useTranslation("storytelling");

  return (
    <>
      <s-section heading={t("index.seoSection")}>
        <s-paragraph>
          {t("index.seoDescription")}
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <Link to="/app/storytelling/brief">
            <s-button variant="primary">{t("index.createBrief")}</s-button>
          </Link>
          <s-link href="/app/settings/brand">{t("index.configureBrand")}</s-link>
        </s-stack>
      </s-section>

      <s-section heading={t("index.getStarted")}>
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/settings/brand">{t("index.configureBrand")}</s-link>{" "}
            {t("index.stepBrand")}
          </s-list-item>
          <s-list-item>
            <Link to="/app/storytelling/brief">{t("index.createBrief")}</Link>{" "}
            {t("index.stepBrief")}
          </s-list-item>
          <s-list-item>{t("index.stepGenerate")}</s-list-item>
        </s-unordered-list>
      </s-section>
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
