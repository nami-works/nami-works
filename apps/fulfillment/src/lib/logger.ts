import pino, { type Logger } from "pino";

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
    { msgPrefix: `[rota-local:${slug}] ` },
  );
}
