import type { Logger } from "pino";
import type { z, ZodRawShape } from "zod";
import type { TenantContext } from "../auth/tenant-auth.js";

export type ToolContext = {
  tenant: TenantContext;
  logger: Logger;
  requestId: string;
};

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolDefinition<Shape extends ZodRawShape = ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (
    args: z.output<z.ZodObject<Shape>>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
};
