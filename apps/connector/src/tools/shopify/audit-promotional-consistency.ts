import { getShopifyClient } from "../../clients/shopify.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * Cross-references what the theme's announcement/promo text CLAIMS (e.g.
 * "20% off") against what's actually LIVE as an active discount. Directly
 * addresses the Kit Verão incident: stacked promos where the banner text
 * said one thing while the store quietly applied a different combination.
 * Read-only audit — flags mismatches, doesn't fix them.
 */

const MAIN_THEME_QUERY = /* GraphQL */ `
  query MainTheme {
    themes(first: 1, roles: [MAIN]) {
      nodes { id role name }
    }
  }
`;

const THEME_TEXTS_QUERY = /* GraphQL */ `
  query ThemeTexts($id: ID!) {
    theme(id: $id) {
      id
      files(filenames: ["sections/header-group.json", "config/settings_data.json"], first: 2) {
        nodes {
          filename
          body { ... on OnlineStoreThemeFileBodyText { content } }
        }
      }
    }
  }
`;

const ACTIVE_DISCOUNTS_QUERY = /* GraphQL */ `
  query ActiveDiscounts {
    codeDiscountNodes(first: 50, query: "status:active") {
      nodes {
        codeDiscount {
          __typename
          ... on DiscountCodeBasic {
            title
            codes(first: 1) { edges { node { code } } }
            customerGets {
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount } }
              }
            }
          }
        }
      }
    }
    automaticDiscountNodes(first: 50, query: "status:active") {
      nodes {
        automaticDiscount {
          __typename
          ... on DiscountAutomaticBasic {
            title
            customerGets {
              value {
                __typename
                ... on DiscountPercentage { percentage }
                ... on DiscountAmount { amount { amount } }
              }
            }
          }
        }
      }
    }
  }
`;

type MainThemeResponse = {
  themes: { nodes: Array<{ id: string; role: string; name: string }> };
};
type ThemeTextsResponse = {
  theme: {
    files: { nodes: Array<{ filename: string; body: { content?: string } | null }> };
  } | null;
};
type ActiveDiscountsResponse = {
  codeDiscountNodes: {
    nodes: Array<{
      codeDiscount: {
        __typename: string;
        title?: string;
        codes?: { edges: Array<{ node: { code: string } }> };
        customerGets?: { value: { __typename: string; percentage?: number; amount?: { amount: string } } };
      };
    }>;
  };
  automaticDiscountNodes: {
    nodes: Array<{
      automaticDiscount: {
        __typename: string;
        title?: string;
        customerGets?: { value: { __typename: string; percentage?: number; amount?: { amount: string } } };
      };
    }>;
  };
};

type ActiveDiscount = { label: string; percentage: number | null; amount: number | null };

// Recursively collect string values from keys that look like display text
// (announcement-bar block settings and settings_data.json's promo strings
// are all plain "text"/"*_text" keys — no need to know the exact block ids).
function collectTextStrings(node: unknown, acc: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectTextStrings(item, acc);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && /text/i.test(key)) acc.push(value);
      else collectTextStrings(value, acc);
    }
  }
}

function extractPercentages(texts: string[]): number[] {
  const found = new Set<number>();
  for (const text of texts) {
    const stripped = text.replace(/<[^>]+>/g, " ");
    for (const match of stripped.matchAll(/(\d{1,3})\s*%/g)) {
      found.add(Number(match[1]));
    }
  }
  return [...found];
}

