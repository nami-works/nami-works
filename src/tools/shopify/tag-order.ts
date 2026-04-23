import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const LOOKUP = /* GraphQL */ `
  query OrderTags($id: ID!) {
    order(id: $id) { id name tags }
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

type LookupResp = { order: { id: string; name: string; tags: string[] } | null };
type AddResp = {
  tagsAdd: {
    node: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

function toOrderGid(input: string): string {
  const t = input.trim();
  if (t.startsWith("gid://")) return t;
  if (/^\d+$/.test(t)) return `gid://shopify/Order/${t}`;
  return t;
}

export async function tagOrderHandler(
  args: { orderId: string; tags: string[]; confirm?: boolean | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (args.tags.length === 0) {
    return {
      content: [{ type: "text", text: "Nenhuma tag passada." }],
      isError: true,
    };
  }
  const id = toOrderGid(args.orderId);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const lookup = await client.request<LookupResp>(LOOKUP, { variables: { id } });
  if (lookup.errors) throw new Error(`Shopify: ${lookup.errors.message ?? ""}`);
  const o = lookup.data?.order;
  if (!o) {
    return {
      content: [{ type: "text", text: `Pedido ${args.orderId} não encontrado.` }],
      isError: true,
    };
  }
  const newTags = args.tags.filter((t) => !o.tags.includes(t));
  const already = args.tags.filter((t) => o.tags.includes(t));

  const summary = [
    `Pedido: ${o.name}`,
    `Tags atuais: ${o.tags.join(", ") || "(nenhuma)"}`,
    `A adicionar: ${newTags.join(", ") || "(nenhuma — todas já presentes)"}`,
    already.length > 0 ? `Já presentes: ${already.join(", ")}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({ summary, actionLabel: "adicionar tags ao pedido" });
  }
  if (newTags.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No-op: todas as tags já estavam no pedido ${o.name}.`,
        },
      ],
    };
  }
  const add = await client.request<AddResp>(TAGS_ADD, {
    variables: { id, tags: newTags },
  });
  if (add.errors) throw new Error(`Shopify: ${add.errors.message ?? ""}`);
  const errs = add.data?.tagsAdd.userErrors ?? [];
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
        text: `Adicionadas ${newTags.length} tag(s) ao pedido ${o.name}: ${newTags.join(", ")}.`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_tag_order",
  description:
    "Adiciona tag(s) a um pedido. Two-step: primeira chamada retorna preview; segunda com confirm:true executa.",
  inputSchema: {
    orderId: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1),
    confirm: z.boolean().optional(),
  },
  handler: tagOrderHandler,
});
