import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";

const updateSchema = z.object({
  taxaAmPct: z.number().optional(),
  iofDiarioPct: z.number().optional(),
  iofFixoPct: z.number().optional(),
  tarifaOperacao: z.number().optional(),
  tarifaTitulo: z.number().optional(),
  tenorMaxDias: z.number().int().optional(),
  tetoLinha: z.number().optional(),
  perSacadoCap: z.number().nullable().optional(),
  recourse: z.boolean().optional(),
  costsConfirmed: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export function registerFunderRoutes(app: FastifyInstance) {
  app.get("/api/funders", async () => {
    return prisma.funder.findMany({ orderBy: { name: "asc" } });
  });

  app.put<{ Params: { id: string } }>("/api/funders/:id", async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const updated = await prisma.funder.update({
        where: { id: request.params.id },
        data: parsed.data,
      });
      return updated;
    } catch {
      return reply.code(404).send({ error: "funder_not_found" });
    }
  });
}
