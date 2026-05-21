import pino, { type Logger } from "pino";
import { prisma } from "../db/prisma.js";

const isDev = process.env.NODE_ENV === "development";

export const rootLogger: Logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
});

export function tenantLogger(slug: string): Logger {
  return rootLogger.child(
    { tenant: slug },
    { msgPrefix: `[nami:${slug}] ` },
  );
}

export type InvocationRecord = {
  tenantId: string;
  toolName: string;
  status: "ok" | "err";
  durationMs: number;
  requestId: string;
};

export async function recordInvocation(args: InvocationRecord): Promise<void> {
  // Audit is best-effort. Skip entirely when DATABASE_URL isn't configured
  // (tests, local dev without Postgres) — rather than logging a Prisma
  // connection error for every tool call.
  if (!process.env.DATABASE_URL) return;
  try {
    await prisma.toolInvocationLog.create({ data: args });
  } catch (err) {
    rootLogger.error(
      { err, tool: args.toolName, requestId: args.requestId },
      "failed to write ToolInvocationLog row",
    );
  }
}
