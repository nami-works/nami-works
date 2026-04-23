import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const QUERY = /* GraphQL */ `
  query RetailTotalsAudit($query: String!, $cursor: String) {
    orders(first: 250, query: $query, after: $cursor, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          sourceName
          retailLocation { id name }
          displayFinancialStatus
          currentTotalPriceSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount } }
          cancelledAt
        }
      }
    }
  }
`;

type Order = {
  id: string;
  sourceName: string | null;
  retailLocation: { id: string; name: string } | null;
  displayFinancialStatus: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string } };
  cancelledAt: string | null;
};
type Resp = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    edges: Array<{ node: Order }>;
  };
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function auditRetailTotalsHandler(
  args: { desde: string; ate: string; maxPages?: number | undefined },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!ISO.test(args.desde) || !ISO.test(args.ate)) {
    return {
      content: [{ type: "text", text: "desde/ate em ISO YYYY-MM-DD." }],
      isError: true,
    };
  }
  const maxPages = Math.min(args.maxPages ?? 8, 20);
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  let total = 0;
  let retailTotal = 0;
  let onlineTotal = 0;
  let cancelledCount = 0;
  let retailOrders = 0;
  let onlineOrders = 0;
  let paidCount = 0;
  let pendingCount = 0;
  let refundedSum = 0;
  let cur = "BRL";

  let cursor: string | null = null;
  const query = `created_at:>=${args.desde} AND created_at:<=${args.ate}`;
  for (let i = 0; i < maxPages; i++) {
    const res: { data?: Resp; errors?: { message?: string } } =
      await client.request<Resp>(QUERY, { variables: { query, cursor } });
    if (res.errors) throw new Error(`Shopify: ${res.errors.message ?? ""}`);
    for (const e of res.data?.orders.edges ?? []) {
      const o = e.node;
      const gross = Number(o.currentTotalPriceSet.shopMoney.amount);
      const refund = Number(o.totalRefundedSet.shopMoney.amount);
      const net = Math.max(0, gross - refund);
      cur = o.currentTotalPriceSet.shopMoney.currencyCode;
      if (o.cancelledAt) {
        cancelledCount += 1;
        continue;
      }
      total += net;
      refundedSum += refund;
      if (o.displayFinancialStatus === "PAID") paidCount += 1;
      else pendingCount += 1;
      const isRetail = o.sourceName === "pos" || o.retailLocation !== null;
      if (isRetail) {
        retailTotal += net;
        retailOrders += 1;
      } else {
        onlineTotal += net;
        onlineOrders += 1;
      }
    }
    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
    if (!cursor) break;
  }

  const ordersTotal = retailOrders + onlineOrders;
  const body = [
    `Auditoria totais · ${args.desde} a ${args.ate}`,
    ``,
    `Pedidos (excl. cancelados): ${ordersTotal}`,
    `  Retail (POS + retailLocation): ${retailOrders}`,
    `  Online:                        ${onlineOrders}`,
    `  Cancelados (ignorados):        ${cancelledCount}`,
    ``,
    `Status financeiro:`,
    `  PAID:    ${paidCount}`,
    `  Outros:  ${pendingCount}`,
    ``,
    `Receita líquida (gross - refunds, net ≥ 0):`,
    `  Retail:   ${cur} ${retailTotal.toFixed(2)}`,
    `  Online:   ${cur} ${onlineTotal.toFixed(2)}`,
    `  Total:    ${cur} ${total.toFixed(2)}`,
    `  Estornos: ${cur} ${refundedSum.toFixed(2)}`,
  ].join("\n");

  return { content: [{ type: "text", text: body }] };
}

registerToolDefinition({
  name: "shopify_audit_retail_totals",
  description:
    "Reconcilia totais de receita retail (POS + retail locations) vs online pra uma faixa de datas. Porta direto a lógica de audit_retail_goals_totals.py: exclui cancelados, line item = max(0, gross - refunds).",
  inputSchema: {
    desde: z.string().regex(ISO),
    ate: z.string().regex(ISO),
    maxPages: z.number().int().min(1).max(20).optional(),
  },
  handler: auditRetailTotalsHandler,
});
