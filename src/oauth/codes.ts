import { randomBytes } from "node:crypto";

/**
 * Short-lived OAuth authorization code store. One-time use, 10-minute TTL.
 * In-memory because:
 *   - codes are valid for ~10 min,
 *   - a container restart between code issuance and token exchange just
 *     means the user retries the consent flow,
 *   - no horizontal scaling concern at this stage (desiredCount=1).
 *
 * If we ever scale ECS to >1 replica, swap this for Redis or RDS.
 */

export type AuthCodeRecord = {
  tenantSlug: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: number;
};

const TTL_MS = 10 * 60 * 1000;

const store = new Map<string, AuthCodeRecord>();

function gcExpired(now: number): void {
  for (const [code, record] of store) {
    if (record.expiresAt <= now) store.delete(code);
  }
}

export function issueCode(args: Omit<AuthCodeRecord, "expiresAt">): string {
  const now = Date.now();
  gcExpired(now);
  const code = randomBytes(32).toString("base64url");
  store.set(code, { ...args, expiresAt: now + TTL_MS });
  return code;
}

export function consumeCode(code: string): AuthCodeRecord | null {
  const now = Date.now();
  gcExpired(now);
  const record = store.get(code);
  if (!record) return null;
  store.delete(code); // one-time use
  if (record.expiresAt <= now) return null;
  return record;
}

export function __clearCodesForTesting(): void {
  store.clear();
}
