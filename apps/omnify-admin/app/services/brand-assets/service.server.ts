import prisma from "../../db.server";
import type { ContentGenBrandContext } from "../content-gen/client.server";
import { listAcceptedTraitsForContext } from "../tone-sources/inference.server";

export async function getBrandAssets(shop: string) {
  return prisma.brandAssets.findUnique({ where: { shop } });
}

export async function listLearnings(
  shop: string,
  options: { status?: string; limit?: number } = {},
) {
  const status = options.status ?? "accepted";
  return prisma.brandLearning
    .findMany({
      where: { shop, status },
      orderBy: { acceptedAt: "desc" },
      take: options.limit,
    })
    .catch((err) => {
      console.warn(`[brand-assets] listLearnings SKIP shop=${shop}`, err);
      return [];
    });
}

export async function removeLearning(shop: string, learningId: string) {
  const existing = await prisma.brandLearning.findFirst({
    where: { id: learningId, shop },
  });
  if (!existing) return null;
  return prisma.brandLearning.delete({ where: { id: learningId } });
}

export async function acceptLearning(input: {
  shop: string;
  brandAssetsId: string;
  sourceDiffId: string;
  sourceArticleId: string | null;
  category: string;
  beforeSnippet: string;
  afterSnippet: string;
  interpretation: string;
}) {
  console.info(
    `[brand-assets] acceptLearning shop=${input.shop} diff=${input.sourceDiffId} category=${input.category}`,
  );
  return prisma.brandLearning.create({
    data: {
      shop: input.shop,
      brandAssetsId: input.brandAssetsId,
      sourceDiffId: input.sourceDiffId,
      sourceArticleId: input.sourceArticleId,
      category: input.category,
      beforeSnippet: input.beforeSnippet,
      afterSnippet: input.afterSnippet,
      interpretation: input.interpretation,
      status: "accepted",
    },
  });
}

/**
 * Builds the brand-context blob that gets injected into every generation call
 * (Content Gen API for blog posts, Claude for alt text and diff interpretation).
 * Merges the BrandAssets config with accepted BrandLearning records so future
 * generations incorporate merchant-validated preferences.
 */
export async function getBrandContextForGeneration(
  shop: string,
): Promise<ContentGenBrandContext> {
  const assets = await prisma.brandAssets.findUnique({ where: { shop } });

  const fallbackBrandName = shop.split(".")[0];
  if (!assets) {
    return { brandName: fallbackBrandName, contentLanguage: "en_US" };
  }

  const context: ContentGenBrandContext = {
    about: assets.about,
    toneOfVoice: assets.toneOfVoice,
    brandName: assets.brandName ?? fallbackBrandName,
    blogUrl: assets.blogUrl,
    contentLanguage: assets.contentLanguage ?? "en_US",
    benchmarks: assets.benchmarks,
    brandCategory: assets.brandCategory,
    editorialGuidelines: assets.editorialGuidelines,
    formatRecommendations: assets.formatRecommendations,
  };

  const learnings = await prisma.brandLearning
    .findMany({
      where: { shop, status: "accepted" },
      orderBy: { acceptedAt: "desc" },
      take: 50,
    })
    .catch((err) => {
      console.warn(`[brand-assets] learnings lookup SKIP shop=${shop}`, err);
      return [] as Awaited<ReturnType<typeof prisma.brandLearning.findMany>>;
    });

  if (learnings.length > 0) {
    context.learnings = learnings.map((l) => ({
      category: l.category,
      beforeSnippet: l.beforeSnippet,
      afterSnippet: l.afterSnippet,
      interpretation: l.interpretation,
    }));
  }

  const toneTraits = await listAcceptedTraitsForContext(shop, 50).catch(
    (err) => {
      console.warn(`[brand-assets] toneTraits lookup SKIP shop=${shop}`, err);
      return [] as Array<{
        category: string;
        statement: string;
        sourceTypes: import("../tone-sources/types").ToneSourceType[];
      }>;
    },
  );

  if (toneTraits.length > 0) {
    context.toneTraits = toneTraits.map((t) => ({
      category: t.category,
      statement: t.statement,
      sourceTypes: t.sourceTypes,
    }));
  }

  return context;
}
