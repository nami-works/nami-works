import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query WebhookSubscriptions($cursor: String) {
    webhookSubscriptions(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          topic
          format
          createdAt
          updatedAt
          endpoint {
            __typename
            ... on WebhookHttpEndpoint { callbackUrl }
            ... on WebhookEventBridgeEndpoint { arn }
            ... on WebhookPubSubEndpoint { pubSubProject pubSubTopic }
          }
        }
      }
    }
  }
`;

type Node = {
  id: string;
  topic: string;
  format: string;
  createdAt: string;
  updatedAt: string;
  endpoint:
    | { __typename: "WebhookHttpEndpoint"; callbackUrl: string }
    | { __typename: "WebhookEventBridgeEndpoint"; arn: string }
    | { __typename: "WebhookPubSubEndpoint"; pubSubProject: string; pubSubTopic: string }
    | { __typename: string };
};
type Resp = {
  webhookSubscriptions: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Node }>;
  };
};

export async function listWebhooksHandler(
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
    for (const e of res.data?.webhookSubscriptions.edges ?? []) all.push(e.node);
    if (!res.data?.webhookSubscriptions.pageInfo.hasNextPage) break;
    cursor = res.data.webhookSubscriptions.pageInfo.endCursor;
    if (!cursor) break;
  }
  if (all.length === 0) {
    return {
      content: [{ type: "text", text: "Nenhum webhook registrado." }],
    };
  }
  all.sort((a, b) => a.topic.localeCompare(b.topic));
  const lines = all.map((w) => {
    let dest = "(?)";
    if (w.endpoint.__typename === "WebhookHttpEndpoint")
      dest = (w.endpoint as { callbackUrl: string }).callbackUrl;
    else if (w.endpoint.__typename === "WebhookEventBridgeEndpoint")
      dest = `EventBridge ${(w.endpoint as { arn: string }).arn}`;
    else if (w.endpoint.__typename === "WebhookPubSubEndpoint") {
      const ep = w.endpoint as { pubSubProject: string; pubSubTopic: string };
      dest = `PubSub ${ep.pubSubProject}/${ep.pubSubTopic}`;
    }
    return `  ${w.topic} · ${w.format} · ${dest}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Webhooks registrados (${all.length}):\n\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_webhooks",
  description:
    "Lista todas as webhook subscriptions da loja com tópico, formato e endpoint (HTTP URL, EventBridge ARN ou Pub/Sub).",
  inputSchema: {},
  handler: listWebhooksHandler,
});
