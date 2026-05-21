import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ListLocations {
    locations(first: 50, includeInactive: true) {
      edges {
        node {
          id
          name
          isActive
          fulfillsOnlineOrders
          shipsInventory
          address {
            city
            provinceCode
            countryCode
            zip
          }
        }
      }
    }
  }
`;

type LocationNode = {
  id: string;
  name: string;
  isActive: boolean;
  fulfillsOnlineOrders: boolean;
  shipsInventory: boolean;
  address: {
    city: string | null;
    provinceCode: string | null;
    countryCode: string | null;
    zip: string | null;
  } | null;
};

type Response = {
  locations: { edges: Array<{ node: LocationNode }> };
};

export async function listLocationsHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const res = await client.request<Response>(QUERY);
  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown"}`,
    );
  }

  const locs = res.data?.locations.edges.map((e) => e.node) ?? [];
  if (locs.length === 0) {
    return {
      content: [{ type: "text", text: "Nenhuma location configurada." }],
    };
  }

  const lines = locs.map((loc) => {
    const addr = loc.address
      ? [loc.address.city, loc.address.provinceCode, loc.address.zip]
          .filter(Boolean)
          .join(", ")
      : "(sem endereço)";
    const capacities = [
      loc.fulfillsOnlineOrders ? "online" : null,
      loc.shipsInventory ? "envia-estoque" : null,
    ]
      .filter(Boolean)
      .join(", ") || "sem capacidades";
    const active = loc.isActive ? "ativa" : "INATIVA";
    return `  ${loc.name} · ${active} · ${addr} · ${capacities}\n    ${loc.id}`;
  });

  const header = `Locations Shopify (${locs.length}):\n`;
  return { content: [{ type: "text", text: header + lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_list_locations",
  description:
    "Lista todas as locations do Shopify (lojas físicas + depósitos + warehouses virtuais), incluindo inativas. Mostra endereço resumido e capacidades (fulfill online / envia estoque).",
  inputSchema: {},
  handler: listLocationsHandler,
});
