import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query MetaobjectDefinitions($cursor: String) {
    metaobjectDefinitions(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          type
          name
          description
          metaobjectsCount
          fieldDefinitions {
            key
            name
            required
            type { name }
          }
        }
      }
    }
  }
`;

type Node = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  metaobjectsCount: number;
  fieldDefinitions: Array<{
    key: string;
    name: string;
    required: boolean;
    type: { name: string };
  }>;
};
type Resp = {
  metaobjectDefinitions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listMetaobjectDefinitionsHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const all: Node[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 3; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.metaobjectDefinitions.edges ?? []) all.push(e.node);
    if (!res.data?.metaobjectDefinitions.pageInfo.hasNextPage) break;
    cursor = res.data.metaobjectDefinitions.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (all.length === 0) {
    return {
      content: [
        { type: "text", text: "Nenhuma definição de metaobject configurada." },
      ],
    };
  }
  const blocks = all.map((m) => {
    const fields = m.fieldDefinitions
      .map(
        (f) =>
          `    · ${f.key} (${f.name}) · ${f.type.name}${f.required ? " · obrigatório" : ""}`,
      )
      .join("\n");
    return `${m.name} (${m.type}) · ${m.metaobjectsCount} entries\n  ${m.description ?? "(sem descrição)"}\n  Campos:\n${fields || "    (nenhum)"}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Metaobject definitions (${all.length}):\n\n${blocks.join("\n\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_metaobject_definitions",
  description:
    "Lista definições de metaobjects (modelos de dados customizados da loja) com seus campos. Útil pra auditar estrutura de conteúdo custom.",
  inputSchema: {},
  handler: listMetaobjectDefinitionsHandler,
});
