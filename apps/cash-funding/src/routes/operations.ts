import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";

export function registerOperationRoutes(app: FastifyInstance) {
  app.get("/api/operations", async () => {
    return prisma.operation.findMany({
      include: { funder: true, installments: true },
      orderBy: { dataOperacao: "desc" },
    });
  });
}
