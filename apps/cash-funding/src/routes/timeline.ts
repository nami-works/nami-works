import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { allocate, type AllocInstallment, type Verdict } from "../domain/allocation.js";
import { loadAllocFunders } from "./allocation.js";

// Verdict severity for aggregating cells that cover more than one
// installment (a client-total column, or — rarely — two installments of the
// same PO landing in the same month). Worst case wins: any grey makes the
// cell grey, else any yellow makes it yellow, else green.
const SEVERITY: Record<Verdict, number> = { grey: 2, yellow: 1, green: 0 };
function worst(a: Verdict, b: Verdict): Verdict {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const querySchema = z.object({
  date: z.coerce.date().optional(),
});

export function registerTimelineRoutes(app: FastifyInstance) {
  app.get("/api/timeline", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const referenceDate = parsed.data.date ?? new Date();

    const installments = await prisma.installment.findMany({
      where: { status: { in: ["open", "planned"] } },
      include: { delivery: true },
    });

    const funders = await loadAllocFunders();
    const allocInstallments: AllocInstallment[] = installments.map((i) => ({
      id: i.id,
      cnpjSacado: i.delivery.cnpjSacado,
      valorFace: Number(i.valorFace),
      dataVencimento: i.dataVencimento,
    }));
    const results = allocate(allocInstallments, funders, referenceDate);
    const resultById = new Map(results.map((r) => [r.installmentId, r]));

    // Pivot: cliente -> delivery (PO) -> month.
    const months = new Set<string>();
    const clients = new Map<
      string,
      {
        cliente: string;
        cnpjSacado: string;
        pos: Map<string, { deliveryId: string; produto: string; cells: Map<string, { value: number; verdict: Verdict }> }>;
      }
    >();

    for (const inst of installments) {
      const result = resultById.get(inst.id);
      if (!result) continue;
      const month = monthKey(inst.dataVencimento);
      months.add(month);

      const clientKey = inst.delivery.cnpjSacado;
      if (!clients.has(clientKey)) {
        clients.set(clientKey, { cliente: inst.delivery.cliente, cnpjSacado: clientKey, pos: new Map() });
      }
      const client = clients.get(clientKey)!;

      const poKey = inst.deliveryId;
      if (!client.pos.has(poKey)) {
        client.pos.set(poKey, { deliveryId: poKey, produto: inst.delivery.produto, cells: new Map() });
      }
      const po = client.pos.get(poKey)!;

      const face = Number(inst.valorFace);
      const existing = po.cells.get(month);
      po.cells.set(month, {
        value: (existing?.value ?? 0) + face,
        verdict: existing ? worst(existing.verdict, result.verdict) : result.verdict,
      });
    }

    const sortedMonths = [...months].sort();

    const clientRows = [...clients.values()]
      .sort((a, b) => a.cliente.localeCompare(b.cliente))
      .map((client) => {
        const pos = [...client.pos.values()]
          .sort((a, b) => a.produto.localeCompare(b.produto))
          .map((po) => ({
            deliveryId: po.deliveryId,
            produto: po.produto,
            cells: Object.fromEntries(po.cells),
            total: [...po.cells.values()].reduce((sum, c) => sum + c.value, 0),
          }));

        const totals = new Map<string, { value: number; verdict: Verdict }>();
        for (const po of client.pos.values()) {
          for (const [month, cell] of po.cells) {
            const existing = totals.get(month);
            totals.set(month, {
              value: (existing?.value ?? 0) + cell.value,
              verdict: existing ? worst(existing.verdict, cell.verdict) : cell.verdict,
            });
          }
        }

        return {
          cliente: client.cliente,
          cnpjSacado: client.cnpjSacado,
          pos,
          totals: Object.fromEntries(totals),
          total: [...totals.values()].reduce((sum, c) => sum + c.value, 0),
        };
      });

    const totalGreenBeforeFees = results
      .filter((r) => r.verdict === "green")
      .reduce((sum, r) => sum + (allocInstallments.find((i) => i.id === r.installmentId)?.valorFace ?? 0), 0);
    const totalGreenAfterFees = results.filter((r) => r.funderId).reduce((sum, r) => sum + (r.cost?.liquido ?? 0), 0);
    const totalYellowBeforeFees = results
      .filter((r) => r.verdict === "yellow")
      .reduce((sum, r) => sum + (allocInstallments.find((i) => i.id === r.installmentId)?.valorFace ?? 0), 0);
    const totalGreyBeforeFees = results
      .filter((r) => r.verdict === "grey")
      .reduce((sum, r) => sum + (allocInstallments.find((i) => i.id === r.installmentId)?.valorFace ?? 0), 0);

    return {
      referenceDate,
      months: sortedMonths,
      clients: clientRows,
      grandTotals: {
        greenBeforeFees: totalGreenBeforeFees,
        greenAfterFees: totalGreenAfterFees,
        yellowBeforeFees: totalYellowBeforeFees,
        greyBeforeFees: totalGreyBeforeFees,
      },
    };
  });
}
