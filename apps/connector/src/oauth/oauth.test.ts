import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  __resetSigningKeyForTesting,
  signAccessToken,
  signClientId,
  verifyAccessToken,
  verifyClientId,
} from "./jwt.js";
import {
  __clearCodesForTesting,
  consumeCode,
  issueCode,
} from "./codes.js";

beforeEach(() => {
  __resetSigningKeyForTesting("test-signing-key-for-vitest-only-12345678");
  __clearCodesForTesting();
});

afterEach(() => {
  __resetSigningKeyForTesting();
  __clearCodesForTesting();
});

describe("oauth/jwt access token", () => {
  it("signs and verifies an access token round-trip", async () => {
    const token = await signAccessToken({ tenantSlug: "gebeauty" });
    const claims = await verifyAccessToken(token);
    expect(claims).not.toBeNull();
    expect(claims?.tenant).toBe("gebeauty");
    expect(claims?.sub).toBe("tenant:gebeauty");
  });

  it("rejects a token with a tampered signature", async () => {
    const token = await signAccessToken({ tenantSlug: "gebeauty" });
    const tampered = token.slice(0, -4) + "AAAA";
    expect(await verifyAccessToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different key", async () => {
    const token = await signAccessToken({ tenantSlug: "gebeauty" });
    __resetSigningKeyForTesting("a-completely-different-key-9999999999999");
    expect(await verifyAccessToken(token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signAccessToken({
      tenantSlug: "gebeauty",
      ttlSeconds: -10, // already expired
    });
    expect(await verifyAccessToken(token)).toBeNull();
  });
});

describe("oauth/jwt client_id", () => {
  it("round-trips client metadata", async () => {
    const id = await signClientId({
      redirect_uris: ["https://claude.ai/callback"],
      client_name: "Claude.ai",
      token_endpoint_auth_method: "none",
    });
    const meta = await verifyClientId(id);
    expect(meta?.redirect_uris).toEqual(["https://claude.ai/callback"]);
    expect(meta?.client_name).toBe("Claude.ai");
  });

  it("returns null for a non-client JWT (e.g. an access token)", async () => {
    const accessToken = await signAccessToken({ tenantSlug: "gebeauty" });
    expect(await verifyClientId(accessToken)).toBeNull();
  });
});

describe("oauth/codes store", () => {
  it("issues and consumes a one-time code", () => {
    const code = issueCode({
      tenantSlug: "gebeauty",
      clientId: "client-abc",
      redirectUri: "https://claude.ai/callback",
      codeChallenge: "abcdef",
      codeChallengeMethod: "S256",
    });
    const first = consumeCode(code);
    expect(first?.tenantSlug).toBe("gebeauty");
    // One-time use:
    expect(consumeCode(code)).toBeNull();
  });

  it("returns null for an unknown code", () => {
    expect(consumeCode("not-a-real-code")).toBeNull();
  });
});

describe("PKCE S256 verification", () => {
  // Mirror what /oauth/token does internally.
  function pkceMatches(verifier: string, challenge: string): boolean {
    return createHash("sha256").update(verifier).digest("base64url") === challenge;
  }

  it("matches when challenge = base64url(sha256(verifier))", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(pkceMatches(verifier, challenge)).toBe(true);
  });

  it("rejects a tampered verifier", () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(pkceMatches("wrong-verifier", challenge)).toBe(false);
  });
});
