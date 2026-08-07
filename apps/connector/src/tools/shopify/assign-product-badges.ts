import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * Bulk-assigns existing "etiqueta" badges (custom.etiquetas metafield,
 * list.metaobject_reference) to products. The store has 20 badge
 * metaobjects defined and, as of 2026-08, 0 assigned outside the
 * auto-generated "% off"/"R$ off" discount badges (see
 * gebeauty/scripts/apply_off_badges.py, a separate concern this tool
 * doesn't touch) — pure upside, per the tool backlog.
 *
 * Only assigns badges that already exist as metaobjects (matched by
 * `texto` field or handle, case-insensitive) — never creates a new
 * claim badge, since that needs design/copy sign-off, unlike the
 * mechanically-derivable discount badges the other script creates.
 */

const LIST_ETIQUETAS_QUERY = /* GraphQL */ `
  query ListEtiquetas($cursor: String) {
    metaobjects(type: "etiqueta", first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        handle
        fields { key value }
      }
    }
  }
`;

const PRODUCTS_WITH_BADGES_QUERY = /* GraphQL */ `
  query ProductsWithBadges($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        title
        etiquetas: metafield(namespace: "custom", key: "etiquetas") {
          references(first: 25) {
            nodes {
              ... on Metaobject {
                id
                texto: field(key: "texto") { value }
              }
            }
          }
        }
      }
    }
  }
`;

const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation SetEtiquetas($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message code }
    }
  }
`;

type MetaobjectsResponse = {
  metaobjects: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{ id: string; handle: string; fields: Array<{ key: string; value: string }> }>;
  };
};

type ProductsResponse = {
  nodes: Array<
    | {
        __typename: "Product";
        id: string;
        title: string;
        etiquetas: { references: { nodes: Array<{ id: string; texto: { value: string } | null }> } } | null;
      }
    | { __typename: string }
    | null
  >;
};

type MetafieldsSetResponse = {
  metafieldsSet: {
    metafields: Array<{ id: string }>;
    userErrors: Array<{ field: string[] | null; message: string; code: string }>;
  };
};

type Badge = { id: string; texto: string; handle: string };

async function loadBadgeLibrary(
  client: Awaited<ReturnType<typeof getShopifyClient>>,
): Promise<Badge[]> {
  const badges: Badge[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  while (hasNextPage) {
    const res: { errors?: { message?: string }; data?: MetaobjectsResponse } =
      await client.request<MetaobjectsResponse>(LIST_ETIQUETAS_QUERY, {
        variables: { cursor },
      });
    if (res.errors) {
      throw new Error(`Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`);
    }
    const conn = res.data?.metaobjects;
    if (!conn) break;
    for (const n of conn.nodes) {
      const texto: string = n.fields.find((f: { key: string; value: string }) => f.key === "texto")?.value ?? "";
      badges.push({ id: n.id, texto, handle: n.handle });
    }
    hasNextPage = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
  }
  return badges;
}

function toProductGid(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Product/${trimmed}`;
  return trimmed;
}

