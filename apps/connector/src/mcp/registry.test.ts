import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolContext } from "./types.js";
import {
  __resetToolsForTesting,
  createMcpServerForTenant,
  listRegisteredToolNames,
  registerToolDefinition,
} from "./registry.js";
import { DISABLED_TOOLS, TOOL_CATALOG } from "./tool-catalog.js";
import { TOOL_TITLES, toolDisplayTitle } from "./tool-titles.js";

const silentLogger = pino({ level: "silent" });

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    tenant: {
      id: "t_test",
      slug: "test",
      displayName: "Test Tenant",
      brand: "cpg_labs",
      shopifyShop: null,
      ssmPrefix: "/nami-works/tenants/test",
      role: "operator",
      principalId: null,
      actorLabel: null,
      access: { isOwner: true, systems: {} },
    },
    logger: silentLogger,
    requestId: "req_test",
    ...overrides,
  };
}

async function connectedClient(ctx: ToolContext): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServerForTenant(ctx);
  await server.connect(serverTransport);

  const client = new Client({ name: "nami-works-test", version: "0.0.1" });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

beforeEach(() => {
  __resetToolsForTesting();
});

afterEach(() => {
  __resetToolsForTesting();
});

describe("tool registry", () => {
  it("records registered tool names", () => {
    registerToolDefinition({
      name: "alpha",
      description: "Alpha tool",
      inputSchema: { message: z.string() },
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    registerToolDefinition({
      name: "beta",
      description: "Beta tool",
      inputSchema: { n: z.number() },
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    expect(listRegisteredToolNames()).toEqual(["alpha", "beta"]);
  });

  it("exposes a registered tool through tools/list and tools/call", async () => {
    const handler = vi.fn(
      async (
        args: { message: string },
        _ctx: ToolContext,
      ): Promise<{ content: { type: "text"; text: string }[] }> => ({
        content: [{ type: "text" as const, text: `echo: ${args.message}` }],
      }),
    );
    registerToolDefinition({
      name: "echo",
      description: "Echo back the message",
      inputSchema: { message: z.string() },
      handler,
    });

    const ctx = makeCtx();
    const { client, close } = await connectedClient(ctx);
    try {
      const list = await client.listTools();
      expect(list.tools).toHaveLength(1);
      expect(list.tools[0]?.name).toBe("echo");
      expect(list.tools[0]?.title).toBe("Echo");
      expect(list.tools[0]?.description).toBe("Echo back the message");

      const callResult = await client.callTool({
        name: "echo",
        arguments: { message: "hello" },
      });
      expect(callResult.isError).toBeFalsy();
      const content = callResult.content as Array<{ type: string; text: string }>;
      expect(content[0]?.text).toBe("echo: hello");

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[1]).toMatchObject({
        tenant: { slug: "test" },
        requestId: "req_test",
      });
    } finally {
      await close();
    }
  });

  it("uses the curated pt-BR display title for known tools", () => {
    expect(toolDisplayTitle("shopify_customer_lifetime")).toBe(
      "Shopify · LTV do cliente",
    );
    expect(toolDisplayTitle("shopify_list_todays_orders")).toBe(
      "Shopify · Pedidos de hoje",
    );
    expect(toolDisplayTitle("omie_consultar_financeiro")).toBe(
      "Omie · Contas a receber",
    );
    expect(toolDisplayTitle("nami_feedback")).toBe("Suporte · Enviar feedback");
  });

  it("falls back to a derived Fornecedor · Nome title for unmapped tools", () => {
    expect(toolDisplayTitle("shopify_brand_new_report")).toBe(
      "Shopify · Brand New Report",
    );
    expect(toolDisplayTitle("echo")).toBe("Echo");
  });

  it("has a curated title for every catalog tool (no drift)", () => {
    const missing = Object.keys(TOOL_CATALOG).filter((n) => !TOOL_TITLES[n]);
    expect(missing).toEqual([]);
  });

  it("does not register tools that are in DISABLED_TOOLS", async () => {
    const disabledName = "instagram_link_account";
    expect(DISABLED_TOOLS.has(disabledName)).toBe(true);
    // A normal tool alongside so the server advertises the tools capability.
    registerToolDefinition({
      name: "visible_tool",
      description: "should be listed",
      inputSchema: {},
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    registerToolDefinition({
      name: disabledName,
      description: "should be hidden",
      inputSchema: {},
      handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    const { client, close } = await connectedClient(makeCtx());
    try {
      const list = await client.listTools();
      expect(list.tools.find((t) => t.name === "visible_tool")).toBeDefined();
      expect(list.tools.find((t) => t.name === disabledName)).toBeUndefined();
    } finally {
      await close();
    }
  });

  it("returns isError=true when a tool handler throws", async () => {
    registerToolDefinition({
      name: "broken",
      description: "Always throws",
      inputSchema: {},
      handler: async () => {
        throw new Error("kaboom");
      },
    });

    const { client, close } = await connectedClient(makeCtx());
    try {
      const result = await client.callTool({ name: "broken", arguments: {} });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]?.text).toContain("Tool invocation failed");
    } finally {
      await close();
    }
  });
});
