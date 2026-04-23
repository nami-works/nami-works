import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query CarrierServices {
    carrierServices(first: 50) {
      edges {
        node {
          id
          name
          callbackUrl
          active
          supportsServiceDiscovery
        }
      }
    }
  }
`;

type Node = {
  id: string;
  name: string;
  callbackUrl: string | null;
  active: boolean;
  supportsServiceDiscovery: boolean;
};
type Resp = { carrierServices: { edges: Array<{ node: Node }> } };

export async function listCarrierServicesHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const res = await client.request<Resp>(QUERY);
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);

  const nodes = res.data?.carrierServices.edges.map((e) => e.node) ?? [];
  if (nodes.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: "Nenhuma carrier service registrada. (A loja usa tarifas manuais ou apps de envio que não criam CarrierService.)",
        },
      ],
    };
  }

  const active = nodes.filter((n) => n.active);
  const inactive = nodes.filter((n) => !n.active);
  const lines = [...active, ...inactive].map(
    (n) =>
      `  ${n.active ? "✓" : "✗"} ${n.name} · ${n.callbackUrl ?? "(sem callback)"}`,
  );
  const body = [
    `Carrier services registradas: ${nodes.length} (${active.length} ativas, ${inactive.length} inativas)`,
    ``,
    ...lines,
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_list_carrier_services",
  description:
    "Lista os CarrierService registrados na loja (integrações de tarifa externa como Correios API, Frenet, app de frete). Mostra status ativo/inativo e URL de callback.",
  inputSchema: {},
  handler: listCarrierServicesHandler,
});
