import { describe, expect, it } from "vitest";
import { COOLDOWN_DAYS, cooldownExpired } from "../cooldown.js";

describe("cooldownExpired", () => {
  const contactedAt = new Date("2026-08-01T00:00:00Z");

  it("is not expired immediately after contact", () => {
    expect(cooldownExpired(contactedAt, contactedAt)).toBe(false);
  });

  it("is not expired one day before the boundary", () => {
    const now = new Date(contactedAt.getTime() + (COOLDOWN_DAYS - 1) * 24 * 60 * 60 * 1000);
    expect(cooldownExpired(contactedAt, now)).toBe(false);
  });

  it("is expired exactly at the boundary (>=, not >)", () => {
    const now = new Date(contactedAt.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
    expect(cooldownExpired(contactedAt, now)).toBe(true);
  });

  it("is expired well past the boundary", () => {
    const now = new Date(contactedAt.getTime() + (COOLDOWN_DAYS + 30) * 24 * 60 * 60 * 1000);
    expect(cooldownExpired(contactedAt, now)).toBe(true);
  });
});
