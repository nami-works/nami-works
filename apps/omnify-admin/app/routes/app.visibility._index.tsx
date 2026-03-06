import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { TabBar } from "../components/tab-bar";
import styles from "./app.visibility/styles.module.css";

const visibilityTabs = [
  { id: "blog-posts", label: "Blog posts", href: "/app/visibility" },
  { id: "alt-text", label: "Alt Text", href: "/app/alt-text" },
  { id: "places", label: "Places", href: "/app/places" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function VisibilityIndex() {
  return (
    <s-page heading="Visibility">
      <TabBar
        tabs={visibilityTabs}
        activeId="blog-posts"
        className={styles.tabsRow}
        tabClassName={styles.tabItem}
        activeTabClassName={styles.tabActive}
        contentClassName={styles.tabContent}
        iconClassName={styles.tabIcon}
        activeIconClassName={styles.tabIconActive}
      />
      <s-button slot="primary-action">
        <Link to="/app/visibility/brief" style={{ color: "inherit", textDecoration: "none" }}>
          Create brief
        </Link>
      </s-button>

      <s-section heading="Generate SEO blog posts">
        <s-paragraph>
          Create structured briefs and generate SEO-optimized blog content using
          AI. Review drafts and publish to your Shopify blog.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <Link to="/app/visibility/brief">
            <s-button variant="primary">Create brief</s-button>
          </Link>
          <s-link href="/app/brand-settings">Configure brand settings</s-link>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Get started">
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/brand-settings">Configure brand settings</s-link>{" "}
            (about, tone of voice, editorial guidelines)
          </s-list-item>
          <s-list-item>
            <Link to="/app/visibility/brief">Create a brief</Link> with themes,
            keywords, and product mapping
          </s-list-item>
          <s-list-item>Generate content and review before publishing</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
