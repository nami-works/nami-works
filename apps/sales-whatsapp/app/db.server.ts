import { PrismaClient } from "@prisma/client-sales-whatsapp";

declare global {
  var __salesWhatsappPrisma: PrismaClient | undefined;
}

// Standard dev-hot-reload-safe singleton, same pattern used across every
// Prisma-backed app in this monorepo.
const prisma = global.__salesWhatsappPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") {
  global.__salesWhatsappPrisma = prisma;
}

export default prisma;
