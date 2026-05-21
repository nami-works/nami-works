import prisma from "../../db.server";
import { generateAltTextSuggestion } from "../claude/client.server";
import { getBrandContextForGeneration } from "../brand-assets/service.server";
import {
  paginateProductsWithMedia,
  updateImageAlt,
} from "../shopify/products-media.server";

type AdminClient = Parameters<typeof paginateProductsWithMedia>[0];

const PRODUCT_CONTEXT_QUERY = `#graphql
  query GetProductContextForAltText($id: ID!) {
    product(id: $id) {
      id
      descriptionHtml
      metafields(first: 20) {
        edges {
          node {
            namespace
            key
            value
            type
          }
        }
      }
    }
  }
`;

type ProductContext = {
  descriptionText: string | null;
  metafields: Array<{ namespace: string; key: string; value: string }>;
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetch the PDP context Claude uses to ground alt-text suggestions:
 * the stripped description body + the product's metafields. Metafields
 * carry the high-leverage signal (key ingredient, primary benefit,
 * category, tags) — Claude picks the relevant ones at generation time.
 */
async function fetchProductContext(
  admin: AdminClient,
  productId: string,
): Promise<ProductContext> {
  try {
    const response = await admin.graphql(PRODUCT_CONTEXT_QUERY, {
      variables: { id: productId },
    });
    const json = (await response.json()) as {
      data?: {
        product?: {
          descriptionHtml?: string | null;
          metafields?: {
            edges?: Array<{
              node: {
                namespace: string;
                key: string;
                value: string;
                type?: string;
              };
            }>;
          };
        };
      };
    };
    const product = json.data?.product;
    if (!product) return { descriptionText: null, metafields: [] };

    const descriptionText = product.descriptionHtml
      ? stripHtml(product.descriptionHtml).slice(0, 2000)
      : null;
    const metafields = (product.metafields?.edges ?? [])
      .map((e) => e.node)
      // Drop JSON / reference / file metafields — keep simple text-like values
      // Claude can lean on without parsing a JSON envelope.
      .filter(
        (m) =>
          !m.type ||
          (!m.type.startsWith("json") &&
            m.type !== "file_reference" &&
            !m.type.startsWith("list.")),
      )
      .map((m) => ({
        namespace: m.namespace,
        key: m.key,
        value: m.value.slice(0, 400),
      }))
      .slice(0, 15);

    return { descriptionText, metafields };
  } catch (err) {
    console.warn(`[alt-text:context] fetch SKIP productId=${productId}`, err);
    return { descriptionText: null, metafields: [] };
  }
}

const DAILY_DRAIN_LIMIT = 100;
const SHOPIFY_WRITE_THROTTLE_MS = 500;

const FILENAME_ALT_PATTERN =
  /^(IMG|DSC|DCIM|MVI|PHOTO|IMAGE|PICT|DSCF)[_\- ]?\d+/i;

export function isWeakAlt(alt: string | null | undefined, productTitle?: string | null): boolean {
  if (!alt) return true;
  const trimmed = alt.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.split(/\s+/).length < 4) return true;
  if (FILENAME_ALT_PATTERN.test(trimmed)) return true;
  if (/\.(jpe?g|png|webp|gif)$/i.test(trimmed)) return true;
  if (productTitle && trimmed.toLowerCase() === productTitle.trim().toLowerCase()) {
    return true;
  }
  return false;
}

export function classifyAlt(
  alt: string | null | undefined,
  productTitle?: string | null,
): "missing" | "weak" | "ok" {
  if (!alt || alt.trim().length === 0) return "missing";
  if (isWeakAlt(alt, productTitle)) return "weak";
  return "ok";
}

