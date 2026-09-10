import { z } from "zod";
import { getShopifyClient } from "../../clients/shopify.js";
import { confirmationPreview } from "../../lib/confirm.js";
import { registerToolDefinition } from "../../mcp/registry.js";
import type { ToolContext, ToolResult } from "../../mcp/types.js";

/**
 * Create-or-update a Shopify Online Store Page (title, body HTML, template
 * suffix, published state) — the thing the team has so far only had via
 * one-off scripts (gebeauty/scripts/_b2b_publish_pages.py and friends), one
 * page at a time, run manually from the CLI. This makes it a standing
 * connector capability.
 *
 * Upsert by handle: looks up an existing page by `handle` first. If found,
 * pageUpdate with only the fields the caller supplied (untouched fields are
 * omitted from the mutation input, so they keep their current value). If not
 * found, pageCreate — `title` is required in that case since Shopify's
 * PageCreateInput requires it. The page's handle is only ever used for
 * lookup/creation, never passed into pageUpdate, so this can't accidentally
 * rename an existing page's URL.
 */

const PAGE_BY_HANDLE_QUERY = /* GraphQL */ `
  query PageByHandle($query: String!) {
    pages(first: 1, query: $query) {
      nodes {
        id
        title
        handle
        body
        isPublished
        templateSuffix
      }
    }
  }
`;

const PAGE_CREATE_MUTATION = /* GraphQL */ `
  mutation CreatePage($page: PageCreateInput!) {
    pageCreate(page: $page) {
      page {
        id
        title
        handle
        isPublished
        templateSuffix
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PAGE_UPDATE_MUTATION = /* GraphQL */ `
  mutation UpdatePage($id: ID!, $page: PageUpdateInput!) {
    pageUpdate(id: $id, page: $page) {
      page {
        id
        title
        handle
        isPublished
        templateSuffix
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type ExistingPage = {
  id: string;
  title: string;
  handle: string;
  body: string;
  isPublished: boolean;
  templateSuffix: string | null;
};

type PageByHandleResponse = {
  pages: { nodes: ExistingPage[] };
};

type PageWriteResult = {
  page: { id: string; title: string; handle: string; isPublished: boolean; templateSuffix: string | null } | null;
  userErrors: Array<{ field: string[] | null; message: string }>;
};

type PageCreateResponse = { pageCreate: PageWriteResult };
type PageUpdateResponse = { pageUpdate: PageWriteResult };

// HTML bodies can be long — the confirm preview shows a truncated diff, not
// the full markup, so the reviewer isn't scrolling past a wall of tags.
function truncate(s: string, max = 200): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine || "(vazio)";
}

export async function writePageHandler(
  args: {
    handle: string;
    title?: string | undefined;
    body?: string | undefined;
    templateSuffix?: string | undefined;
    published?: boolean | undefined;
    confirm?: boolean | undefined;
  },
  ctx: ToolContext,
): Promise<ToolResult> {
  const client = await getShopifyClient({
    ssmPrefix: ctx.tenant.ssmPrefix,
    shopifyShop: ctx.tenant.shopifyShop ?? "",
  });

  const lookupRes = await client.request<PageByHandleResponse>(PAGE_BY_HANDLE_QUERY, {
    variables: { query: `handle:${args.handle}` },
  });
  if (lookupRes.errors) {
    throw new Error(`Shopify GraphQL error: ${lookupRes.errors.message ?? "unknown error"}`);
  }
  const existing = lookupRes.data?.pages.nodes[0] ?? null;

  if (!existing && !args.title) {
    return {
      content: [
        {
          type: "text",
          text: `No page found with handle "${args.handle}". Creating a new page requires \`title\`.`,
        },
      ],
      isError: true,
    };
  }

  const shop = ctx.tenant.shopifyShop ?? "";
  const pageUrl = `https://${shop}/pages/${args.handle}`;

  const summaryLines: string[] = existing
    ? [
        `Updating existing page: "${existing.title}" (${pageUrl})`,
        ``,
        ...(args.title !== undefined ? [`title:           ${existing.title}  →  ${args.title}`] : []),
        ...(args.body !== undefined
          ? [`body:            ${truncate(existing.body)}\n                  →  ${truncate(args.body)}`]
          : []),
        ...(args.templateSuffix !== undefined
          ? [`templateSuffix:  ${existing.templateSuffix ?? "(padrão)"}  →  ${args.templateSuffix || "(padrão)"}`]
          : []),
        ...(args.published !== undefined
          ? [`published:       ${existing.isPublished}  →  ${args.published}`]
          : []),
      ]
    : [
        `Creating new page: "${args.title}" (${pageUrl})`,
        ``,
        `handle:          ${args.handle}`,
        `body:            ${args.body !== undefined ? truncate(args.body) : "(vazio)"}`,
        `templateSuffix:  ${args.templateSuffix || "(padrão)"}`,
        `published:       ${args.published ?? true}`,
      ];

  if (args.published === false && existing?.isPublished !== false) {
    summaryLines.push(``, `⚠ This unpublishes a live page — it becomes inaccessible at ${pageUrl}.`);
  }

  const summary = summaryLines.join("\n");

  if (args.confirm !== true) {
    return confirmationPreview({
      summary,
      actionLabel: existing ? `update page "${args.handle}"` : `create page "${args.handle}"`,
    });
  }

  if (existing) {
    const updateRes = await client.request<PageUpdateResponse>(PAGE_UPDATE_MUTATION, {
      variables: {
        id: existing.id,
        page: {
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.body !== undefined ? { body: args.body } : {}),
          ...(args.templateSuffix !== undefined ? { templateSuffix: args.templateSuffix } : {}),
          ...(args.published !== undefined ? { isPublished: args.published } : {}),
        },
      },
    });
    if (updateRes.errors) {
      throw new Error(`Shopify GraphQL error: ${updateRes.errors.message ?? "unknown error"}`);
    }
    const userErrors = updateRes.data?.pageUpdate.userErrors ?? [];
    if (userErrors.length > 0) {
      return {
        content: [{ type: "text", text: `Failed: ${userErrors.map((e) => e.message).join("; ")}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Updated page.\n\n${summary}` }],
    };
  }

  const createRes = await client.request<PageCreateResponse>(PAGE_CREATE_MUTATION, {
    variables: {
      page: {
        title: args.title,
        handle: args.handle,
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.templateSuffix !== undefined ? { templateSuffix: args.templateSuffix } : {}),
        ...(args.published !== undefined ? { isPublished: args.published } : {}),
      },
    },
  });
  if (createRes.errors) {
    throw new Error(`Shopify GraphQL error: ${createRes.errors.message ?? "unknown error"}`);
  }
  const userErrors = createRes.data?.pageCreate.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      content: [{ type: "text", text: `Failed: ${userErrors.map((e) => e.message).join("; ")}` }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: `Created page.\n\n${summary}` }],
  };
}

