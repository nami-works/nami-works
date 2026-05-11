import { performance } from "node:perf_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { recordInvocation } from "../lib/logger.js";
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
    { capabilities: { tools: {} } },
  );

  for (const def of definitions) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: def.inputSchema },
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