export async function auditPromotionalConsistencyHandler(
  _args: Record<string, never>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const themeRes = await client.request<MainThemeResponse>(MAIN_THEME_QUERY);
  if (themeRes.errors) {
    throw new Error(`Shopify GraphQL error: ${themeRes.errors.message ?? "unknown error"}`);
  }
  const theme = themeRes.data?.themes.nodes[0];
  if (!theme) {
    return { content: [{ type: "text", text: "No theme with role MAIN found." }], isError: true };
  }

  const textsRes = await client.request<ThemeTextsResponse>(THEME_TEXTS_QUERY, {
    variables: { id: theme.id },
  });
  if (textsRes.errors) {
    throw new Error(`Shopify GraphQL error: ${textsRes.errors.message ?? "unknown error"}`);
  }
  const files = textsRes.data?.theme?.files.nodes ?? [];

  const allTexts: string[] = [];
  for (const f of files) {
    if (!f.body?.content) continue;
    try {
      collectTextStrings(JSON.parse(f.body.content), allTexts);
    } catch {
      // Non-JSON or malformed file — skip rather than fail the whole audit.
    }
  }
  const claimedPercentages = extractPercentages(allTexts);

  const discountsRes = await client.request<ActiveDiscountsResponse>(ACTIVE_DISCOUNTS_QUERY);
  if (discountsRes.errors) {
    throw new Error(`Shopify GraphQL error: ${discountsRes.errors.message ?? "unknown error"}`);
  }

  const active: ActiveDiscount[] = [];
  for (const n of discountsRes.data?.codeDiscountNodes.nodes ?? []) {
    const cd = n.codeDiscount;
    if (cd.__typename !== "DiscountCodeBasic") continue;
    const value = cd.customerGets?.value;
    const code = cd.codes?.edges[0]?.node.code;
    active.push({
      label: `code "${code ?? cd.title ?? "?"}"`,
      percentage: value?.__typename === "DiscountPercentage" ? (value.percentage ?? 0) * 100 : null,
      amount: value?.__typename === "DiscountAmount" ? Number(value.amount?.amount ?? 0) : null,
    });
  }
  for (const n of discountsRes.data?.automaticDiscountNodes.nodes ?? []) {
    const ad = n.automaticDiscount;
    if (ad.__typename !== "DiscountAutomaticBasic") continue;
    const value = ad.customerGets?.value;
    active.push({
      label: `automatic "${ad.title ?? "?"}"`,
      percentage: value?.__typename === "DiscountPercentage" ? (value.percentage ?? 0) * 100 : null,
      amount: value?.__typename === "DiscountAmount" ? Number(value.amount?.amount ?? 0) : null,
    });
  }

  const lines: string[] = [];
  lines.push(`Theme: "${theme.name}" (role ${theme.role})`);
  lines.push(``);
  lines.push(
    claimedPercentages.length > 0
      ? `Percentages mentioned in banner/promo text: ${claimedPercentages.map((p) => `${p}%`).join(", ")}`
      : `No percentage figures found in banner/promo text.`,
  );
  lines.push(
    active.length > 0
      ? `Active discounts (${active.length}): ${active.map((a) => `${a.label} = ${a.percentage != null ? `${a.percentage}%` : a.amount != null ? `R$${a.amount}` : "?"}`).join(", ")}`
      : `No active code or automatic discounts found.`,
  );
  lines.push(``);

  const unmatchedClaims = claimedPercentages.filter((p) => !active.some((a) => a.percentage === p));
  const unmentionedActive = active.filter((a) => a.percentage != null && !claimedPercentages.includes(a.percentage));

  if (unmatchedClaims.length === 0 && unmentionedActive.length === 0 && claimedPercentages.length > 0) {
    lines.push(`✓ Every percentage mentioned in theme text matches an active discount.`);
  }
  if (unmatchedClaims.length > 0) {
    lines.push(
      `⚠ Theme text claims ${unmatchedClaims.map((p) => `${p}%`).join(", ")} but no active discount matches — stale/wrong copy, or the discount already expired.`,
    );
  }
  if (unmentionedActive.length > 0) {
    lines.push(
      `⚠ Active but not mentioned in any banner text: ${unmentionedActive.map((a) => `${a.label} (${a.percentage}%)`).join(", ")} — could be intentional (targeted/hidden), or a stacking risk the customer isn't told about.`,
    );
  }

  return { content: [{ type: "text", text: lines.join("\n") }] };
}

registerToolDefinition({
  name: "shopify_audit_promotional_consistency",
  description:
    "Cross-references percentage figures mentioned in the live theme's announcement bar / promo bar text (sections/header-group.json, config/settings_data.json) against actually-active discount codes and automatic discounts. Flags text claims with no matching active discount (stale copy) and active discounts not mentioned anywhere (undisclosed stacking risk) — the Kit Verão incident pattern. Read-only, no confirm needed.",
  inputSchema: {},
  handler: auditPromotionalConsistencyHandler,
});
