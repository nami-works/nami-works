import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query UpcomingDiscounts($cursor: String) {
    codeDiscountNodes(first: 100, after: $cursor, sortKey: STARTS_AT, reverse: false) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          codeDiscount {
            __typename
            ... on DiscountCodeBasic {
              title
              status
              startsAt
              endsAt
              codes(first: 3) { edges { node { code } } }
            }
          }
        }
      }
    }
  }
`;

type Basic = {
  __typename: "DiscountCodeBasic";
  title: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  codes: { edges: Array<{ node: { code: string } }> };
};
type Resp = {
  codeDiscountNodes: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: { id: string; codeDiscount: Basic | { __typename: string } } }>;
  };
};

export async function upcomingDiscountsHandler(
  args: { horizonDays?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  const horizonDays = args.horizonDays ?? 30;
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });
  const now = Date.now();
  const horizonMs = horizonDays * 24 * 60 * 60 * 1000;

  type Row = {
    code: string;
    status: string;
    kind: "starting-soon" | "ending-soon" | "active-no-end";
    when: string;
  };
  const rows: Row[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.codeDiscountNodes.edges ?? []) {
      const d = e.node.codeDiscount;
      if (d.__typename !== "DiscountCodeBasic") continue;
      const b = d as Basic;
      const code = b.codes.edges[0]?.node.code ?? b.title;
      const startsAtMs = new Date(b.startsAt).getTime();
      const endsAtMs = b.endsAt ? new Date(b.endsAt).getTime() : null;

      if (
        b.status === "SCHEDULED" &&
        startsAtMs > now &&
        startsAtMs - now <= horizonMs
      ) {
        rows.push({
          code,
          status: b.status,
          kind: "starting-soon",
          when: `começa ${b.startsAt.slice(0, 10)}`,
        });
      } else if (
        b.status === "ACTIVE" &&
        endsAtMs !== null &&
        endsAtMs > now &&
        endsAtMs - now <= horizonMs
      ) {
        rows.push({
          code,
          status: b.status,
          kind: "ending-soon",
          when: `termina ${b.endsAt!.slice(0, 10)}`,
        });
      }
    }
    if (!res.data?.codeDiscountNodes.pageInfo.hasNextPage) break;
    cursor = res.data.codeDiscountNodes.pageInfo.endCursor;
    if (!cursor) break;
  }

  if (rows.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: `Nenhuma campanha começando ou terminando nos próximos ${horizonDays} dias.`,
        },
      ],
    };
  }

  const starting = rows.filter((r) => r.kind === "starting-soon");
  const ending = rows.filter((r) => r.kind === "ending-soon");
  starting.sort((a, b) => a.when.localeCompare(b.when));
  ending.sort((a, b) => a.when.localeCompare(b.when));

  const body = [
    `Campanhas nos próximos ${horizonDays} dias:`,
    ``,
    ...(starting.length > 0
      ? ["📅 Começando em breve:", ...starting.map((r) => `  ${r.code} · ${r.when}`), ""]
      : []),
    ...(ending.length > 0
      ? ["⏰ Terminando em breve:", ...ending.map((r) => `  ${r.code} · ${r.when}`)]
      : []),
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_upcoming_discounts",
  description:
    "Lista códigos que começam OU terminam nos próximos N dias (default 30). Scheduled vs Active. Útil pra planejamento de campanha.",
  inputSchema: {
    horizonDays: z.number().int().min(1).max(365).optional(),
  },
  handler: upcomingDiscountsHandler,
});
