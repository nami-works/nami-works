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

const TAGS_REMOVE = /* GraphQL */ `
  mutation TagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

type LookupResp = { order: { id: string; name: string; tags: string[] } | null };
type RemoveResp = {
  tagsRemove: {
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

export async function untagOrderHandler(
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
  const toRemove = args.tags.filter((t) => o.tags.includes(t));
  const notPresent = args.tags.filter((t) => !o.tags.includes(t));

  const summary = [
    `Pedido: ${o.name}`,
    `Tags atuais: ${o.tags.join(", ") || "(nenhuma)"}`,
    `A remover: ${toRemove.join(", ") || "(nenhuma — nenhuma das tags está presente)"}`,
    notPresent.length > 0 ? `Não presentes: ${notPresent.join(", ")}` : null,
  ]
    .filter((s): s is string => s !== null)
    .join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({ summary, actionLabel: "remover tags do pedido" });
  }
  if (toRemove.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No-op: nenhuma das tags estava presente em ${o.name}.`,
        },
      ],
    };
  }
  const rem = await client.request<RemoveResp>(TAGS_REMOVE, {
    variables: { id, tags: toRemove },
  });
  if (rem.errors) throw new Error(`Shopify: ${rem.errors.message ?? ""}`);
  const errs = rem.data?.tagsRemove.userErrors ?? [];
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
        text: `Removidas ${toRemove.length} tag(s) de ${o.name}: ${toRemove.join(", ")}.`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_untag_order",
  description: "Remove tag(s) de um pedido. Two-step com confirm:true.",
  inputSchema: {
    orderId: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1),
    confirm: z.boolean().optional(),
  },
  handler: untagOrderHandler,
});
