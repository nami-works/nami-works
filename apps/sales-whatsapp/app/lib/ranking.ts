// Ranking is deliberately behind a pinned, swappable interface — per the
// senior-eng review (2026-08-12): "the row shape/repor-descobrir/wa.me/event
// log stay stable only if the ranking function's interface was designed to
// accept the SRBP shape from day one." This is that interface. The MVP
// implementation (rankByExpiryAndValue) is interim; Prevention Nudge's SRBP
// cascade becomes a second implementation of the same RankFn signature, not
// a rewrite of the query layer around it.

export type Candidate = {
  customerGid: string;
  creditBalance: number;
  creditExpiresAt: string; // ISO date
};

export type RankedCandidate = Candidate & { rank: number };

export type RankFn = (candidates: Candidate[], now: Date) => RankedCandidate[];

// Interim MVP signal: soonest-expiring first, then highest balance as the
// tiebreak. Same priority the Excel process already used — not a new
// invention, just re-hosted.
// `now` is part of the RankFn contract (a future SRBP-based implementation
// needs "as of when" for its timing math); this interim implementation
// doesn't need it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const rankByExpiryAndValue: RankFn = (candidates, now) => {
  const sorted = [...candidates].sort((a, b) => {
    const expiryDiff = new Date(a.creditExpiresAt).getTime() - new Date(b.creditExpiresAt).getTime();
    if (expiryDiff !== 0) return expiryDiff;
    return b.creditBalance - a.creditBalance;
  });
  return sorted.map((c, i) => ({ ...c, rank: i + 1 }));
};

export function daysUntil(isoDate: string, now: Date): number {
  const ms = new Date(isoDate).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}
