// 2 weeks, confirmed with Lucas 2026-08-12 (supersedes the earlier proposed
// 7-day default). A contacted-but-unconverted customer is only eligible to
// reappear on a worklist once this many days have passed since contactedAt.
export const COOLDOWN_DAYS = 14;

export function cooldownExpired(contactedAt: Date, now: Date): boolean {
  const elapsedMs = now.getTime() - contactedAt.getTime();
  return elapsedMs >= COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}
