import prisma from "../../db.server";
import type { ContentGenJobResult } from "../content-gen/client.server";

export type BlogPostJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export async function createJob(input: {
  shop: string;
  jobId: string;
  briefJson: string;
}) {
  console.info(
    `[blog-post-job] create shop=${input.shop} jobId=${input.jobId}`,
  );
  return prisma.blogPostJob.create({
    data: {
      shop: input.shop,
      jobId: input.jobId,
      status: "pending",
      briefJson: input.briefJson,
    },
  });
}

export async function getJob(shop: string, jobId: string) {
  return prisma.blogPostJob.findFirst({ where: { shop, jobId } });
}

export async function listRecentJobs(shop: string, limit = 5) {
  return prisma.blogPostJob.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function updateJobStatus(input: {
  shop: string;
  jobId: string;
  status: BlogPostJobStatus;
  resultJson?: unknown;
  errorMessage?: string | null;
}) {
  const existing = await prisma.blogPostJob.findFirst({
    where: { shop: input.shop, jobId: input.jobId },
  });
  if (!existing) return null;

  if (existing.status !== input.status) {
    console.info(
      `[blog-post-job] status ${existing.status} -> ${input.status} shop=${input.shop} jobId=${input.jobId}`,
    );
  }

  return prisma.blogPostJob.update({
    where: { id: existing.id },
    data: {
      status: input.status,
      resultJson:
        input.resultJson !== undefined
          ? (input.resultJson as object)
          : undefined,
      errorMessage: input.errorMessage ?? undefined,
      lastPolledAt: new Date(),
    },
  });
}

/**
 * When a job transitions to `completed`, persist a BlogPostDraft row per
 * generated theme so we can later diff the AI draft against the published
 * version for the learning loop. Idempotent — safe to call multiple times.
 */
export async function persistDraftsFromJobResult(input: {
  shop: string;
  jobId: string;
  result: ContentGenJobResult["result"];
}) {
  const themes = input.result?.themes ?? [];
  if (themes.length === 0) return { created: 0 };

  let created = 0;
  for (const theme of themes) {
    const title = theme.metafields?.meta_title ?? theme.theme_key;
    const metaDescription = theme.metafields?.meta_description ?? null;

    const existing = await prisma.blogPostDraft.findUnique({
      where: {
        shop_jobId_themeKey: {
          shop: input.shop,
          jobId: input.jobId,
          themeKey: theme.theme_key,
        },
      },
    });
    if (existing) continue;

    await prisma.blogPostDraft.create({
      data: {
        shop: input.shop,
        jobId: input.jobId,
        themeKey: theme.theme_key,
        title,
        bodyHtml: theme.html,
        metaTitle: theme.metafields?.meta_title ?? null,
        metaDescription,
      },
    });
    created++;
  }

  if (created > 0) {
    console.info(
      `[blog-post-job] drafts persisted shop=${input.shop} jobId=${input.jobId} count=${created}`,
    );
  }
  return { created };
}

export async function markDraftPublished(input: {
  shop: string;
  jobId: string;
  themeKey: string;
  shopifyArticleId: string;
}) {
  const existing = await prisma.blogPostDraft.findUnique({
    where: {
      shop_jobId_themeKey: {
        shop: input.shop,
        jobId: input.jobId,
        themeKey: input.themeKey,
      },
    },
  });
  if (!existing) return null;

  return prisma.blogPostDraft.update({
    where: { id: existing.id },
    data: {
      shopifyArticleId: input.shopifyArticleId,
      publishedAt: new Date(),
    },
  });
}
