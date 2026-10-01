import { PrismaClient } from "@prisma/client-nami-matchmaking";

const globalForPrisma = globalThis as unknown as { prismaNamiMatchmaking?: PrismaClient };

export const prismaNamiMatchmaking =
  globalForPrisma.prismaNamiMatchmaking ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaNamiMatchmaking = prismaNamiMatchmaking;
}
