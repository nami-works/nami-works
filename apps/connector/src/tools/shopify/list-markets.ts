import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ShopMarkets {
    markets(first: 50) {
      edges {
        node {
          id
          name
          handle
          enabled
          primary
          regions(first: 10) {
            edges { node { ... on MarketRegionCountry { code name } } }
          }
          currencySettings {
            baseCurrency { currencyCode }
          }
        }
      }
    }
  }
`;

type Region = { code: string; name: string };
type Node = {
  id: string;
  name: string;
  handle: string;
  enabled: boolean;
  primary: boolean;
  regions: { edges: Array<{ node: Region | Record<string, unknown> }> };
  currencySettings: { baseCurrency: { currencyCode: string } };
};
type Resp = { markets: { edges: Array<{ node: Node }> } };

export async function listMarketsHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const res = await client.request<Resp>(QUERY);
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
  const markets = res.data?.markets.edges.map((e) => e.node) ?? [];
  if (markets.length === 0) {
    return { content: [{ type: "text", text: "Nenhum mercado configurado." }] };
  }
  const lines = markets.map((m) => {
    const regions = m.regions.edges
      .map((e) => (e.node as Region).code)
      .filter(Boolean)
      .join(", ") || "(nenhum)";
    return `  ${m.primary ? "★" : "•"} ${m.name} (${m.handle}) · ${m.enabled ? "ativo" : "INATIVO"} · ${m.currencySettings.baseCurrency.currencyCode} · regiões: ${regions}`;
  });
  return {
    content: [
      {
        type: "text",
        text: `Shopify Markets (${markets.length}):\n${lines.join("\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_markets",
  description:
    "Lista Shopify Markets (mercados multi-região) com moeda base, regiões atendidas e flag primary.",
  inputSchema: {},
  handler: listMarketsHandler,
});
