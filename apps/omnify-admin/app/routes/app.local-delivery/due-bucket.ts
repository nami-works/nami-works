// Five-state due-date bucket helper shared by /app/local-delivery and (future)
// /app/local-delivery-mobile. The states have a strict precedence:
//   failed → overrides everything (order tagged ld_failed-delivery)
//   overdue → due day strictly before today
//   today / tomorrow / later → derived from processedAt + cutoff + promise days

const DAY_MS = 24 * 60 * 60 * 1000;

export type DueBucket = "failed" | "overdue" | "today" | "tomorrow" | "later";

export type DueBucketOrder = {
  id: string;
  processedAt: string | null;
  tags: string[];
};

const getDayIndexInTimeZone = (
  date: Date,
  timeZone: string,
  userLocale: string,
) => {
  const locale = userLocale?.replace("_", "-") || "en-US";
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "0");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "0");
  if (!year || !month || !day) return 0;
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
};

// hourCycle "h23" guarantees midnight = 0, 1 PM = 13 — avoids the "24" edge case.
const getHourInTimeZone = (date: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? Number(hourPart.value) : date.getUTCHours();
};

const getMinuteInTimeZone = (date: Date, timeZone: string): number => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    minute: "numeric",
  });
  const parts = formatter.formatToParts(date);
  const minutePart = parts.find((p) => p.type === "minute");
  return minutePart ? Number(minutePart.value) : date.getUTCMinutes();
};

export type ComputeDueBucketsParams = {
  orders: ReadonlyArray<DueBucketOrder>;
  deliveryPromiseDays: number;
  sameDayHour: number;
  sameDayMinute: number;
  browserTimeZone: string;
  userLocale: string;
  failedDeliveryTag: string;
};

export const computeDueBuckets = ({
  orders,
  deliveryPromiseDays,
  sameDayHour,
  sameDayMinute,
  browserTimeZone,
  userLocale,
  failedDeliveryTag,
}: ComputeDueBucketsParams): Map<string, DueBucket> => {
  const now = new Date();
  const todayDayIndex = getDayIndexInTimeZone(now, browserTimeZone, userLocale);
  const map = new Map<string, DueBucket>();

  orders.forEach((order) => {
    if (order.tags?.includes(failedDeliveryTag)) {
      map.set(order.id, "failed");
      return;
    }

    const processedAt = order.processedAt ? new Date(order.processedAt) : null;
    if (!processedAt || Number.isNaN(processedAt.getTime())) {
      // Unknown placement time → safest bucket is "today".
      map.set(order.id, "today");
      return;
    }

    const orderDayIndex = getDayIndexInTimeZone(
      processedAt,
      browserTimeZone,
      userLocale,
    );
    const orderHour = getHourInTimeZone(processedAt, browserTimeZone);
    const orderMinute = getMinuteInTimeZone(processedAt, browserTimeZone);
    const pastCutoff =
      orderHour > sameDayHour ||
      (orderHour === sameDayHour && orderMinute >= sameDayMinute);
    const cycleDayIndex = pastCutoff ? orderDayIndex + 1 : orderDayIndex;
    const dueDayIndex = cycleDayIndex + (deliveryPromiseDays - 1);

    if (dueDayIndex < todayDayIndex) {
      map.set(order.id, "overdue");
    } else if (dueDayIndex === todayDayIndex) {
      map.set(order.id, "today");
    } else if (dueDayIndex === todayDayIndex + 1) {
      map.set(order.id, "tomorrow");
    } else {
      map.set(order.id, "later");
    }
  });

  return map;
};
