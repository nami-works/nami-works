import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const STORE_CREDIT_ACCOUNT_CREDIT = /* GraphQL */ `
  mutation StoreCreditAccountCredit(
    $id: ID!
    $creditInput: StoreCreditAccountCreditInput!
  ) {
    storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
      storeCreditAccountTransaction {
        id
        amount { amount currencyCode }
        balanceAfterTransaction { amount currencyCode }
        account { id }
      }
      userErrors { field message code }
    }
  }
`;

type StoreCreditResponse = {
  storeCreditAccountCredit: {
    storeCreditAccountTransaction: {
      id: string;
      amount: { amount: string; currencyCode: string };
      balanceAfterTransaction: { amount: string; currencyCode: string };
      account: { id: string };
    } | null;
    userErrors: Array<{
      field: string[] | null;
      message: string;
      code: string | null;
    }>;
  };
};

function toCustomerGid(idOrGid: string): string {
  const trimmed = idOrGid.trim();
  if (trimmed.startsWith("gid://shopify/Customer/")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Customer/${trimmed}`;
  throw new Error(
    `customerId must be a numeric Shopify customer ID or a "gid://shopify/Customer/<id>" GID; got "${idOrGid}".`,
  );
}

export async function issueStoreCreditHandler(
  args: {
    customerId: string;
    amount: string;
    currencyCode?: string | undefined;
    expiresAt?: string | undefined;
    sourceOrderName?: string | undefined;
    confirm?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  let customerGid: string;
  try {
    customerGid = toCustomerGid(args.customerId);
  } catch (err) {
    return {
      content: [{ type: "text", text: (err as Error).message }],
      isError: true,
    };
  }

  const currencyCode = args.currencyCode ?? "BRL";
  const amount = args.amount.trim();

  if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
    return {
      content: [
        {
          type: "text",
          text: `amount must be a positive decimal string with up to 2 decimal places (e.g. "20.00"); got "${args.amount}".`,
        },
      ],
      isError: true,
    };
  }
  if (Number(amount) <= 0) {
    return {
      content: [
        { type: "text", text: `amount must be greater than 0; got "${amount}".` },
      ],
      isError: true,
    };
  }

  const summary = [
    `Customer: ${customerGid}`,
    `Credit amount: ${amount} ${currencyCode}`,
    args.expiresAt ? `Expires: ${args.expiresAt}` : `Expires: (no expiry)`,
    args.sourceOrderName
      ? `Source order (operator note, not sent to Shopify): ${args.sourceOrderName}`
      : `Source order: (not provided)`,
  ].join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({
      summary,
      actionLabel: `credit ${amount} ${currencyCode} to customer ${customerGid}`,
    });
  }

  const creditInput: Record<string, unknown> = {
    creditAmount: { amount, currencyCode },
    ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
  };

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const res = await client.request<StoreCreditResponse>(
    STORE_CREDIT_ACCOUNT_CREDIT,
    { variables: { id: customerGid, creditInput } },
  );
  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`,
    );
  }

  const data = res.data?.storeCreditAccountCredit;
  if (data?.userErrors && data.userErrors.length > 0) {
    const reasons = data.userErrors
      .map(
        (e) =>
          `  • ${e.field ? e.field.join(".") : "(no field)"}: ${e.message}${e.code ? ` [${e.code}]` : ""}`,
      )
      .join("\n");
    return {
      content: [
        { type: "text", text: `Shopify rejected the store credit:\n${reasons}` },
      ],
      isError: true,
    };
  }

  const tx = data?.storeCreditAccountTransaction;
  if (!tx) {
    return {
      content: [
        {
          type: "text",
          text: "Shopify returned no transaction and no userErrors. Treat as failure.",
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: [
          `Credited ${tx.amount.amount} ${tx.amount.currencyCode} to customer ${customerGid}.`,
          `New balance: ${tx.balanceAfterTransaction.amount} ${tx.balanceAfterTransaction.currencyCode}.`,
          `Transaction: ${tx.id}`,
          `Account: ${tx.account.id}`,
        ].join("\n"),
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_issue_store_credit",
  description:
    "Credit a customer's Shopify Store Credit account by a fixed amount. Two-step: first call returns a preview; call again with confirm: true to execute. Shopify auto-creates the store-credit account if the customer does not have one yet. To base the credit on another order, look the order up first (e.g. shopify_find_order or shopify_customer_order_history), decide the amount, then call this tool.",
  inputSchema: {
    customerId: z
      .string()
      .min(1)
      .describe(
        'Customer GID ("gid://shopify/Customer/123") or the bare numeric ID ("123").',
      ),
    amount: z
      .string()
      .describe('Decimal amount as a string, e.g. "20.00". Must be > 0.'),
    currencyCode: z
      .string()
      .optional()
      .describe("ISO 4217 code; defaults to BRL."),
    expiresAt: z
      .string()
      .optional()
      .describe("ISO 8601 expiry. Omit for no expiry."),
    sourceOrderName: z
      .string()
      .optional()
      .describe(
        'Operator note about the order this credit is based on (e.g. "#77793"). Surfaced in the preview only; Shopify\'s mutation does not accept an order reference.',
      ),
    confirm: z
      .boolean()
      .optional()
      .describe("Set to true on the second call to execute the credit."),
  },
  handler: issueStoreCreditHandler,
});
