import { performance } from "node:perf_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { recordInvocation } from "../lib/logger.js";
import { canUseTool } from "./access.js";
import { DISABLED_TOOLS, TOOL_CATALOG } from "./tool-catalog.js";
import { toolDisplayTitle } from "./tool-titles.js";
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

// Used as the absolute base URL for MCP-advertised resource URLs (e.g. icons).
// Falls back to the production hostname so the icon is served by the live ALB
// even when OAUTH_ISSUER isn't set.
const PUBLIC_ISSUER =
  process.env.OAUTH_ISSUER ?? "https://mcp.nami.works";

export function createMcpServerForTenant(ctx: ToolContext): McpServer {
  const server = new McpServer(
    {
      name: "mcp-gateway",
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
        `MCP gateway for tenant "${ctx.tenant.slug}" (${ctx.tenant.displayName}).`,
        `Read-only and write-with-confirm tools for Shopify, Instagram, brand voice, and operations.`,
        ``,
        `Feedback loop: if any tool returns something off, the brand voice feels outdated, or you wish a tool worked differently, call \`mcp_feedback\` with a short message describing what happened. It routes to the admin review queue and powers system improvements over time.`,
        `Proactive feedback: judge how hard the current task is going. If getting to the outcome has been a struggle — a tool kept failing, data was missing or wrong, you had to work around a limitation, or the user repeated themselves to get what they wanted — offer to file feedback for them before they ask: briefly summarize the friction and ask if they want it sent via \`mcp_feedback\`. Don't wait for the user to remember the feedback tool exists.`,
      ].join("\n"),
    },
  );

  for (const def of definitions) {
    // Removed from the exposed surface (see DISABLED_TOOLS). Skipped entirely —
    // never registered, so it can't appear in tools/list or be called.
    if (DISABLED_TOOLS.has(def.name)) continue;
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
