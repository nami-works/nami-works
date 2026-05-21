import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const VARIANT_QUERY = /* GraphQL */ `
  query VariantPreview($id: ID!) {
    productVariant(id: $id) {
      id
      title
      displayName
      price
      compareAtPrice
      sku
      product { id title }
    }
  }
`;

const BULK_UPDATE = /* GraphQL */ `
  mutation BulkUpdateVariants(
    $productId: ID!
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

type VariantPreview = {
  id: string;
  title: string;
  displayName: string | null;
  price: string;
  compareAtPrice: string | null;
  sku: string | null;
  product: { id: string; title: string };
};

type VariantPreviewResponse = {
  productVariant: VariantPreview | null;
};

type BulkUpdateResponse = {
  productVariantsBulkUpdate: {
    productVariants: Array<{ id: string; price: string }> | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

function toVariantGid(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/ProductVariant/${trimmed}`;
  return trimmed;
}

export async function updateProductPriceHandler(
  args: { variantId: string; price: string; confirm?: boolean | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const variantId = toVariantGid(args.variantId);

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const lookup = await client.request<VariantPreviewResponse>(VARIANT_QUERY, {
    variables: { id: variantId },
  });
  if (lookup.errors) {
    throw new Error(
      `Shopify GraphQL error: ${lookup.errors.message ?? "unknown error"}`,
    );
  }

  const variant = lookup.data?.productVariant;
  if (!variant) {
    return {
      content: [
        { type: "text", text: `No variant found for ID ${args.variantId}.` },
      ],
      isError: true,
    };
  }

  const summary = [
    `Product: ${variant.product.title} (${variant.product.id})`,
    `Variant: ${variant.displayName ?? variant.title}${variant.sku ? ` [${variant.sku}]` : ""}`,
    `Current price: ${variant.price}`,
    variant.compareAtPrice
      ? `Current compare-at: ${variant.compareAtPrice}`
      : null,
    `New price:     ${args.price}`,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({
      summary,
      actionLabel: "update product price",
    });
  }

  const mutationRes = await client.request<BulkUpdateResponse>(BULK_UPDATE, {
    variables: {
      productId: variant.product.id,
      variants: [{ id: variant.id, price: args.price }],
    },
  });
  if (mutationRes.errors) {
    throw new Error(
      `Shopify GraphQL error: ${mutationRes.errors.message ?? "unknown error"}`,
    );
  }

  const data = mutationRes.data?.productVariantsBulkUpdate;
  if (data?.userErrors && data.userErrors.length > 0) {
    const reasons = data.userErrors
      .map(
        (e) =>
          `  • ${e.field ? e.field.join(".") : "(no field)"}: ${e.message}`,
      )
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Shopify rejected the update:\n${reasons}`,
        },
      ],
      isError: true,
    };
  }

  const updated = data?.productVariants?.[0];
  return {
    content: [
      {
        type: "text",
        text: `Updated ${variant.product.title} · ${variant.displayName ?? variant.title}: price is now ${updated?.price ?? args.price}.`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_update_product_price",
  description:
    "Set the price of a single Shopify product variant. Two-step: the first call (no confirm) returns a preview; call again with confirm: true to execute.",
  inputSchema: {
    variantId: z
      .string()
      .min(1)
      .describe(
        "Shopify variant ID. Accepts a full GID or a numeric ID (the tool normalizes).",
      ),
    price: z
      .string()
      .min(1)
      .describe(
        "New price as a decimal string, e.g. 79.90. Uses the shop's default currency.",
      ),
    confirm: z
      .boolean()
      .optional()
      .describe("Set to true on the second call to execute the change."),
  },
  handler: updateProductPriceHandler,
});
