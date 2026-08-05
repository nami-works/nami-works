import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { computeCost } from "../domain/cost.js";

const assignSchema = z.object({
  funderId: z.string().nullable(),
  dataDesconto: z.coerce.date().nullable(),
});

export function registerInstallmentRoutes(app: FastifyInstance) {
  app.get("/api/installments", async () => {
    return prisma.installment.findMany({
      include: { delivery: true, funder: true },
      orderBy: { dataVencimento: "asc" },
    });
  });

  /** Manual assignment (the interactive toggle mode alongside "suggest allocation"). */
  app.patch<{ Params: { id: string } }>("/api/installments/:id", async (request, reply) => {
    const parsed = assignSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const installment = await prisma.installment.findUnique({ where: { id: request.params.id } });
    if (!installment) return reply.code(404).send({ error: "installment_not_found" });
    if (installment.status === "operated") {
      return reply.code(409).send({ error: "already_operated" });
    }

    const { funderId, dataDesconto } = parsed.data;
    const status = funderId && dataDesconto ? "planned" : "open";
    const updated = await prisma.installment.update({
      where: { id: installment.id },
      data: { funderId, dataDesconto, status },
      include: { delivery: true, funder: true },
    });

    let cost = null;
    if (updated.funder && updated.dataDesconto) {
      cost = computeCost(Number(updated.valorFace), updated.dataVencimento, updated.dataDesconto, {
        taxaAmPct: Number(updated.funder.taxaAmPct),
        iofDiarioPct: Number(updated.funder.iofDiarioPct),
        iofFixoPct: Number(updated.funder.iofFixoPct),
        tarifaTitulo: Number(updated.funder.tarifaTitulo),
        tenorMaxDias: updated.funder.tenorMaxDias,
      });
    }
    return { ...updated, cost };
  });
}
