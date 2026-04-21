import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

const CREATE_DISCOUNT = /* GraphQL */ `
  mutation CreateBasicDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message code }
    }
  }
`;

type CreateDiscountResponse = {
  discountCodeBasicCreate: {
    codeDiscountNode: { id: string } | null;
    userErrors: Array<{
      field: string[] | null;
      message: string;
      code: string | null;
    }>;
  };
};

function describeValue(args: {
  percentageOff?: number | undefined;
  amountOff?: { amount: string; currencyCode?: string | undefined } | undefined;
}): string {
  if (typeof args.percentageOff === "number") {
    return `${(args.percentageOff * 100).toFixed(0)}% off`;
  }
  if (args.amountOff) {
    return `${args.amountOff.amount} ${args.amountOff.currencyCode ?? "BRL"} off`;
  }
  return "(no value set)";
}

function buildDiscountValue(args: {
  percentageOff?: number | undefined;
  amountOff?: { amount: string; currencyCode?: string | undefined } | undefined;
}): Record<string, unknown> {
  if (typeof args.percentageOff === "number") {
    return { percentage: args.percentageOff };
  }
  if (args.amountOff) {
    return {
      discountAmount: {
        amount: args.amountOff.amount,
        appliesOnEachItem: false,
      },
    };
  }
  throw new Error("Either percentageOff or amountOff must be provided.");
}

export async function createDiscountCodeHandler(
  args: {
    code: string;
    percentageOff?: number | undefined;
    amountOff?:
      | { amount: string; currencyCode?: string | undefined }
      | undefined;
    appliesOncePerCustomer?: boolean | undefined;
    startsAt?: string | undefined;
    endsAt?: string | undefined;
    confirm?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  if (args.percentageOff === undefined && args.amountOff === undefined) {
    return {
      content: [
        {
          type: "text",
          text: "Provide exactly one of: percentageOff (0.01–1.0) or amountOff ({ amount, currencyCode }).",
        },
      ],
      isError: true,
    };
  }
  if (args.percentageOff !== undefined && args.amountOff !== undefined) {
    return {
      content: [
        {
          type: "text",
          text: "Provide only one of percentageOff or amountOff, not both.",
        },
      ],
      isError: true,
    };
  }

  const code = args.code.trim();
  const startsAt = args.startsAt ?? new Date().toISOString();

  const summary = [
    `Discount code: ${code}`,
    `Value: ${describeValue(args)}`,
    `Starts: ${startsAt}`,
    args.endsAt ? `Ends: ${args.endsAt}` : `Ends: (no expiry)`,
    `Applies once per customer: ${args.appliesOncePerCustomer === true ? "yes" : "no"}`,
    `Scope: all products, all customers (v1 default — single-code mode).`,
  ].join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({
      summary,
      actionLabel: `create discount code "${code}"`,
    });
  }

  const input: Record<string, unknown> = {
    title: code,
    code,
    startsAt,
    ...(args.endsAt ? { endsAt: args.endsAt } : {}),
    customerSelection: { all: true },
    customerGets: {
      value: buildDiscountValue(args),
      items: { all: true },
    },
    appliesOncePerCustomer: args.appliesOncePerCustomer === true,
  };

  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const res = await client.request<CreateDiscountResponse>(CREATE_DISCOUNT, {
    variables: { basicCodeDiscount: input },
  });
  if (res.errors) {
    throw new Error(
      `Shopify GraphQL error: ${res.errors.message ?? "unknown error"}`,
    );
  }

  const data = res.data?.discountCodeBasicCreate;
  if (data?.userErrors && data.userErrors.length > 0) {
    const reasons = data.userErrors
      .map(
        (e) =>
          `  • ${e.field ? e.field.join(".") : "(no field)"}: ${e.message}${e.code ? ` [${e.code}]` : ""}`,
      )
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Shopify rejected the discount:\n${reasons}`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: `Created discount code "${code}" (${describeValue(args)}). Shopify ID: ${data?.codeDiscountNode?.id ?? "unknown"}.`,
      },
    ],
  };
}

registerToolDefinition({
  name: "shopify_create_discount_code",
  description:
    "Create a single-code Shopify discount (basic code discount). Provide either percentageOff (0.10 for 10%) OR amountOff ({ amount, currencyCode }) — not both. Two-step: first call returns a preview; call again with confirm: true to create.",
  inputSchema: {
    code: z
      .string()
      .min(1)
      .max(64)
      .describe("The coupon code customers will type at checkout."),
    percentageOff: z
      .number()
      .min(0.01)
      .max(1)
      .optional()
      .describe("Fractional percentage, e.g. 0.10 for 10% off."),
    amountOff: z
      .object({
        amount: z.string().describe("Decimal amount, e.g. 20.00"),
        currencyCode: z
          .string()
          .optional()
          .describe("ISO 4217 code; defaults to BRL."),
      })
      .optional()
      .describe("Fixed amount off."),
    appliesOncePerCustomer: z
      .boolean()
      .optional()
      .describe("If true, each customer can redeem the code only once."),
    startsAt: z
      .string()
      .optional()
      .describe("ISO 8601 start time. Defaults to now."),
    endsAt: z
      .string()
      .optional()
      .describe("ISO 8601 end time. Omit for no expiry."),
    confirm: z
      .boolean()
      .optional()
      .describe("Set to true on the second call to execute creation."),
  },
  handler: createDiscountCodeHandler,
});