export async function auditProductImages(input: {
  admin: AdminClient;
  shop: string;
}): Promise<{ scanned: number; upserted: number }> {
  const { admin, shop } = input;
  console.info(`[alt-text:audit] START shop=${shop}`);
  let scanned = 0;
  let upserted = 0;

  for await (const product of paginateProductsWithMedia(admin)) {
    for (const image of product.images) {
      scanned++;
      const detectedState = classifyAlt(image.altText, product.title);

      await prisma.productImageAltSuggestion.upsert({
        where: {
          shop_imageId: { shop, imageId: image.id },
        },
        create: {
          shop,
          productId: product.id,
          productTitle: product.title,
          imageId: image.id,
          imageUrl: image.url,
          currentAlt: image.altText,
          detectedState,
          status: "pending",
        },
        update: {
          productTitle: product.title,
          imageUrl: image.url,
          currentAlt: image.altText,
          detectedState,
        },
      });
      upserted++;
    }
  }

  console.info(`[alt-text:audit] OK shop=${shop} scanned=${scanned}`);
  return { scanned, upserted };
}

export async function generateSuggestion(input: {
  admin: AdminClient;
  shop: string;
  suggestionId: string;
}) {
  const row = await prisma.productImageAltSuggestion.findFirst({
    where: { id: input.suggestionId, shop: input.shop },
  });
  if (!row) return { error: "Suggestion not found." };

  const brandContext = await getBrandContextForGeneration(input.shop);
  const { descriptionText, metafields } = await fetchProductContext(
    input.admin,
    row.productId,
  );
  const result = await generateAltTextSuggestion({
    shop: input.shop,
    imageUrl: row.imageUrl,
    productTitle: row.productTitle,
    productDescription: descriptionText,
    productMetafields: metafields,
    brandContext,
  });

  if ("error" in result) {
    await prisma.productImageAltSuggestion.update({
      where: { id: row.id },
      data: { errorMessage: result.error, status: "failed" },
    });
    return { error: result.error };
  }

  await prisma.productImageAltSuggestion.update({
    where: { id: row.id },
    data: {
      suggestion: result.suggestion,
      generatedAt: new Date(),
      errorMessage: null,
    },
  });
  return { suggestion: result.suggestion };
}

