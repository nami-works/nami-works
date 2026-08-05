import { computeDueDates, type Calendar } from "./dates.js";

export type DeliveryFields = {
  total: number;
  numParcelas: number;
  firstOffsetDias: number;
  intervalDias: number;
  calendar: Calendar;
  dataEntrega: Date;
};

/** Splits total evenly across numParcelas; the last installment absorbs any
 * rounding remainder so the sum always equals `total` exactly. */
export function generateInstallmentValues(d: DeliveryFields): { numero: number; valorFace: number; dataVencimento: Date }[] {
  const dues = computeDueDates(d.calendar, d.dataEntrega, d.firstOffsetDias, d.intervalDias, d.numParcelas);
  const base = Math.round((d.total / d.numParcelas) * 100) / 100;
  const rows = dues.map((due, i) => ({
    numero: i + 1,
    valorFace: i === d.numParcelas - 1 ? Math.round((d.total - base * (d.numParcelas - 1)) * 100) / 100 : base,
    dataVencimento: due,
  }));
  return rows;
}
