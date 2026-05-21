import prisma from "../../db.server";

type LearningExport = {
  category: string;
  beforeSnippet: string;
  afterSnippet: string;
  interpretation: string;
  acceptedAt: string;
};

type BrandAssetsExport = {
  version: number;
  exportedAt: string;
  shop: string;
  brand: {
    brandName: string | null;
    about: string | null;
    toneOfVoice: string | null;
    blogUrl: string | null;
    preferredLanguage: string | null;
    contentLanguage: string | null;
    benchmarks: string | null;
    brandCategory: string | null;
    editorialGuidelines: string | null;
    formatRecommendations: string | null;
    contentStrategyJson: string | null;
  };
  learnings: LearningExport[];
};

export async function buildExport(
  shop: string,
): Promise<{ json: string; markdown: string; filename: string } | null> {
  const assets = await prisma.brandAssets.findUnique({ where: { shop } });
  if (!assets) return null;

  const learningsRaw = await prisma.brandLearning
    .findMany({
      where: { shop, status: "accepted" },
      orderBy: { acceptedAt: "desc" },
    })
    .catch(() => [] as Awaited<ReturnType<typeof prisma.brandLearning.findMany>>);

  const learnings: LearningExport[] = learningsRaw.map((l) => ({
    category: l.category,
    beforeSnippet: l.beforeSnippet,
    afterSnippet: l.afterSnippet,
    interpretation: l.interpretation,
    acceptedAt: l.acceptedAt.toISOString(),
  }));

  const exportedAt = new Date().toISOString();
  const payload: BrandAssetsExport = {
    version: assets.exportVersion,
    exportedAt,
    shop,
    brand: {
      brandName: assets.brandName,
      about: assets.about,
      toneOfVoice: assets.toneOfVoice,
      blogUrl: assets.blogUrl,
      preferredLanguage: assets.preferredLanguage,
      contentLanguage: assets.contentLanguage,
      benchmarks: assets.benchmarks,
      brandCategory: assets.brandCategory,
      editorialGuidelines: assets.editorialGuidelines,
      formatRecommendations: assets.formatRecommendations,
      contentStrategyJson: assets.contentStrategyJson,
    },
    learnings,
  };

  await prisma.brandAssets.update({
    where: { id: assets.id },
    data: { lastExportedAt: new Date() },
  });

  const brandSlug =
    (assets.brandName ?? shop.split(".")[0])
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "brand";
  const dateStamp = exportedAt.slice(0, 10);

  return {
    json: JSON.stringify(payload, null, 2),
    markdown: renderMarkdown(payload),
    filename: `${brandSlug}-brand-assets-${dateStamp}`,
  };
}

function renderMarkdown(payload: BrandAssetsExport): string {
  const { brand, learnings } = payload;
  const lines: string[] = [];
  lines.push(`# ${brand.brandName ?? "Brand Assets"}`);
  lines.push("");
  lines.push(`_Exported ${payload.exportedAt} · version ${payload.version}_`);
  lines.push("");

  const section = (title: string, value: string | null) => {
    if (!value) return;
    lines.push(`## ${title}`);
    lines.push("");
    lines.push(value);
    lines.push("");
  };

  section("About", brand.about);
  section("Tone of voice", brand.toneOfVoice);
  section("Brand category", brand.brandCategory);
  section("Blog URL", brand.blogUrl);
  section("Content language", brand.contentLanguage);
  section("Benchmarks", brand.benchmarks);
  section("Editorial guidelines", brand.editorialGuidelines);
  section("Format recommendations", brand.formatRecommendations);

  if (learnings.length > 0) {
    lines.push("## Learnings from merchant edits");
    lines.push("");
    for (const l of learnings) {
      lines.push(`### ${l.category}`);
      lines.push("");
      lines.push(`${l.interpretation}`);
      lines.push("");
      lines.push(`> AI draft: ${l.beforeSnippet}`);
      lines.push(`>`);
      lines.push(`> Edited: ${l.afterSnippet}`);
      lines.push("");
      lines.push(`_Accepted ${l.acceptedAt}_`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
