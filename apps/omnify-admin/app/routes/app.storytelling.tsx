import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, Outlet, useLoaderData, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useTranslation } from "react-i18next";
import prisma from "../db.server";
import { listRecentJobs } from "../services/storytelling/blog-post-job.server";
import styles from "./app.storytelling/styles.module.css";

type RecentJob = {
  jobId: string;
  status: string;
  createdAt: string;
  briefMacroName: string | null;
};

type StorytellingLayoutData = {
  pendingDiffsCount: number;
  recentJobs: RecentJob[];
};

function extractMacroName(briefJson: string | null): string | null {
  if (!briefJson) return null;
  try {
    const parsed = JSON.parse(briefJson) as { macro_name?: unknown };
    return typeof parsed.macro_name === "string" ? parsed.macro_name : null;
  } catch {
    return null;
  }
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<StorytellingLayoutData> => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  console.info(`[storytelling] loader shop=${shop}`);

  // BlogPostDiff arrives in Phase 3 — guard the count so Phase 2 can ship.
  let pendingDiffsCount = 0;
  try {
    const client = prisma as unknown as {
      blogPostDiff?: { count: (args: { where: { shop: string; status: string } }) => Promise<number> };
    };
    if (client.blogPostDiff) {
      pendingDiffsCount = await client.blogPostDiff.count({
        where: { shop, status: "pending_review" },
      });
    }
  } catch (err) {
    console.warn(`[storytelling] pending diffs count SKIP shop=${shop}`, err);
  }

  const jobs = await listRecentJobs(shop, 5).catch((err) => {
    console.warn(`[storytelling] recent jobs SKIP shop=${shop}`, err);
    return [] as Array<{
      jobId: string;
      status: string;
      createdAt: Date;
      briefJson: string | null;
    }>;
  });

  const recentJobs: RecentJob[] = jobs.map((j) => ({
    jobId: j.jobId,
    status: j.status,
    createdAt: j.createdAt.toISOString(),
    briefMacroName: extractMacroName(j.briefJson),
  }));

  return { pendingDiffsCount, recentJobs };
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function StorytellingLayout() {
  const { t } = useTranslation("storytelling");
  const location = useLocation();
  const { pendingDiffsCount, recentJobs } =
    useLoaderData<typeof loader>();

  const tabs = [
    { id: "blog-posts", label: t("tabs.blogPosts"), to: "/app/storytelling" },
    { id: "alt-text", label: t("tabs.altText"), to: "/app/storytelling/alt-text" },
  ];

  const activeId = location.pathname.includes("/alt-text")
    ? "alt-text"
    : "blog-posts";

  const isBlogPostsTab = activeId === "blog-posts";

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

      {isBlogPostsTab && pendingDiffsCount > 0 && (
        <div className={styles.pendingDiffsBanner}>
          <span>
            {t("pendingDiffs.banner", {
              count: pendingDiffsCount,
              defaultValue_one: `${pendingDiffsCount} published article has edits to learn from`,
              defaultValue_other: `${pendingDiffsCount} published articles have edits to learn from`,
            })}
          </span>
          <Link to="/app/storytelling/learnings">
            {t("pendingDiffs.review")} →
          </Link>
        </div>
      )}

      {isBlogPostsTab && (
        <s-section slot="aside" heading={t("recentGenerations.heading")}>
          {recentJobs.length === 0 ? (
            <s-paragraph>{t("recentGenerations.empty")}</s-paragraph>
          ) : (
            <div className={styles.recentJobList}>
              {recentJobs.map((job) => {
                const statusClass =
                  job.status === "running" || job.status === "pending"
                    ? styles.recentJobStatusRunning
                    : job.status === "completed"
                      ? styles.recentJobStatusCompleted
                      : job.status === "failed"
                        ? styles.recentJobStatusFailed
                        : "";
                return (
                  <Link
                    key={job.jobId}
                    to={`/app/storytelling/review?jobId=${job.jobId}`}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    <div className={styles.recentJobRow}>
                      <div className={styles.recentJobTitle}>
                        {job.briefMacroName ?? job.jobId.slice(0, 8)}
                      </div>
                      <div className={styles.recentJobMeta}>
                        <span className={statusClass}>
                          {t(`review.statusLabels.${job.status}`, {
                            defaultValue: job.status,
                          })}
                        </span>{" "}
                        · {timeAgo(job.createdAt)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </s-section>
      )}

      <Outlet />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
