import { describe, expect, it } from "vitest";
import {
  isExhausted,
  isReadyToAttempt,
  MAX_ATTEMPTS,
} from "../src/webhooks/backoff.js";

describe("backoff schedule", () => {
  it("first attempt fires immediately", () => {
    expect(
      isReadyToAttempt({ attempts: 0, lastAttemptAt: null }),
    ).toBe(true);
  });

  it("waits 60s before the second attempt", () => {
    const now = new Date(2026, 5, 1, 12, 0, 0);
    const lastAttempt = new Date(now.getTime() - 30_000); // 30s ago
    expect(
      isReadyToAttempt({ attempts: 1, lastAttemptAt: lastAttempt, now }),
    ).toBe(false);
    const enoughAgo = new Date(now.getTime() - 60_000);
    expect(
      isReadyToAttempt({ attempts: 1, lastAttemptAt: enoughAgo, now }),
    ).toBe(true);
  });

  it("waits 24h before the last attempt", () => {
    const now = new Date(2026, 5, 1, 12, 0, 0);
    const oneDayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
    expect(
      isReadyToAttempt({
        attempts: MAX_ATTEMPTS - 1,
        lastAttemptAt: oneDayAgo,
        now,
      }),
    ).toBe(true);
  });

  it("exhausts after MAX_ATTEMPTS", () => {
    expect(isExhausted(MAX_ATTEMPTS)).toBe(true);
    expect(isExhausted(MAX_ATTEMPTS - 1)).toBe(false);
    expect(
      isReadyToAttempt({
        attempts: MAX_ATTEMPTS,
        lastAttemptAt: new Date(0),
      }),
    ).toBe(false);
  });
});
