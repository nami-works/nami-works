import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const LOOKUP = /* GraphQL */ `
  query OrderNote($id: ID!) { order(id: $id) { id name note } }
`;

const UPDATE = /* GraphQL */ `
  mutation OrderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id note }
      userErrors { field message }
    }
  }
`;

type LookupResp = { order: { id: string; name: string; note: string | null } | null };
type UpdResp = {
  orderUpdate: {
    order: { id: string; note: string | null } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
};

function toOrderGid(input: string): string {
  const t = input.trim();
  if (t.startsWith("gid://")) return t;
  if (/^\d+$/.test(t)) return `gid://shopify/Order/${t}`;
  return t;
}

export async function addNoteToOrderHandler(
  args: {
    orderId: string;
    note: string;
    mode?: "append" | "replace" | undefined;
    confirm?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const mode = args.mode ?? "append";
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
  const existing = o.note ?? "";
  const finalNote =
    mode === "replace"
      ? args.note
      : existing
        ? `${existing}\n${args.note}`
        : args.note;

  const summary = [
    `Pedido: ${o.name}`,
    `Nota atual: ${existing || "(nenhuma)"}`,
    `Modo: ${mode}`,
    `Nota final:`,
    finalNote,
  ].join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({ summary, actionLabel: "atualizar nota do pedido" });
  }
  const res = await client.request<UpdResp>(UPDATE, {
    variables: { input: { id, note: finalNote } },
  });
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
  const errs = res.data?.orderUpdate.userErrors ?? [];
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
      { type: "text", text: `Nota atualizada no pedido ${o.name}.` },
    ],
  };
}

registerToolDefinition({
  name: "shopify_add_note_to_order",
  description:
    "Atualiza a nota de um pedido. mode 'append' (default) concatena; 'replace' sobrescreve. Two-step com confirm:true.",
  inputSchema: {
    orderId: z.string().min(1),
    note: z.string().min(1),
    mode: z.enum(["append", "replace"]).optional(),
    confirm: z.boolean().optional(),
  },
  handler: addNoteToOrderHandler,
});