export async function assignProductBadgesHandler(
  args: {
    productIds: string[];
    badgeNames: string[];
    confirm?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (args.productIds.length === 0) {
    return { content: [{ type: "text", text: "Provide at least one productId." }], isError: true };
  }
  if (args.badgeNames.length === 0) {
    return { content: [{ type: "text", text: "Provide at least one badgeName." }], isError: true };
  }

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const library = await loadBadgeLibrary(client);
  const byName = new Map(library.map((b) => [b.texto.trim().toLowerCase(), b]));
  const byHandle = new Map(library.map((b) => [b.handle, b]));

  const resolved: Badge[] = [];
  const unknown: string[] = [];
  for (const name of args.badgeNames) {
    const badge = byName.get(name.trim().toLowerCase()) ?? byHandle.get(name.trim());
    if (badge) resolved.push(badge);
    else unknown.push(name);
  }
  if (unknown.length > 0) {
    return {
      content: [
        {
          type: "text",
          text: [
            `Unknown badge(s): ${unknown.join(", ")}.`,
            `This tool only assigns badges that already exist as "etiqueta" metaobjects — it doesn't create new claim badges (those need design/copy sign-off).`,
            `Existing badges (${library.length}): ${library.map((b) => b.texto).join(", ") || "(none)"}`,
          ].join("\n"),
        },
      ],
      isError: true,
    };
  }

  const normalizedIds = args.productIds.map(toProductGid);
  const productsRes = await client.request<ProductsResponse>(PRODUCTS_WITH_BADGES_QUERY, {
    variables: { ids: normalizedIds },
  });
  if (productsRes.errors) {
    throw new Error(`Shopify GraphQL error: ${productsRes.errors.message ?? "unknown error"}`);
  }
  const products = (productsRes.data?.nodes ?? []).filter(
    (n): n is Extract<ProductsResponse["nodes"][number], { __typename: "Product" }> =>
      n !== null && n.__typename === "Product",
  );
  if (products.length === 0) {
    return {
      content: [{ type: "text", text: `None of the provided IDs resolved to a Product: ${normalizedIds.join(", ")}` }],
      isError: true,
    };
  }

  const plan = products.map((p) => {
    const current = p.etiquetas?.references.nodes ?? [];
    const currentIds = new Set(current.map((n) => n.id));
    const toAdd = resolved.filter((b) => !currentIds.has(b.id));
    const alreadyPresent = resolved.filter((b) => currentIds.has(b.id));
    const newIds = [...current.map((n) => n.id), ...toAdd.map((b) => b.id)];
    return { product: p, toAdd, alreadyPresent, newIds };
  });

  const previewLines = plan.map((row) => {
    const addPart = row.toAdd.length > 0 ? `+ ${row.toAdd.map((b) => b.texto).join(", ")}` : "(no change)";
    const skipPart = row.alreadyPresent.length > 0 ? ` — already has: ${row.alreadyPresent.map((b) => b.texto).join(", ")}` : "";
    return `  • ${row.product.title} (${row.product.id}): ${addPart}${skipPart}`;
  });

  if (args.confirm !== true) {
    return confirmationPreview({
      summary: [`Badges: ${resolved.map((b) => b.texto).join(", ")}`, ``, ...previewLines].join("\n"),
      actionLabel: `assign badge(s) "${resolved.map((b) => b.texto).join(", ")}"`,
    });
  }

  const needsWrite = plan.filter((row) => row.toAdd.length > 0);
  if (needsWrite.length === 0) {
    return {
      content: [{ type: "text", text: `No-op: every product already has the requested badge(s).` }],
    };
  }

  const setRes = await client.request<MetafieldsSetResponse>(METAFIELDS_SET_MUTATION, {
    variables: {
      metafields: needsWrite.map((row) => ({
        ownerId: row.product.id,
        namespace: "custom",
        key: "etiquetas",
        type: "list.metaobject_reference",
        value: JSON.stringify(row.newIds),
      })),
    },
  });
  if (setRes.errors) {
    throw new Error(`Shopify GraphQL error: ${setRes.errors.message ?? "unknown error"}`);
  }
  const userErrors = setRes.data?.metafieldsSet.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      content: [{ type: "text", text: `Failed: ${userErrors.map((e) => e.message).join("; ")}` }],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Assigned badge(s) to ${needsWrite.length}/${plan.length} product(s).\n\n${previewLines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_assign_product_badges",
  description:
    "Bulk-assign existing product badges (custom.etiquetas metaobject references, e.g. vegano/cruelty-free) to one or more products. Only assigns badges that already exist in the badge library — never creates a new claim badge (that needs design/copy sign-off; use gebeauty/scripts/apply_off_badges.py for auto-computed discount badges). Two-step: first call (no confirm) returns a preview; call again with confirm: true to apply.",
  inputSchema: {
    productIds: z
      .array(z.string().min(1))
      .min(1)
      .describe("Shopify product IDs. Accepts full GIDs or numeric IDs."),
    badgeNames: z
      .array(z.string().min(1))
      .min(1)
      .describe('Badge names to assign, matched against the existing "etiqueta" metaobject library by texto field or handle (case-insensitive).'),
    confirm: z
      .boolean()
      .optional()
      .describe("Set to true on the second call to execute the change."),
  },
  handler: assignProductBadgesHandler,
});
