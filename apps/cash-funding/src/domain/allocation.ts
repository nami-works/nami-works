// Allocation engine — the app's core feature. Greedy: for each open
// installment (sorted by due date, earliest first), assign the cheapest
// funder that's feasible under tenor + per-sacado + line-ceiling
// constraints, updating running usage as it goes. See handoff "Allocation
// engine" for the constraint set.

import { computeCost, type FunderParams } from "./cost.js";

export type AllocFunder = FunderParams & {
  id: string;
  tetoLinha: number;
  perSacadoCap: number | null;
  jaUsado: number; // already committed to this funder (existing operations + already-planned installments not in this run)
};

export type AllocInstallment = {
  id: string;
  cnpjSacado: string;
  valorFace: number;
  dataVencimento: Date;
};

export type Verdict = "green" | "yellow" | "grey";

export type AllocResult = {
  installmentId: string;
  funderId: string | null; // null = no feasible funder found
  discountDate: Date;
  cost?: ReturnType<typeof computeCost>;
  reason?: string; // set when funderId is null
  /** green = fully feasible (fundable now, matches the chosen allocation);
   * yellow = at least one funder's tenor fits but teto/per-sacado cap is
   * exhausted there (at this point in the cumulative processing order);
   * grey = no funder's tenor fits at all (or already past due). */
  verdict: Verdict;
};

export function allocate(
  installments: AllocInstallment[],
  funders: AllocFunder[],
  discountDate: Date,
  cutoffDate?: Date,
): AllocResult[] {
  const usedPerFunder = new Map(funders.map((f) => [f.id, f.jaUsado]));
  const usedPerFunderSacado = new Map<string, number>(); // key: `${funderId}:${cnpjSacado}`

  const eligible = cutoffDate
    ? installments.filter((i) => i.dataVencimento <= cutoffDate)
    : installments;
  const skipped = cutoffDate
    ? installments.filter((i) => i.dataVencimento > cutoffDate)
    : [];

  const sorted = [...eligible].sort(
    (a, b) => a.dataVencimento.getTime() - b.dataVencimento.getTime(),
  );

  const results: AllocResult[] = [];

  for (const inst of sorted) {
    let best: { funder: AllocFunder; cost: ReturnType<typeof computeCost> } | null = null;
    let anyTenorOk = false;

    for (const funder of funders) {
      const cost = computeCost(inst.valorFace, inst.dataVencimento, discountDate, funder);
      if (cost.descontoAposVencimento || cost.excedeTenor) continue;
      anyTenorOk = true;

      const usedFunder = usedPerFunder.get(funder.id) ?? 0;
      if (usedFunder + inst.valorFace > funder.tetoLinha) continue;

      if (funder.perSacadoCap != null) {
        const key = `${funder.id}:${inst.cnpjSacado}`;
        const usedSacado = usedPerFunderSacado.get(key) ?? 0;
        if (usedSacado + inst.valorFace > funder.perSacadoCap) continue;
      }

      if (!best || cost.custo < best.cost.custo) {
        best = { funder, cost };
      }
    }

    if (!best) {
      results.push({
        installmentId: inst.id,
        funderId: null,
        discountDate,
        verdict: anyTenorOk ? "yellow" : "grey",
        reason: anyTenorOk
          ? "Dentro do prazo de ao menos um financiador, mas o limite (teto ou por sacado) já está esgotado"
          : "Fora do prazo de todos os financiadores (ou desconto após o vencimento)",
      });
      continue;
    }

    usedPerFunder.set(best.funder.id, (usedPerFunder.get(best.funder.id) ?? 0) + inst.valorFace);
    if (best.funder.perSacadoCap != null) {
      const key = `${best.funder.id}:${inst.cnpjSacado}`;
      usedPerFunderSacado.set(key, (usedPerFunderSacado.get(key) ?? 0) + inst.valorFace);
    }

    results.push({
      installmentId: inst.id,
      funderId: best.funder.id,
      discountDate,
      cost: best.cost,
      verdict: "green",
    });
  }

  for (const inst of skipped) {
    results.push({
      installmentId: inst.id,
      funderId: null,
      discountDate,
      verdict: "grey",
      reason: "Fora do corte (vencimento após a data de corte)",
    });
  }

  return results;
}

export function funderUtilization(
  funders: AllocFunder[],
  allocations: AllocResult[],
  installmentsById: Map<string, AllocInstallment>,
): { funderId: string; usado: number; teto: number; disponivel: number }[] {
  const usado = new Map(funders.map((f) => [f.id, f.jaUsado]));
  for (const a of allocations) {
    if (!a.funderId) continue;
    const inst = installmentsById.get(a.installmentId);
    if (!inst) continue;
    usado.set(a.funderId, (usado.get(a.funderId) ?? 0) + inst.valorFace);
  }
  return funders.map((f) => ({
    funderId: f.id,
    usado: usado.get(f.id) ?? 0,
    teto: f.tetoLinha,
    disponivel: f.tetoLinha - (usado.get(f.id) ?? 0),
  }));
}
