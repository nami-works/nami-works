import { describe, expect, it } from "vitest";
import { grantedLocationsForSession, repEmailFromSession, UnauthorizedLocationError } from "../auth.js";

function mockSession(email: string | undefined) {
  return {
    onlineAccessInfo: email ? { associated_user: { email } } : undefined,
  } as never;
}

describe("repEmailFromSession", () => {
  it("resolves and lowercases the associated user's email", () => {
    expect(repEmailFromSession(mockSession("Geb007@GEBeauty.com.br"))).toBe("geb007@gebeauty.com.br");
  });

  it("throws UnauthorizedLocationError if there's no associated user (offline token, misconfiguration)", () => {
    expect(() => repEmailFromSession(mockSession(undefined))).toThrow(UnauthorizedLocationError);
  });
});

describe("grantedLocationsForSession", () => {
  it("returns the granted location(s) for a known rep email", () => {
    const locations = grantedLocationsForSession(mockSession("geb007@gebeauty.com.br"));
    expect(locations.map((l) => l.key)).toEqual(["riosul"]);
  });

  it("is case-insensitive on the grant lookup", () => {
    const locations = grantedLocationsForSession(mockSession("GEB007@GEBEAUTY.COM.BR"));
    expect(locations.map((l) => l.key)).toEqual(["riosul"]);
  });

  it("throws UnauthorizedLocationError for an email with no grant", () => {
    expect(() => grantedLocationsForSession(mockSession("not-a-rep@gebeauty.com.br"))).toThrow(
      UnauthorizedLocationError,
    );
  });
});
