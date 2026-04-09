import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import styles from "./app.storytelling/styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[storytelling] loader shop=${shop}`);
  return null;
};

export default function StorytellingLayout() {
  const { t } = useTranslation("storytelling");
  const location = useLocation();

  const tabs = [
    { id: "blog-posts", label: t("tabs.blogPosts"), to: "/app/storytelling" },
    { id: "alt-text", label: t("tabs.altText"), to: "/app/storytelling/alt-text" },
    { id: "places", label: t("tabs.places"), to: "/app/storytelling/places" },
  ];

  const activeId = location.pathname.includes("/alt-text")
    ? "alt-text"
    : location.pathname.includes("/places")
      ? "places"
      : "blog-posts";

  return (
    <s-page heading={t("pageHeading")}>
      <div className={styles.tabsRow}>
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.to}
            className={`${styles.tab}${tab.id === activeId ? ` ${styles.tabActive}` : ""}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      <Outlet />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