export async function bulkGenerate(input: {
  admin: AdminClient;
  shop: string;
  filter: "missing" | "weak" | "missing_or_weak";
}): Promise<{ generated: number; errors: number }> {
  const states =
    input.filter === "missing"
      ? ["missing"]
      : input.filter === "weak"
        ? ["weak"]
        : ["missing", "weak"];

  const rows = await prisma.productImageAltSuggestion.findMany({
    where: {
      shop: input.shop,
      detectedState: { in: states },
      suggestion: null,
      status: "pending",
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  let generated = 0;
  let errors = 0;
  for (const row of rows) {
    const result = await generateSuggestion({
      admin: input.admin,
      shop: input.shop,
      suggestionId: row.id,
    });
    if ("error" in result) errors++;
    else generated++;
  }
  console.info(
    `[alt-text:bulk] OK shop=${input.shop} generated=${generated} errors=${errors}`,
  );
  return { generated, errors };
}

export async function updateSuggestionText(input: {
  shop: string;
  suggestionId: string;
  suggestion: string;
}) {
  return prisma.productImageAltSuggestion.update({
    where: { id: input.suggestionId },
    data: { suggestion: input.suggestion },
  });
}

export async function approveSuggestion(input: {
  shop: string;
  suggestionId: string;
}) {
  const row = await prisma.productImageAltSuggestion.findFirst({
    where: { id: input.suggestionId, shop: input.shop },
  });
  if (!row) return { error: "Suggestion not found." };
  if (!row.suggestion) return { error: "No suggestion to approve." };

  const now = new Date();
  await prisma.productImageAltSuggestion.update({
    where: { id: row.id },
    data: {
      status: "queued",
      approvedAt: now,
      queuedAt: now,
    },
  });
  return { ok: true };
}

export async function rejectSuggestion(input: {
  shop: string;
  suggestionId: string;
}) {
  return prisma.productImageAltSuggestion.update({
    where: { id: input.suggestionId },
    data: { status: "rejected" },
  });
}

export type AltTextSummary = {
  total: number;
  missing: number;
  weak: number;
  ok: number;
  approved: number;
  queued: number;
  appliedToday: number;
  queueRemaining: number;
  etaDays: number;
};

function startOfDayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function getAuditSummary(shop: string): Promise<AltTextSummary> {
  const [total, missing, weak, ok, queued, appliedToday] = await Promise.all([
    prisma.productImageAltSuggestion.count({ where: { shop } }),
    prisma.productImageAltSuggestion.count({
      where: { shop, detectedState: "missing", status: { not: "applied" } },
    }),
    prisma.productImageAltSuggestion.count({
      where: { shop, detectedState: "weak", status: { not: "applied" } },
    }),
    prisma.productImageAltSuggestion.count({
      where: { shop, detectedState: "ok" },
    }),
    prisma.productImageAltSuggestion.count({
      where: { shop, status: "queued" },
    }),
    prisma.productImageAltSuggestion.count({
      where: {
        shop,
        status: "applied",
        appliedAt: { gte: startOfDayUtc() },
      },
    }),
  ]);

  const approved = queued;
  const queueRemaining = queued;
  const etaDays = Math.ceil(queueRemaining / DAILY_DRAIN_LIMIT);
  return {
    total,
    missing,
    weak,
    ok,
    approved,
    queued,
    appliedToday,
    queueRemaining,
    etaDays,
  };
}

export async function listSuggestions(input: {
  shop: string;
  filter: "all" | "missing" | "weak" | "approved" | "queued" | "applied";
  limit?: number;
}) {
  const where: Record<string, unknown> = { shop: input.shop };
  if (input.filter === "missing") {
    where.detectedState = "missing";
    where.status = { notIn: ["applied", "rejected"] };
  } else if (input.filter === "weak") {
    where.detectedState = "weak";
    where.status = { notIn: ["applied", "rejected"] };
  } else if (input.filter === "approved") {
    where.status = "approved";
  } else if (input.filter === "queued") {
    where.status = "queued";
  } else if (input.filter === "applied") {
    where.status = "applied";
  } else {
    where.detectedState = { in: ["missing", "weak"] };
  }

  return prisma.productImageAltSuggestion.findMany({
    where: where as {
      shop: string;
      detectedState?: string | { in: string[] };
      status?: string | { in: string[]; notIn?: string[] };
    },
    orderBy: [{ productTitle: "asc" }, { createdAt: "asc" }],
    take: input.limit ?? 500,
  });
}

/**
 * Drain up to DAILY_DRAIN_LIMIT queued suggestions per shop to Shopify.
 * Respects a 500ms throttle between writes to stay under the 2 req/s
 * productUpdateMedia limit.
 */
export async function drainDailyApplyQueue(input: {
  admin: AdminClient;
  shop: string;
  limit?: number;
}): Promise<{ applied: number; failed: number }> {
  const limit = input.limit ?? DAILY_DRAIN_LIMIT;
  const rows = await prisma.productImageAltSuggestion.findMany({
    where: { shop: input.shop, status: "queued" },
    orderBy: { queuedAt: "asc" },
    take: limit,
  });

  console.info(
    `[alt-text:drain] START shop=${input.shop} candidates=${rows.length}`,
  );
  let applied = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.suggestion) {
      await prisma.productImageAltSuggestion.update({
        where: { id: row.id },
        data: { status: "failed", errorMessage: "Empty suggestion" },
      });
      failed++;
      continue;
    }

    const result = await updateImageAlt(input.admin, {
      productId: row.productId,
      imageId: row.imageId,
      alt: row.suggestion,
    });
    if (result.ok) {
      await prisma.productImageAltSuggestion.update({
        where: { id: row.id },
        data: {
          status: "applied",
          appliedAt: new Date(),
          errorMessage: null,
        },
      });
      applied++;
    } else {
      await prisma.productImageAltSuggestion.update({
        where: { id: row.id },
        data: { status: "failed", errorMessage: result.error },
      });
      failed++;
    }

    if (i < rows.length - 1) {
      await new Promise((r) => setTimeout(r, SHOPIFY_WRITE_THROTTLE_MS));
    }
  }

  console.info(
    `[alt-text:drain] OK shop=${input.shop} applied=${applied} failed=${failed}`,
  );
  return { applied, failed };
}

export { DAILY_DRAIN_LIMIT };
