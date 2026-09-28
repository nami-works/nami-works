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

  it("grants full access to a non-geb00 email, not just known reps", () => {
    const locations = grantedLocationsForSession(mockSession("not-a-rep@gebeauty.com.br"));
    expect(locations.map((l) => l.key).sort()).toEqual(
      ["riomar-recife", "riosul", "shopping-recife", "shops-jardins"].sort(),
    );
  });

  it("throws UnauthorizedLocationError for a geb00-pattern email with no specific grant", () => {
    expect(() => grantedLocationsForSession(mockSession("geb009@gebeauty.com.br"))).toThrow(
      UnauthorizedLocationError,
    );
  });
});
