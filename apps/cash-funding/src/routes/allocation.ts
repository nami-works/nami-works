import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { allocate, funderUtilization, type AllocFunder, type AllocInstallment } from "../domain/allocation.js";

async function loadAllocFunders(): Promise<AllocFunder[]> {
  const funders = await prisma.funder.findMany();
  const committed = await prisma.installment.groupBy({
    by: ["funderId"],
    where: { status: { in: ["planned", "operated"] }, funderId: { not: null } },
    _sum: { valorFace: true },
  });
  const committedByFunder = new Map(committed.map((c) => [c.funderId as string, Number(c._sum.valorFace ?? 0)]));

  return funders.map((f) => ({
    id: f.id,
    taxaAmPct: Number(f.taxaAmPct),
    iofDiarioPct: Number(f.iofDiarioPct),
    iofFixoPct: Number(f.iofFixoPct),
    tarifaTitulo: Number(f.tarifaTitulo),
    tenorMaxDias: f.tenorMaxDias,
    tetoLinha: Number(f.tetoLinha),
    perSacadoCap: f.perSacadoCap != null ? Number(f.perSacadoCap) : null,
    jaUsado: committedByFunder.get(f.id) ?? 0,
  }));
}

async function loadOpenInstallments(): Promise<{ rows: AllocInstallment[]; byId: Map<string, AllocInstallment> }> {
  const open = await prisma.installment.findMany({
    where: { status: "open" },
    include: { delivery: true },
  });
  const rows: AllocInstallment[] = open.map((i) => ({
    id: i.id,
    cnpjSacado: i.delivery.cnpjSacado,
    valorFace: Number(i.valorFace),
    dataVencimento: i.dataVencimento,
  }));
  return { rows, byId: new Map(rows.map((r) => [r.id, r])) };
}

const suggestSchema = z.object({
  discountDate: z.coerce.date(),
  cutoffDate: z.coerce.date().nullable().optional(),
});

export function registerAllocationRoutes(app: FastifyInstance) {
  app.post("/api/allocation/suggest", async (request, reply) => {
    const parsed = suggestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const funders = await loadAllocFunders();
    const { rows, byId } = await loadOpenInstallments();
    const results = allocate(rows, funders, parsed.data.discountDate, parsed.data.cutoffDate ?? undefined);
    const utilization = funderUtilization(funders, results, byId);

    const totalFace = results.filter((r) => r.funderId).reduce((sum, r) => sum + (byId.get(r.installmentId)?.valorFace ?? 0), 0);
    const totalNet = results.filter((r) => r.cost).reduce((sum, r) => sum + (r.cost?.liquido ?? 0), 0);
    const totalCost = results.filter((r) => r.cost).reduce((sum, r) => sum + (r.cost?.custo ?? 0), 0);

    return { results, utilization, totals: { totalFace, totalNet, totalCost, count: results.filter((r) => r.funderId).length } };
  });

  const applySchema = z.object({
    assignments: z.array(
      z.object({
        installmentId: z.string(),
        funderId: z.string(),
        discountDate: z.coerce.date(),
      }),
    ),
  });

  /** Persists a chosen set of suggestions (or a hand-edited subset of them). */
  app.post("/api/allocation/apply", async (request, reply) => {
    const parsed = applySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await prisma.$transaction(
      parsed.data.assignments.map((a) =>
        prisma.installment.updateMany({
          where: { id: a.installmentId, status: "open" },
          data: { funderId: a.funderId, dataDesconto: a.discountDate, status: "planned" },
        }),
      ),
    );
    return { ok: true, applied: parsed.data.assignments.length };
  });

  app.get("/api/utilization", async () => {
    const funders = await loadAllocFunders();
    return funderUtilization(funders, [], new Map());
  });
}
