import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { generateInstallmentValues } from "../domain/generateInstallments.js";

const deliverySchema = z.object({
  cliente: z.string().min(1),
  cnpjSacado: z.string().min(1),
  produto: z.string().min(1),
  qtd: z.number().int().positive(),
  precoUnit: z.number().positive(),
  total: z.number().positive(),
  numParcelas: z.number().int().positive(),
  firstOffsetDias: z.number().int().min(0),
  intervalDias: z.number().int().min(0),
  calendar: z.enum(["corrido", "terca_3_25"]),
  dataEntrega: z.coerce.date(),
  status: z.enum(["planned", "invoiced", "received"]).optional(),
  notes: z.string().nullable().optional(),
});

/** (Re)generates a delivery's installments. Wipes any existing manual
 * discount-date/funder assignments on that delivery — deliveries change
 * (see UAUBox revision in the handoff), and the doc accepts this tradeoff:
 * "regenerate on delivery edit." */
async function regenerateInstallments(deliveryId: string, fields: Parameters<typeof generateInstallmentValues>[0]) {
  const rows = generateInstallmentValues(fields);
  await prisma.$transaction([
    prisma.installment.deleteMany({ where: { deliveryId, status: "open" } }),
    ...rows.map((r) =>
      prisma.installment.upsert({
        where: { deliveryId_numero: { deliveryId, numero: r.numero } },
        create: { deliveryId, numero: r.numero, valorFace: r.valorFace, dataVencimento: r.dataVencimento },
        update: { valorFace: r.valorFace, dataVencimento: r.dataVencimento },
      }),
    ),
  ]);
}

export function registerDeliveryRoutes(app: FastifyInstance) {
  app.get("/api/deliveries", async () => {
    return prisma.delivery.findMany({
      include: { installments: { include: { funder: true }, orderBy: { numero: "asc" } } },
      orderBy: { dataEntrega: "asc" },
    });
  });

  app.post("/api/deliveries", async (request, reply) => {
    const parsed = deliverySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    const delivery = await prisma.delivery.create({ data: d });
    await regenerateInstallments(delivery.id, d);
    return prisma.delivery.findUnique({
      where: { id: delivery.id },
      include: { installments: { orderBy: { numero: "asc" } } },
    });
  });

  app.put<{ Params: { id: string } }>("/api/deliveries/:id", async (request, reply) => {
    const parsed = deliverySchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const existing = await prisma.delivery.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.code(404).send({ error: "delivery_not_found" });

    const updated = await prisma.delivery.update({ where: { id: existing.id }, data: parsed.data });
    // Only regenerate installments if a field that affects the schedule/value changed.
    const scheduleFields = ["total", "numParcelas", "firstOffsetDias", "intervalDias", "calendar", "dataEntrega"] as const;
    if (scheduleFields.some((f) => f in parsed.data)) {
      await regenerateInstallments(updated.id, {
        total: Number(updated.total),
        numParcelas: updated.numParcelas,
        firstOffsetDias: updated.firstOffsetDias,
        intervalDias: updated.intervalDias,
        calendar: updated.calendar,
        dataEntrega: updated.dataEntrega,
      });
    }
    return prisma.delivery.findUnique({
      where: { id: updated.id },
      include: { installments: { include: { funder: true }, orderBy: { numero: "asc" } } },
    });
  });

  app.delete<{ Params: { id: string } }>("/api/deliveries/:id", async (request, reply) => {
    try {
      await prisma.delivery.delete({ where: { id: request.params.id } });
      return { ok: true };
    } catch {
      return reply.code(404).send({ error: "delivery_not_found" });
    }
  });
}