registerToolDefinition({
  name: "shopify_write_page",
  description:
    "Create or update a Shopify Online Store page (title, body HTML, template suffix, published state). Looks up an existing page by `handle` — if found, updates only the fields you provide (others stay unchanged); if not found, creates a new page (requires `title`). Never changes an existing page's handle/URL. Two-step: first call (no confirm) returns a preview with a before/after diff; call again with confirm: true to apply.",
  inputSchema: {
    handle: z
      .string()
      .min(1)
      .describe("Page handle (URL slug), e.g. 'sobre-nos'. Used to find an existing page, or set on a new one."),
    title: z
      .string()
      .min(1)
      .optional()
      .describe("Page title. Required when creating a new page. Omit on update to leave unchanged."),
    body: z
      .string()
      .optional()
      .describe("Page content as raw HTML. Omit on update to leave the existing content unchanged."),
    templateSuffix: z
      .string()
      .optional()
      .describe("Theme template suffix (e.g. 'b2b' renders page.b2b.liquid). Omit to leave unchanged on update, or use the default page template on create."),
    published: z
      .boolean()
      .optional()
      .describe("Whether the page should be visible. Defaults to true on create if omitted. Omit on update to leave unchanged."),
    confirm: z
      .boolean()
      .optional()
      .describe("Set to true on the second call to execute the change."),
  },
  handler: writePageHandler,
});
