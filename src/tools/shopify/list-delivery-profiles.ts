import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query DeliveryProfiles {
    deliveryProfiles(first: 10) {
      edges {
        node {
          id
          name
          default
          activeMethodDefinitionsCount
          profileLocationGroups {
            locationGroup {
              locations(first: 20) { edges { node { name id } } }
            }
            locationGroupZones(first: 30) {
              edges {
                node {
                  zone { name countries { code { countryCode } } }
                  methodDefinitionCounts {
                    participantDefinitionsCount
                    rateDefinitionsCount
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type DeliveryProfile = {
  id: string;
  name: string;
  default: boolean;
  activeMethodDefinitionsCount: number;
  profileLocationGroups: Array<{
    locationGroup: {
      locations: { edges: Array<{ node: { name: string; id: string } }> };
    };
    locationGroupZones: {
      edges: Array<{
        node: {
          zone: {
            name: string;
            countries: Array<{ code: { countryCode: string } }>;
          };
          methodDefinitionCounts: {
            participantDefinitionsCount: number;
            rateDefinitionsCount: number;
          };
        };
      }>;
    };
  }>;
};
type Resp = { deliveryProfiles: { edges: Array<{ node: DeliveryProfile }> } };

export async function listDeliveryProfilesHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const res = await client.request<Resp>(QUERY);
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);

  const profiles = res.data?.deliveryProfiles.edges.map((e) => e.node) ?? [];
  if (profiles.length === 0) {
    return {
      content: [
        { type: "text", text: "Nenhum delivery profile configurado." },
      ],
    };
  }

  const blocks = profiles.map((p) => {
    const locs = p.profileLocationGroups.flatMap((g) =>
      g.locationGroup.locations.edges.map((le) => le.node.name),
    );
    const zones = p.profileLocationGroups.flatMap((g) =>
      g.locationGroupZones.edges.map((ze) => {
        const countries = ze.node.zone.countries
          .map((c) => c.code.countryCode)
          .join(", ");
        const rates =
          ze.node.methodDefinitionCounts.rateDefinitionsCount +
          ze.node.methodDefinitionCounts.participantDefinitionsCount;
        return `    · ${ze.node.zone.name}${countries ? ` [${countries}]` : ""} · ${rates} tarifa(s)`;
      }),
    );
    return [
      `${p.default ? "★" : "•"} ${p.name} · ${p.activeMethodDefinitionsCount} método(s) ativo(s)`,
      `  Locations: ${locs.join(", ") || "(nenhuma)"}`,
      `  Zonas:`,
      ...zones,
    ].join("\n");
  });

  return {
    content: [
      {
        type: "text",
        text: `Delivery profiles (${profiles.length}):\n\n${blocks.join("\n\n")}`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_list_delivery_profiles",
  description:
    "Lista delivery profiles da loja com locations, zonas (países) e contagem de tarifas por zona. Útil pra auditar configuração de frete antes de lançar campanha.",
  inputSchema: {},
  handler: listDeliveryProfilesHandler,
});
