import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query ShopInfo {
    shop {
      id
      name
      url
      myshopifyDomain
      contactEmail
      ianaTimezone
      currencyCode
      weightUnit
      plan {
        displayName
        partnerDevelopment
        shopifyPlus
      }
      billingAddress { city provinceCode countryCodeV2 }
      email
    }
  }
`;

type Resp = {
  shop: {
    id: string;
    name: string;
    url: string;
    myshopifyDomain: string;
    contactEmail: string;
    ianaTimezone: string;
    currencyCode: string;
    weightUnit: string;
    plan: {
      displayName: string;
      partnerDevelopment: boolean;
      shopifyPlus: boolean;
    };
    billingAddress: {
      city: string | null;
      provinceCode: string | null;
      countryCodeV2: string | null;
    } | null;
    email: string;
  };
};

export async function shopInfoHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const res = await client.request<Resp>(QUERY);
  if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
  const s = res.data?.shop;
  if (!s) {
    return { content: [{ type: "text", text: "Falha ao buscar shop info." }] };
  }
  const addr = s.billingAddress
    ? [s.billingAddress.city, s.billingAddress.provinceCode, s.billingAddress.countryCodeV2]
        .filter(Boolean)
        .join(", ")
    : "(sem billing address)";
  const plan = [
    s.plan.displayName,
    s.plan.shopifyPlus ? "Shopify Plus" : null,
    s.plan.partnerDevelopment ? "Partner Dev" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const body = [
    `Loja: ${s.name} · ${s.myshopifyDomain}`,
    `URL:  ${s.url}`,
    `Plano: ${plan}`,
    `Timezone: ${s.ianaTimezone}`,
    `Moeda: ${s.currencyCode} · Peso: ${s.weightUnit}`,
    `Billing address: ${addr}`,
    `Contato: ${s.contactEmail} · Email administrador: ${s.email}`,
    `Shopify ID: ${s.id}`,
  ].join("\n");
  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_shop_info",
  description:
    "Metadados da loja: nome, URL, plano (com flag Shopify Plus), timezone, moeda, unidade de peso, endereço de billing, contato.",
  inputSchema: {},
  handler: shopInfoHandler,
});
