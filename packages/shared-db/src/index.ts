import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

/**
 * Create or reuse a PrismaClient singleton.
 * In development, stores on `globalThis` to survive HMR reloads.
 */
export function createPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV !== "production") {
    if (!global.prismaGlobal) {
      global.prismaGlobal = new PrismaClient();
    }
    return global.prismaGlobal;
  }
  return new PrismaClient();
}
