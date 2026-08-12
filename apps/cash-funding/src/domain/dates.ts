// Due-date calculators for the two payment calendars in use.
// Reproduces the reference algorithm verified against the spreadsheet model —
// see docs/handoff-cash-funding-webapp.md "Due-date calculation".

export type Calendar = "corrido" | "terca_3_25";

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function firstOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** Corrido: due(n) = delivery + first_offset + (n-1)*interval. */
export function dueDateCorrido(
  delivery: Date,
  firstOffsetDias: number,
  intervalDias: number,
  n: number,
): Date {
  return addDays(delivery, firstOffsetDias + (n - 1) * intervalDias);
}

/**
 * Snap a nominal date to the next valid "Terça 3-25" date: the first Tuesday
 * on/after `nominal` whose day-of-month falls in [3, 25]. If that Tuesday's
 * day > 25, roll to the first Tuesday of the next month (which is always
 * >= 3, since a month's 1st-7th always contains a Tuesday day <= 7... but we
 * still loop in case that Tuesday itself lands < 3, mirroring the reference
 * algorithm exactly).
 */
export function nextValidTuesday(nominal: Date): Date {
  let d = new Date(nominal);
  while (d.getUTCDay() !== 2) d = addDays(d, 1); // Sun=0..Sat=6, Tue=2
  while (!(d.getUTCDate() >= 3 && d.getUTCDate() <= 25)) {
    if (d.getUTCDate() < 3) {
      d = addDays(d, 7);
    } else {
      d = firstOfNextMonth(d);
      while (d.getUTCDay() !== 2) d = addDays(d, 1);
    }
  }
  return d;
}

/**
 * Terça 3-25, chained: nominal(1) = delivery + first_offset; nominal(n) =
 * due(n-1) + interval (chained off the previous SNAPPED due date). Returns
 * due dates 1..numParcelas.
 */
export function dueDatesTerca325(
  delivery: Date,
  firstOffsetDias: number,
  intervalDias: number,
  numParcelas: number,
): Date[] {
  const dues: Date[] = [];
  let prevDue: Date | null = null;
  for (let n = 1; n <= numParcelas; n++) {
    const nominal = prevDue
      ? addDays(prevDue, intervalDias)
      : addDays(delivery, firstOffsetDias);
    const due = nextValidTuesday(nominal);
    dues.push(due);
    prevDue = due;
  }
  return dues;
}

export function computeDueDates(
  calendar: Calendar,
  delivery: Date,
  firstOffsetDias: number,
  intervalDias: number,
  numParcelas: number,
): Date[] {
  if (calendar === "corrido") {
    return Array.from({ length: numParcelas }, (_, i) =>
      dueDateCorrido(delivery, firstOffsetDias, intervalDias, i + 1),
    );
  }
  return dueDatesTerca325(delivery, firstOffsetDias, intervalDias, numParcelas);
}
