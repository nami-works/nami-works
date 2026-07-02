import { performance } from "node:perf_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { recordInvocation } from "../lib/logger.js";
import { canUseTool } from "./access.js";
import { TOOL_CATALOG } from "./tool-catalog.js";
import type { ToolContext, ToolDefinition, ToolResult } from "./types.js";

const definitions: ToolDefinition<ZodRawShape>[] = [];

export function registerToolDefinition<Shape extends ZodRawShape>(
  def: ToolDefinition<Shape>,
): void {
  definitions.push(def as unknown as ToolDefinition<ZodRawShape>);
}

export function __resetToolsForTesting(): void {
  definitions.length = 0;
}

export function listRegisteredToolNames(): string[] {
  return definitions.map((d) => d.name);
}

// Human-readable display title per tool. MCP clients (claude.ai) show the tool
// `title` when present, falling back to humanizing the programmatic `name`
// (e.g. shopify_customer_ltv → "Shopify customer ltv"). We render
// "Vendor · Readable Name" (middle-dot separator) so the flat tool list reads
// cleanly and clusters by vendor. Derived from the name — no per-tool config.
const TOOL_VENDOR_LABELS: Record<string, string> = {
  shopify: "Shopify",
  omie: "Omie",
  instagram: "Instagram",
  brand: "Brand",
  affiliates: "Affiliates",
  nami: "NAMI",
};

// Tokens that should render uppercase (or mixed) instead of Title Case.
const TOOL_TITLE_ACRONYMS: Record<string, string> = {
  ltv: "LTV",
  seo: "SEO",
  pos: "POS",
  id: "ID",
  url: "URL",
  aov: "AOV",
  ugc: "UGC",
  cpf: "CPF",
  cnpj: "CNPJ",
  nfe: "NFe",
  b2b: "B2B",
  cd: "CD",
  sku: "SKU",
};

function capitalize(word: string): string {
  return word ? word[0].toUpperCase() + word.slice(1) : word;
}

export function toolDisplayTitle(name: string): string {
  const [vendor, ...rest] = name.split("_");
  const label = TOOL_VENDOR_LABELS[vendor] ?? capitalize(vendor);
  const readable = rest
    .map((w) => TOOL_TITLE_ACRONYMS[w] ?? capitalize(w))
    .join(" ");
  return readable ? `${label} · ${readable}` : label;
}

// Used as the absolute base URL for MCP-advertised resource URLs (e.g. icons).
// Falls back to the production hostname so the icon is served by the live ALB
// even when OAUTH_ISSUER isn't set.
const PUBLIC_ISSUER =
  process.env.OAUTH_ISSUER ?? "https://mcp.nami.works";

export function createMcpServerForTenant(ctx: ToolContext): McpServer {
  const server = new McpServer(
    {
      name: "nami-works-gateway",
      version: "0.1.0",
      icons: [
        {
          src: `${PUBLIC_ISSUER}/icon.png`,
          mimeType: "image/png",
          sizes: ["any"],
        },
      ],
    },
    {
      capabilities: { tools: {} },
      instructions: [
        `NAMI Works gateway for tenant "${ctx.tenant.slug}" (${ctx.tenant.displayName}).`,
        `Read-only and write-with-confirm tools for Shopify, Instagram, brand voice, and operations.`,
        ``,
        `Feedback loop: if any tool returns something off, the brand voice feels outdated, or you wish a tool worked differently, call \`nami_feedback\` with a short message describing what happened. It routes to NAMI Works for review and powers system improvements over time.`,
      ].join("\n"),
    },
  );

  for (const def of definitions) {
    // Access gate. Owner-only admin tools require owner. Every other tool is
    // filtered by the principal's effective per-system access (union of their
    // roles' grants; read vs write) via the tool catalog. A registered tool
    // missing from the catalog fails closed (owner-only).
    if (def.requiredRole === "owner" && !ctx.tenant.access.isOwner) continue;
    const catalogEntry = TOOL_CATALOG[def.name];
    if (catalogEntry) {
      if (!canUseTool(ctx.tenant.access, catalogEntry)) continue;
    } else if (!ctx.tenant.access.isOwner) {
      continue;
    }
    server.registerTool(
      def.name,
      {
        title: toolDisplayTitle(def.name),
        description: def.description,
        inputSchema: def.inputSchema,
      },
      async (args: unknown) => {
        const start = performance.now();
        let result: ToolResult;
        let status: "ok" | "err" = "ok";
        try {
          result = await def.handler(
            args as z_output_of<typeof def.inputSchema>,
            ctx,
          );
          if (result.isError) status = "err";
        } catch (err) {
          status = "err";
          ctx.logger.error(
            { err, tool: def.name, requestId: ctx.requestId },
            `tool=${def.name} status=err`,
          );
          result = {
            content: [
              {
                type: "text",
                text: "Tool invocation failed. See server logs for details.",
              },
            ],
            isError: true,
          };
        }
        const durationMs = Math.round(performance.now() - start);
        ctx.logger.info(
          {
            tool: def.name,
            status,
            durationMs,
            requestId: ctx.requestId,
          },
          `tool=${def.name} status=${status} durationMs=${durationMs} requestId=${ctx.requestId}`,
        );
        void recordInvocation({
          tenantId: ctx.tenant.id,
          toolName: def.name,
          status,
          durationMs,
          requestId: ctx.requestId,
          principalId: ctx.tenant.principalId,
          actorLabel: ctx.tenant.actorLabel,
        });
        return result;
      },
    );
  }

  return server;
}

// Local helper alias: we intentionally erase the handler's input type at the
// SDK boundary. The SDK validates args against inputSchema before calling the
// callback, so by the time args reach def.handler they already match the
// ZodRawShape's inferred output type.
type z_output_of<S> = S extends ZodRawShape
  ? { [K in keyof S]: unknown }
  : never;
