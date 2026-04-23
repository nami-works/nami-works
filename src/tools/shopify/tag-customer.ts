import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const LOOKUP = /* GraphQL */ `
  query CustomerTags($id: ID!) { customer(id: $id) { id firstName lastName email tags } }
`;

const TAGS_ADD = /* GraphQL */ `
  mutation TagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
  }
`;

type LookupResp = {
  customer: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    tags: string[];
  } | null;
};
type AddResp = {
  tagsAdd: {
    node: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

function toGid(input: string): string {
  const t = input.trim();
  if (t.startsWith("gid://")) return t;
  if (/^\d+$/.test(t)) return `gid://shopify/Customer/${t}`;
  return t;
}

export async function tagCustomerHandler(
  args: { customerId: string; tags: string[]; confirm?: boolean | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (args.tags.length === 0) {
    return {
      content: [{ type: "text", text: "Nenhuma tag passada." }],
      isError: true,
    };
  }
  const id = toGid(args.customerId);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const lookup = await client.request<LookupResp>(LOOKUP, { variables: { id } });
  if (lookup.errors) throw new Error(`Shopify: ${lookup.errors.message ?? ""}`);
  const c = lookup.data?.customer;
  if (!c) {
    return {
      content: [
        { type: "text", text: `Cliente ${args.customerId} não encontrado.` },
      ],
      isError: true,
    };
  }
  const name =
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    c.email ||
    "(sem nome)";
  const newTags = args.tags.filter((t) => !c.tags.includes(t));

  const summary = [
    `Cliente: ${name} · ${c.email ?? "(sem email)"}`,
    `Tags atuais: ${c.tags.join(", ") || "(nenhuma)"}`,
    `A adicionar: ${newTags.join(", ") || "(nenhuma — todas já presentes)"}`,
  ].join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({ summary, actionLabel: "adicionar tags ao cliente" });
  }
  if (newTags.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `No-op: todas as tags já estavam em ${name}.`,
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
        text: `Adicionadas ${newTags.length} tag(s) em ${name}: ${newTags.join(", ")}.`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_tag_customer",
  description: "Adiciona tags a um cliente. Two-step com confirm:true.",
  inputSchema: {
    customerId: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1),
    confirm: z.boolean().optional(),
  },
  handler: tagCustomerHandler,
});
