import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import prisma from "../db.server";
import {
  listPendingDiffs,
  dismissDiff,
  markDiffReviewedIfFullyResolved,
  detectAndPersistDiffs,
} from "../services/storytelling/diff.server";
import { acceptLearning } from "../services/brand-assets/service.server";
import styles from "./app.storytelling/styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[storytelling:learnings] loader START shop=${shop}`);

  const diffs = await listPendingDiffs(shop);
  return { diffs };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string | null;
  console.info(`[storytelling:learnings] action intent=${intent ?? "?"} shop=${shop}`);

  if (intent === "acceptHypothesis") {
    const diffId = formData.get("diffId") as string;
    const category = formData.get("category") as string;
    const beforeSnippet = formData.get("beforeSnippet") as string;
    const afterSnippet = formData.get("afterSnippet") as string;
    const interpretation = formData.get("interpretation") as string;
    const sourceArticleId = formData.get("sourceArticleId") as string | null;

    const assets = await prisma.brandAssets.findUnique({ where: { shop } });
    if (!assets) {
      return { success: false, error: "Brand Assets not found. Save brand settings first." };
    }

    await acceptLearning({
      shop,
      brandAssetsId: assets.id,
      sourceDiffId: diffId,
      sourceArticleId,
      category,
      beforeSnippet,
      afterSnippet,
      interpretation,
    });
    await markDiffReviewedIfFullyResolved(shop, diffId);
    return { success: true, intent };
  }

  if (intent === "rejectHypothesis") {
    // Rejection is implicit: we don't persist anything.
    // Mark the diff as partially_accepted if any other hypotheses are resolved.
    const diffId = formData.get("diffId") as string;
    await markDiffReviewedIfFullyResolved(shop, diffId);
    return { success: true, intent };
  }

  if (intent === "dismissDiff") {
    const diffId = formData.get("diffId") as string;
    await dismissDiff(shop, diffId);
    return { success: true, intent };
  }

  if (intent === "checkForUpdates") {
    const result = await detectAndPersistDiffs({ admin, shop });
    return { success: true, intent, ...result };
  }

  return { success: false, error: "Unknown intent." };
};

type CategoryKey =
  | "tone"
  | "structure"
  | "vocabulary"
  | "product_mentions"
  | "other";

function categoryPillClass(category: string): string {
  const key = (category as CategoryKey) ?? "other";
  switch (key) {
    case "tone":
      return styles.hypothesisCategoryTone;
    case "structure":
      return styles.hypothesisCategoryStructure;
    case "vocabulary":
      return styles.hypothesisCategoryVocabulary;
    case "product_mentions":
      return styles.hypothesisCategoryProduct_mentions;
    default:
      return styles.hypothesisCategoryOther;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export default function LearningsPage() {
  const { diffs } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { t } = useTranslation("storytelling");

  const isChecking =
    fetcher.state !== "idle" &&
    fetcher.formData?.get("intent") === "checkForUpdates";

  return (
    <s-page heading={t("learningsRoute.pageHeading")}>
      <s-button variant="tertiary" slot="back-action">
        <Link to="/app/storytelling" style={{ color: "inherit", textDecoration: "none" }}>
          {t("common:button.back")}
        </Link>
      </s-button>
      <div slot="primary-action">
        <fetcher.Form method="POST">
          <input type="hidden" name="intent" value="checkForUpdates" />
          <s-button
            type="submit"
            variant="primary"
            {...(isChecking ? { loading: true, disabled: true } : {})}
          >
            {t("learningsRoute.checkForUpdates")}
          </s-button>
        </fetcher.Form>
      </div>

      <s-section>
        {diffs.length === 0 && (
          <s-paragraph>{t("learningsRoute.empty")}</s-paragraph>
        )}

        {diffs.map((diff) => {
          const publishedRelative = formatRelative(diff.publishedAt);
          return (
            <div key={diff.id} className={styles.diffArticleCard}>
              <div className={styles.diffArticleHeader}>
                <h3 className={styles.diffArticleTitle}>
                  {diff.draftTitle ?? diff.shopifyArticleId}
                </h3>
                {publishedRelative && (
                  <span className={styles.diffArticleMeta}>
                    {t("learningsRoute.publishedAt", { when: publishedRelative })}
                  </span>
                )}
              </div>

              <div className={styles.diffSplit}>
                <div className={styles.diffPanel}>
                  <span className={styles.diffPanelLabel}>
                    {t("learningsRoute.aiDraft")}
                  </span>
                  <div className={styles.diffPanelContent}>
                    {htmlToText(diff.beforeHtml)}
                  </div>
                </div>
                <div className={styles.diffPanel}>
                  <span className={styles.diffPanelLabel}>
                    {t("learningsRoute.yourEdit")}
                  </span>
                  <div className={styles.diffPanelContent}>
                    {htmlToText(diff.afterHtml)}
                  </div>
                </div>
              </div>

              <h4 className={styles.diffHypothesesHeading}>
                {diff.hypotheses.length > 1
                  ? t("learningsRoute.hypothesesHeading_plural", {
                      count: diff.hypotheses.length,
                    })
                  : t("learningsRoute.hypothesesHeading")}
              </h4>

              {diff.hypotheses.map((h) => {
                const isAccepted = h.resolved === "accepted";
                const isSubmittingThis =
                  fetcher.state !== "idle" &&
                  fetcher.formData?.get("diffId") === diff.id &&
                  fetcher.formData?.get("interpretation") === h.interpretation;
                return (
                  <div key={h.index} className={styles.hypothesisCard}>
                    <div className={styles.hypothesisHeader}>
                      <span
                        className={`${styles.hypothesisCategoryPill} ${categoryPillClass(h.category)}`}
                      >
                        {h.category}
                      </span>
                    </div>
                    <p className={styles.hypothesisInterpretation}>
                      {h.interpretation}
                    </p>
                    <div className={styles.hypothesisActions}>
                      {isAccepted ? (
                        <span className={styles.hypothesisAcceptedBadge}>
                          {t("learningsRoute.accepted")}
                        </span>
                      ) : (
                        <>
                          <fetcher.Form method="POST">
                            <input type="hidden" name="intent" value="rejectHypothesis" />
                            <input type="hidden" name="diffId" value={diff.id} />
                            <input type="hidden" name="interpretation" value={h.interpretation} />
                            <s-button type="submit" variant="tertiary">
                              {t("learningsRoute.reject")}
                            </s-button>
                          </fetcher.Form>
                          <fetcher.Form method="POST">
                            <input type="hidden" name="intent" value="acceptHypothesis" />
                            <input type="hidden" name="diffId" value={diff.id} />
                            <input type="hidden" name="sourceArticleId" value={diff.shopifyArticleId} />
                            <input type="hidden" name="category" value={h.category} />
                            <input type="hidden" name="beforeSnippet" value={h.beforeSnippet} />
                            <input type="hidden" name="afterSnippet" value={h.afterSnippet} />
                            <input type="hidden" name="interpretation" value={h.interpretation} />
                            <s-button
                              type="submit"
                              variant="primary"
                              {...(isSubmittingThis ? { loading: true, disabled: true } : {})}
                            >
                              {t("learningsRoute.accept")}
                            </s-button>
                          </fetcher.Form>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className={styles.diffDismissRow}>
                <fetcher.Form method="POST">
                  <input type="hidden" name="intent" value="dismissDiff" />
                  <input type="hidden" name="diffId" value={diff.id} />
                  <s-button type="submit" variant="tertiary">
                    {t("learningsRoute.dismissArticle")}
                  </s-button>
                </fetcher.Form>
              </div>
            </div>
          );
        })}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
