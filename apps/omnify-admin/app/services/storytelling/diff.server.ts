import prisma from "../../db.server";
import { interpretDiff, type DiffHypothesis } from "../claude/client.server";
import { getBrandContextForGeneration } from "../brand-assets/service.server";

type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

const ARTICLE_QUERY = `#graphql
  query GetArticle($id: ID!) {
    article(id: $id) {
      id
      title
      body
    }
  }
`;

export async function fetchPublishedArticle(
  admin: AdminClient,
  articleGid: string,
): Promise<{ body: string; title: string } | null> {
  try {
    const response = await admin.graphql(ARTICLE_QUERY, {
      variables: { id: articleGid },
    });
    const json = (await response.json()) as {
      data?: {
        article?: { id: string; title: string; body: string } | null;
      };
    };
    const article = json.data?.article;
    if (!article) return null;
    return { body: article.body, title: article.title };
  } catch (err) {
    console.warn(`[storytelling:diff] fetchArticle FAILED gid=${articleGid}`, err);
    return null;
  }
}

function normalizeHtml(html: string): string {
  return html
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
}

function hasMeaningfulChange(before: string, after: string): boolean {
  const a = normalizeHtml(before);
  const b = normalizeHtml(after);
  if (a === b) return false;
  // Ignore trivial whitespace-only diffs
  const normA = a.replace(/[^\w]/g, "").toLowerCase();
  const normB = b.replace(/[^\w]/g, "").toLowerCase();
  return normA !== normB;
}

/**
 * Walk all published BlogPostDrafts for a shop, fetch the current
 * Shopify article body, and if it has changed since the draft was
 * persisted, call Claude to interpret the diff and upsert a
 * BlogPostDiff row (pending_review).
 *
 * Called from a "Check for updates" action on the Blog Posts index.
 * Webhook-driven detection is a follow-up.
 */
export async function detectAndPersistDiffs(input: {
  admin: AdminClient;
  shop: string;
}): Promise<{ detected: number; skipped: number }> {
  const { admin, shop } = input;
  console.info(`[storytelling:diff] detect START shop=${shop}`);

  const drafts = await prisma.blogPostDraft.findMany({
    where: {
      shop,
      shopifyArticleId: { not: null },
    },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  let detected = 0;
  let skipped = 0;
  const brandContext = await getBrandContextForGeneration(shop);

  for (const draft of drafts) {
    if (!draft.shopifyArticleId) continue;

    const existing = await prisma.blogPostDiff.findFirst({
      where: {
        shop,
        draftId: draft.id,
        status: { in: ["pending_review", "partially_accepted"] },
      },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const article = await fetchPublishedArticle(admin, draft.shopifyArticleId);
    if (!article) {
      skipped++;
      continue;
    }

    if (!hasMeaningfulChange(draft.bodyHtml, article.body)) {
      skipped++;
      continue;
    }

    const result = await interpretDiff({
      shop,
      beforeHtml: draft.bodyHtml,
      afterHtml: article.body,
      brandContext,
    });

    if ("error" in result) {
      console.warn(
        `[storytelling:diff] interpret SKIP shop=${shop} draft=${draft.id} reason=${result.error}`,
      );
      skipped++;
      continue;
    }

    if (result.hypotheses.length === 0) {
      skipped++;
      continue;
    }

    await prisma.blogPostDiff.create({
      data: {
        shop,
        draftId: draft.id,
        shopifyArticleId: draft.shopifyArticleId,
        beforeHtml: draft.bodyHtml,
        afterHtml: article.body,
        hypotheses: result.hypotheses as unknown as object,
        status: "pending_review",
      },
    });
    detected++;
  }

  console.info(
    `[storytelling:diff] detect OK shop=${shop} detected=${detected} skipped=${skipped}`,
  );
  return { detected, skipped };
}

export type DiffListEntry = {
  id: string;
  draftId: string;
  shopifyArticleId: string;
  detectedAt: string;
  status: string;
  draftTitle: string | null;
  publishedAt: string | null;
  beforeHtml: string;
  afterHtml: string;
  hypotheses: Array<
    DiffHypothesis & { index: number; resolved: "accepted" | "rejected" | null }
  >;
};

export async function listPendingDiffs(shop: string): Promise<DiffListEntry[]> {
  const diffs = await prisma.blogPostDiff.findMany({
    where: {
      shop,
      status: { in: ["pending_review", "partially_accepted"] },
    },
    orderBy: { detectedAt: "desc" },
  });

  if (diffs.length === 0) return [];

  const draftIds = Array.from(new Set(diffs.map((d) => d.draftId)));
  const drafts = await prisma.blogPostDraft.findMany({
    where: { id: { in: draftIds } },
  });
  const draftById = new Map(drafts.map((d) => [d.id, d]));

  const articleIds = Array.from(
    new Set(diffs.map((d) => d.shopifyArticleId)),
  );
  const existingLearnings = await prisma.brandLearning.findMany({
    where: {
      shop,
      sourceArticleId: { in: articleIds },
    },
  });
  const resolvedByArticleAndInterpretation = new Map<string, "accepted">();
  for (const l of existingLearnings) {
    const key = `${l.sourceArticleId}::${l.interpretation}`;
    resolvedByArticleAndInterpretation.set(key, "accepted");
  }

  return diffs.map((d) => {
    const draft = draftById.get(d.draftId);
    const rawHypotheses = Array.isArray(d.hypotheses)
      ? (d.hypotheses as unknown as DiffHypothesis[])
      : [];

    return {
      id: d.id,
      draftId: d.draftId,
      shopifyArticleId: d.shopifyArticleId,
      detectedAt: d.detectedAt.toISOString(),
      status: d.status,
      draftTitle: draft?.title ?? null,
      publishedAt: draft?.publishedAt?.toISOString() ?? null,
      beforeHtml: d.beforeHtml,
      afterHtml: d.afterHtml,
      hypotheses: rawHypotheses.map((h, index) => ({
        ...h,
        index,
        resolved:
          resolvedByArticleAndInterpretation.get(
            `${d.shopifyArticleId}::${h.interpretation}`,
          ) ?? null,
      })),
    };
  });
}

export async function dismissDiff(shop: string, diffId: string) {
  return prisma.blogPostDiff.updateMany({
    where: { id: diffId, shop },
    data: { status: "dismissed", reviewedAt: new Date() },
  });
}

export async function markDiffReviewedIfFullyResolved(
  shop: string,
  diffId: string,
) {
  const diff = await prisma.blogPostDiff.findFirst({
    where: { id: diffId, shop },
  });
  if (!diff) return;
  const hypotheses = Array.isArray(diff.hypotheses)
    ? (diff.hypotheses as unknown as DiffHypothesis[])
    : [];
  if (hypotheses.length === 0) return;

  const learningsForArticle = await prisma.brandLearning.findMany({
    where: { shop, sourceArticleId: diff.shopifyArticleId },
  });
  const resolvedInterpretations = new Set(
    learningsForArticle.map((l) => l.interpretation),
  );

  const allResolved = hypotheses.every((h) =>
    resolvedInterpretations.has(h.interpretation),
  );

  if (allResolved) {
    await prisma.blogPostDiff.update({
      where: { id: diff.id },
      data: { status: "reviewed", reviewedAt: new Date() },
    });
  } else {
    await prisma.blogPostDiff.update({
      where: { id: diff.id },
      data: { status: "partially_accepted" },
    });
  }
}
