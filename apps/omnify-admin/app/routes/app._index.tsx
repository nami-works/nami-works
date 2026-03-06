import type { HeadersFunction } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import styles from "./app._index/styles.module.css";

export const loader = async () => {
  throw redirect("/app/local-delivery");
};

const FUNCTION_CARD_SPECS = [
  {
    title: "Local delivery",
    path: "/app/local-delivery",
    description:
      "Plan and assign local delivery routes. Visualize orders on a map, tag them to routes, and organize efficient delivery zones for your customers.",
  },
  {
    title: "Sales goals",
    path: "/app/sales-goals",
    description:
      "Set monthly sales targets by location and track actual performance. Monitor KPIs, rankings, and goal completion across all your stores.",
  },
  {
    title: "Retail expansion",
    path: "/app/retail-expansion",
    description:
      "Identify the best retail locations to expand into. Rank potential spots by customer proximity and estimated revenue impact.",
  },
  {
    title: "Visibility",
    path: "/app/visibility",
    description:
      "Generate SEO-optimized blog content using AI. Create content briefs, review AI drafts, and publish directly to your Shopify blog.",
  },
  {
    title: "Settings",
    path: "/app/settings",
    description:
      "Configure delivery locations, Lalamove dispatch settings, carrier services, and shipping rates for your store.",
  },
];

const HELPER_CARD_SPECS = [
  {
    title: "Product launches",
    path: "/app/goals",
    description:
      "Track revenue and unit goals for new product launches. Compare results against benchmarks and segment by tag, location, or channel.",
  },
  {
    title: "UI elements",
    path: "/app/ui-elements",
    description:
      "Browse interactive examples of Polaris web components used throughout this app. Useful for development reference and testing.",
  },
];

export default function HomePage() {
  return (
    <s-page heading="Home">
      <div className={styles.homeBlocks}>
        <s-section heading="Functions">
          <div className={styles.functionsGrid}>
            {FUNCTION_CARD_SPECS.map((card) => (
              <div key={card.path} className={styles.card}>
                <h3 className={styles.cardTitle}>{card.title}</h3>
                <p className={styles.cardDesc}>{card.description}</p>
                <s-link href={card.path}>
                  <s-button variant="primary">Go to {card.title}</s-button>
                </s-link>
              </div>
            ))}
          </div>
        </s-section>

        <s-section heading="Ideas and helpers">
          <div className={styles.functionsGrid}>
            {HELPER_CARD_SPECS.map((card) => (
              <div key={card.path} className={styles.card}>
                <h3 className={styles.cardTitle}>{card.title}</h3>
                <p className={styles.cardDesc}>{card.description}</p>
                <s-link href={card.path}>
                  <s-button variant="primary">Go to {card.title}</s-button>
                </s-link>
              </div>
            ))}
          </div>
        </s-section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
