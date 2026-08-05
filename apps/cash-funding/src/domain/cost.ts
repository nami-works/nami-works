// Net-value (cost of discounting) formula — see handoff "Net-value per
// installment". All money in/out as plain numbers (reais); callers convert
// Prisma Decimals before calling.

export type FunderParams = {
  taxaAmPct: number; // e.g. 1.72 = 1.72% a.m.
  iofDiarioPct: number; // % per day
  iofFixoPct: number; // % flat
  tarifaTitulo: number; // flat R$ per installment
  tenorMaxDias: number;
};

export type CostBreakdown = {
  dias: number;
  juros: number;
  iof: number;
  tarifa: number;
  custo: number;
  liquido: number;
  excedeTenor: boolean;
  descontoAposVencimento: boolean;
};

export function computeCost(
  faceValue: number,
  dueDate: Date,
  discountDate: Date,
  funder: FunderParams,
): CostBreakdown {
  const msPerDay = 24 * 60 * 60 * 1000;
  const dias = Math.round(
    (Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()) -
      Date.UTC(
        discountDate.getUTCFullYear(),
        discountDate.getUTCMonth(),
        discountDate.getUTCDate(),
      )) /
      msPerDay,
  );
  const juros = faceValue * (funder.taxaAmPct / 100 / 30) * dias;
  const iof =
    faceValue * ((funder.iofDiarioPct / 100) * dias + funder.iofFixoPct / 100);
  const tarifa = funder.tarifaTitulo;
  const custo = juros + iof + tarifa;
  const liquido = faceValue - custo;
  return {
    dias,
    juros,
    iof,
    tarifa,
    custo,
    liquido,
    excedeTenor: dias > funder.tenorMaxDias,
    descontoAposVencimento: dias < 0,
  };
}
