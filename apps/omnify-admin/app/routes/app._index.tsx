import type { HeadersFunction } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import { useLoaderData } from "react-router";
import styles from "./app._index/styles.module.css";
import { getHomeRoute, getNavItems, type NavItem } from "../utils/app-identity.server";

const ALL_FUNCTION_CARD_KEYS = [
  { key: "localDelivery", path: "/app/local-delivery" },
  { key: "salesGoals", path: "/app/sales-goals" },
  { key: "retailExpansion", path: "/app/retail-footprint" },
  { key: "priceTags", path: "/app/price-tags" },
  { key: "storytelling", path: "/app/storytelling" },
  { key: "settings", path: "/app/settings" },
] as const;

const HELPER_CARD_KEYS = [
  { key: "productLaunches", path: "/app/goals" },
  { key: "uiElements", path: "/app/ui-elements" },
] as const;

export const loader = async () => {
  const navHrefs = getNavItems().map((n: NavItem) => n.href);
  const functionCards = ALL_FUNCTION_CARD_KEYS.filter(
    (card) => navHrefs.includes(card.path),
  );
  return { functionCards };
};

export default function HomePage() {
  const { t } = useTranslation("home");
  const { functionCards } = useLoaderData<typeof loader>();

  return (
    <s-page heading={t("pageHeading")}>
      <div className={styles.homeBlocks}>
        <s-section heading={t("sections.functions")}>
          <div className={styles.functionsGrid}>
            {functionCards.map((card) => (
              <div key={card.path} className={styles.card}>
                <h3 className={styles.cardTitle}>
                  {t(`cards.${card.key}.title`)}
                </h3>
                <p className={styles.cardDesc}>
                  {t(`cards.${card.key}.description`)}
                </p>
                <s-link href={card.path}>
                  <s-button variant="primary">
                    {t("goTo", { title: t(`cards.${card.key}.title`) })}
                  </s-button>
                </s-link>
              </div>
            ))}
          </div>
        </s-section>

        <s-section heading={t("sections.ideasAndHelpers")}>
          <div className={styles.functionsGrid}>
            {HELPER_CARD_KEYS.map((card) => (
              <div key={card.path} className={styles.card}>
                <h3 className={styles.cardTitle}>
                  {t(`cards.${card.key}.title`)}
                </h3>
                <p className={styles.cardDesc}>
                  {t(`cards.${card.key}.description`)}
                </p>
                <s-link href={card.path}>
                  <s-button variant="primary">
                    {t("goTo", { title: t(`cards.${card.key}.title`) })}
                  </s-button>
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
