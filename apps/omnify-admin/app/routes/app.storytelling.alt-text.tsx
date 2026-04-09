import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import styles from "./app.storytelling/styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function AltTextPage() {
  const { t } = useTranslation("storytelling");

  return (
    <s-section>
      <input
        className={styles.cliInput}
        readOnly
        value={t("altText.comingSoon")}
      />
    </s-section>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
