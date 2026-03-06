import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { TabBar } from "../components/tab-bar";
import styles from "./app.alt-text/styles.module.css";

const visibilityTabs = [
  { id: "blog-posts", label: "Blog posts", href: "/app/visibility" },
  { id: "alt-text", label: "Alt Text", href: "/app/alt-text" },
  { id: "places", label: "Places", href: "/app/places" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function AltTextPage() {
  return (
    <s-page heading="Alt Text" inlineSize="base">
      <TabBar
        tabs={visibilityTabs}
        activeId="alt-text"
        className={styles.tabsRow}
        tabClassName={styles.tabItem}
        activeTabClassName={styles.tabActive}
        contentClassName={styles.tabContent}
        iconClassName={styles.tabIcon}
        activeIconClassName={styles.tabIconActive}
      />
      <s-section>
        <input
          className={styles.cliInput}
          readOnly
          value="Alt text features coming soon..."
        />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
