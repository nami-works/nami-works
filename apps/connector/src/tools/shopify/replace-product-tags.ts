import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const LOOKUP = /* GraphQL */ `
  query ProductTags($id: ID!) { product(id: $id) { id title tags } }
`;

const UPDATE = /* GraphQL */ `
  mutation ProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id tags }
      userErrors { field message }
    }
  }
`;

type LookupResp = {
  product: { id: string; title: string; tags: string[] } | null;
};
type UpdResp = {
  productUpdate: {
    product: { id: string; tags: string[] } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

function toProductGid(input: string): string {
  const t = input.trim();
  if (t.startsWith("gid://")) return t;
  if (/^\d+$/.test(t)) return `gid://shopify/Product/${t}`;
  return t;
}

export async function replaceProductTagsHandler(
  args: { productId: string; tags: string[]; confirm?: boolean | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const id = toProductGid(args.productId);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const lookup = await client.request<LookupResp>(LOOKUP, { variables: { id } });
  if (lookup.errors) throw new Error(`Shopify: ${lookup.errors.message ?? ""}`);
  const p = lookup.data?.product;
  if (!p) {
    return {
      content: [
        { type: "text", text: `Produto ${args.productId} não encontrado.` },
      ],
      isError: true,
    };
  }

  const removed = p.tags.filter((t) => !args.tags.includes(t));
  const added = args.tags.filter((t) => !p.tags.includes(t));

  const summary = [
    `Produto: ${p.title}`,
    `Tags atuais: ${p.tags.join(", ") || "(nenhuma)"}`,
    `Tags finais: ${args.tags.join(", ") || "(nenhuma)"}`,
    added.length > 0 ? `Adicionar: ${added.join(", ")}` : "",
    removed.length > 0 ? `Remover:    ${removed.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({ summary, actionLabel: "substituir tags do produto" });
  }
  if (added.length === 0 && removed.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No-op: tags atuais já correspondem à lista desejada em ${p.title}.`,
        },
      ],
    };
  }
  const res = await client.request<UpdResp>(UPDATE, {
    variables: { input: { id, tags: args.tags } },
  });
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
  const errs = res.data?.productUpdate.userErrors ?? [];
  if (errs.length > 0) {
    return {
      content: [
        {
          type: "text",
          text: `Shopify rejeitou: ${errs.map((e) => e.message).join("; ")}`,
        },
      ],
      isError: true,
    };
  }
  return {
    content: [
      {
        type: "text",
        text: `Tags substituídas em "${p.title}". +${added.length} · -${removed.length}.`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_replace_product_tags",
  description:
    "Substitui TODAS as tags de um produto pela lista fornecida (não adiciona — sobrescreve). Two-step com confirm:true.",
  inputSchema: {
    productId: z.string().min(1),
    tags: z.array(z.string()).describe("Lista final de tags (vazio = remove todas)."),
    confirm: z.boolean().optional(),
  },
  handler: replaceProductTagsHandler,
});
