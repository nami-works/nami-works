import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const PRODUCTS_QUERY = /* GraphQL */ `
  query ProductsById($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        title
        tags
      }
    }
  }
`;

const TAGS_ADD = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

type ProductNode = {
  __typename: "Product";
  id: string;
  title: string;
  tags: string[];
};

type UnknownNode = { __typename: string };

type ProductsResponse = {
  nodes: Array<ProductNode | UnknownNode | null>;
};

type TagsAddResponse = {
  tagsAdd: {
    node: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

function toProductGid(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Product/${trimmed}`;
  return trimmed;
}

export async function applyPriceTagHandler(
  args: {
    productIds: string[];
    tag: string;
    confirm?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (args.productIds.length === 0) {
    return {
      content: [
        { type: "text", text: "Provide at least one productId." },
      ],
      isError: true,
    };
  }
  const tag = args.tag.trim();
  if (tag.length === 0) {
    return {
      content: [{ type: "text", text: "Tag must be a non-empty string." }],
      isError: true,
    };
  }

  const normalizedIds = args.productIds.map(toProductGid);

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const lookup = await client.request<ProductsResponse>(PRODUCTS_QUERY, {
    variables: { ids: normalizedIds },
  });
  if (lookup.errors) {
    throw new Error(
      `Shopify GraphQL error: ${lookup.errors.message ?? "unknown error"}`,
    );
  }

  const products: ProductNode[] = (lookup.data?.nodes ?? []).filter(
    (n): n is ProductNode => n !== null && n.__typename === "Product",
  );

  if (products.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `None of the provided IDs resolved to a Product: ${normalizedIds.join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  const alreadyTagged = products.filter((p) => p.tags.includes(tag));
  const needsTag = products.filter((p) => !p.tags.includes(tag));

  const previewLines = [
    `Tag to add: "${tag}"`,
    `Will affect ${needsTag.length} product(s):`,
    ...needsTag.map((p) => `  • ${p.title} (${p.id})`),
    ...(alreadyTagged.length > 0
      ? [
          ``,
          `Already tagged (will skip) — ${alreadyTagged.length}:`,
          ...alreadyTagged.map((p) => `  • ${p.title} (${p.id})`),
        ]
      : []),
  ].join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({
      summary: previewLines,
      actionLabel: `apply tag "${tag}"`,
    });
  }

  if (needsTag.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No-op: all ${products.length} product(s) already carry tag "${tag}".`,
        },
      ],
    };
  }

  const successes: string[] = [];
  const failures: string[] = [];
  for (const product of needsTag) {
    const res = await client.request<TagsAddResponse>(TAGS_ADD, {
      variables: { id: product.id, tags: [tag] },
    });
    if (res.errors) {
      failures.push(
        `  • ${product.title} (${product.id}): transport error: ${res.errors.message ?? "unknown"}`,
      );
      continue;
    }
    const userErrors = res.data?.tagsAdd.userErrors ?? [];
    if (userErrors.length > 0) {
      failures.push(
        `  • ${product.title} (${product.id}): ${userErrors.map((e) => e.message).join("; ")}`,
      );
      continue;
    }
    successes.push(`  • ${product.title} (${product.id})`);
  }

  const body = [
    `Applied tag "${tag}" to ${successes.length}/${needsTag.length} product(s).`,
    ``,
    ...(successes.length > 0 ? ["Success:", ...successes] : []),
    ...(failures.length > 0 ? ["", "Failed:", ...failures] : []),
  ].join("\n");

  return {
    content: [{ type: "text", text: body }],
    ...(failures.length > 0 ? { isError: true } : {}),
  };
}

registerToolDefinition({
  name: "shopify_apply_price_tag",
  description:
    "Add a tag to one or more Shopify products (used for campaign inclusion/exclusion, e.g. BEAUTYBACK or lancto markers). Two-step: first call (no confirm) returns a preview; call again with confirm: true to apply.",
  inputSchema: {
    productIds: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "Shopify product IDs. Accepts full GIDs or numeric IDs (normalized).",
      ),
    tag: z
      .string()
      .min(1)
      .describe("Tag to add. Case-sensitive."),
    confirm: z
      .boolean()
      .optional()
      .describe("Set to true on the second call to execute the change."),
  },
  handler: applyPriceTagHandler,
});
