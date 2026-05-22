// Exponential backoff schedule for failed webhook deliveries.
// Index = attempt count BEFORE the current retry (so attempt 0 = first try,
// no wait; attempt 1 = first retry, 1m wait; etc.). After exhausting the
// schedule the delivery is marked `failed`.
const SCHEDULE_SECONDS: readonly number[] = [
  0,
  60,
  300,
  1800,
  7200,
  28800,
  86400,
] as const;

export const MAX_ATTEMPTS = SCHEDULE_SECONDS.length;

export function isReadyToAttempt(args: {
  attempts: number;
  lastAttemptAt: Date | null;
  now?: Date;
}): boolean {
  if (args.attempts >= MAX_ATTEMPTS) return false;
  if (args.attempts === 0) return true;
  if (!args.lastAttemptAt) return true;
  const waitSeconds = SCHEDULE_SECONDS[args.attempts] ?? 86400;
  const now = args.now ?? new Date();
  const elapsedMs = now.getTime() - args.lastAttemptAt.getTime();
  return elapsedMs >= waitSeconds * 1000;
}

export function isExhausted(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}
