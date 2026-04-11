import prisma from "../../db.server";
import type { ContentGenBrandContext } from "../content-gen/client.server";

export async function getBrandAssets(shop: string) {
  return prisma.brandAssets.findUnique({ where: { shop } });
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

  // BrandLearning table is added in Phase 3 — guard the lookup so Phase 2
  // can ship independently.
  try {
    const client = prisma as unknown as {
      brandLearning?: {
        findMany: (args: {
          where: { shop: string; status: string };
          orderBy: { acceptedAt: "desc" };
          take: number;
        }) => Promise<
          Array<{
            category: string;
            beforeSnippet: string;
            afterSnippet: string;
            interpretation: string;
          }>
        >;
      };
    };
    if (client.brandLearning) {
      const learnings = await client.brandLearning.findMany({
        where: { shop, status: "accepted" },
        orderBy: { acceptedAt: "desc" },
        take: 50,
      });
      if (learnings.length > 0) {
        context.learnings = learnings.map((l) => ({
          category: l.category,
          beforeSnippet: l.beforeSnippet,
          afterSnippet: l.afterSnippet,
          interpretation: l.interpretation,
        }));
      }
    }
  } catch (err) {
    console.warn(`[brand-assets] learnings lookup SKIP shop=${shop}`, err);
  }

  return context;
}
