import type { PrincipalRole } from "@prisma/client-connector";
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
  // Minimum role required to see and call this tool. Omitted = any authenticated
  // principal (owner or operator). Set to "owner" for canonical/structural
  // actions that must be gated to the tenant owner (e.g. Omie classification).
  requiredRole?: PrincipalRole;
  handler: (
    args: z.output<z.ZodObject<Shape>>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
};
