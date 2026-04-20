import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";

const QUERY = /* GraphQL */ `
  query FindCustomer($query: String!) {
    customers(first: 5, query: $query) {
      edges {
        node {
          id
          firstName
          lastName
          email
          phone
          createdAt
          numberOfOrders
          amountSpent { amount currencyCode }
          defaultAddress {
            city
            provinceCode
            countryCodeV2
          }
        }
      }
    }
  }
`;

type CustomerNode = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  numberOfOrders: string | number;
  amountSpent: { amount: string; currencyCode: string };
  defaultAddress: {
    city: string | null;
    provinceCode: string | null;
    countryCodeV2: string | null;
  } | null;
};

type FindCustomerResponse = {
  customers: { edges: Array<{ node: CustomerNode }> };
};

function escapeQueryValue(v: string): string {
  // Shopify search syntax: wrap values containing spaces or symbols in quotes
  // and escape embedded quotes.
  if (/[\s"']/.test(v)) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return v;
}

registerToolDefinition({
  name: "shopify_find_customer",
  description:
    "Look up Shopify customers by email or phone (at least one required). Returns up to 5 matches with summary fields.",
  inputSchema: {
    email: z.string().email().optional().describe("Customer email."),
    phone: z
      .string()
      .optional()
      .describe("Customer phone, any format Shopify accepts."),
  },
  handler: async ({ email, phone }, ctx) => {
    if (!email && !phone) {
      return {
        content: [
          {
            type: "text",
            text: "Provide at least one of: email, phone.",
          },
        ],
        isError: true,
      };
    }

    const client = await getShopifyClient({
      ssmPrefix: ctx.tenant.ssmPrefix,
      shopifyShop: ctx.tenant.shopifyShop ?? "",
    });

    const parts: string[] = [];
    if (typeof email === "string") parts.push(`email:${escapeQueryValue(email)}`);
    if (typeof phone === "string") parts.push(`phone:${escapeQueryValue(phone)}`);
    const query = parts.join(" OR ");

    const res = await client.request<FindCustomerResponse>(QUERY, {
      variables: { query },
    });
    if (res.errors) {
      throw new Error(
        `Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`,
      );
    }

    const customers = res.data?.customers.edges.map((e) => e.node) ?? [];
    if (customers.length === 0) {
      return {
        content: [
          { type: "text", text: `No customers found matching: ${query}` },
        ],
      };
    }

    const lines = customers.map((c) => {
      const name =
        [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
        c.email ||
        c.phone ||
        "(unnamed)";
      const contact = [c.email, c.phone].filter(Boolean).join(" / ");
      const location = [
        c.defaultAddress?.city,
        c.defaultAddress?.provinceCode,
        c.defaultAddress?.countryCodeV2,
      ]
        .filter(Boolean)
        .join(", ");
      const spent = `${c.amountSpent.amount} ${c.amountSpent.currencyCode}`;
      return [
        `  • ${name}`,
        `    ${contact || "(no contact on file)"}`,
        location ? `    ${location}` : null,
        `    Orders: ${c.numberOfOrders} · Lifetime spend: ${spent}`,
        `    ID: ${c.id}`,
      ]
        .filter((s): s is string => s !== null)
        .join("\n");
    });

    const body = [
      `Customers matching query "${query}" (${customers.length}):`,
      ``,
      ...lines,
    ].join("\n");

    return { content: [{ type: "text", text: body }] };
  },
});
