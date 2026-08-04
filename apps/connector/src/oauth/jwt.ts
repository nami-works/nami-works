import type { PrincipalRole } from "@prisma/client-connector";
import { SignJWT, jwtVerify } from "jose";

/**
 * OAuth signing key. In prod, sourced from SSM via the OAUTH_SIGNING_KEY env
 * var (set by the ECS task definition). In dev/tests, generate a stable
 * per-process key so the gateway boots without ceremony — this is fine
 * because dev tokens never need to survive a restart.
 */
let cachedKey: Uint8Array | undefined;

function getSigningKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const raw = process.env.OAUTH_SIGNING_KEY;
  if (raw && raw.length > 0) {
    cachedKey = new TextEncoder().encode(raw);
    return cachedKey;
  }
  // Dev fallback. NOT for production.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "OAUTH_SIGNING_KEY env var is required in production. " +
        "Source it from SSM /nami-works/app/oauth_signing_key via the ECS task secrets block.",
    );
  }
  cachedKey = crypto.getRandomValues(new Uint8Array(64));
  return cachedKey;
}

export function __resetSigningKeyForTesting(value?: string): void {
  if (value === undefined) {
    cachedKey = undefined;
    return;
  }
  cachedKey = new TextEncoder().encode(value);
}

const ISSUER = process.env.OAUTH_ISSUER ?? "https://mcp.nami.works";

// ---- Access token: bound to a tenant slug, used for MCP requests ----

export type AccessTokenClaims = {
  iss: string;
  sub: string; // principal:<id> when per-user, else tenant:<slug>
  tenant: string;
  role?: PrincipalRole;
  pid?: string; // principal id — re-resolved live on each request
  label?: string;
  use?: "access"; // absent on tokens issued before the refresh-token rollout
  iat: number;
  exp: number;
};

// Shared by signAccessToken and signRefreshToken — same claim shape, only
// `use` and the TTL differ, so callers can't cross-present one as the other.
function accessClaimsPayload(args: {
  tenantSlug: string;
  role?: PrincipalRole;
  principalId?: string;
  actorLabel?: string | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { tenant: args.tenantSlug };
  if (args.role) payload.role = args.role;
  if (args.principalId) payload.pid = args.principalId;
  if (args.actorLabel) payload.label = args.actorLabel;
  return payload;
}

export async function signAccessToken(args: {
  tenantSlug: string;
  role?: PrincipalRole;
  principalId?: string;
  actorLabel?: string | null;
  ttlSeconds?: number;
}): Promise<string> {
  const ttl = args.ttlSeconds ?? 60 * 60 * 24; // 24h
  return await new SignJWT({ ...accessClaimsPayload(args), use: "access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(
      args.principalId
        ? `principal:${args.principalId}`
        : `tenant:${args.tenantSlug}`,
    )
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getSigningKey());
}

// ---- Refresh token: long-lived, exchanged at /oauth/token for a fresh
// access token once the 24h access token expires. Same tenant/principal
// claims as the access token plus `use: "refresh"` so one can never be
// presented as the other. ----

export type RefreshTokenClaims = {
  tenant: string;
  role?: PrincipalRole;
  pid?: string;
  label?: string;
};

export async function signRefreshToken(args: {
  tenantSlug: string;
  role?: PrincipalRole;
  principalId?: string;
  actorLabel?: string | null;
  ttlSeconds?: number;
}): Promise<string> {
  const ttl = args.ttlSeconds ?? 60 * 60 * 24 * 30; // 30d
  return await new SignJWT({ ...accessClaimsPayload(args), use: "refresh" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(
      args.principalId
        ? `principal:${args.principalId}`
        : `tenant:${args.tenantSlug}`,
    )
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getSigningKey());
}

export async function verifyRefreshToken(
  token: string,
): Promise<RefreshTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: ISSUER,
    });
    if (
      payload.use !== "refresh" ||
      typeof payload.tenant !== "string" ||
      payload.tenant.length === 0
    ) {
      return null;
    }
    return payload as unknown as RefreshTokenClaims;
  } catch {
    return null;
  }
}

// ---- Google-login state: a short-lived signed blob that carries the MCP OAuth
// params across the redirect to Google and back, so the callback can resume the
// connector's own authorization-code flow. Signed with the same key. ----

export type GoogleStateClaims = {
  tenant: string;
  clientId: string;
  redirectUri: string;
  mcpState: string;
  codeChallenge: string;
  nonce: string;
};

export async function signGoogleState(s: GoogleStateClaims): Promise<string> {
  return await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject("google-state")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getSigningKey());
}

export async function verifyGoogleState(
  token: string,
): Promise<GoogleStateClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: ISSUER,
      subject: "google-state",
    });
    const { tenant, clientId, redirectUri, mcpState, codeChallenge, nonce } =
      payload as Record<string, unknown>;
    if (
      typeof tenant !== "string" ||
      typeof clientId !== "string" ||
      typeof redirectUri !== "string" ||
      typeof codeChallenge !== "string" ||
      typeof nonce !== "string"
    ) {
      return null;
    }
    return {
      tenant,
      clientId,
      redirectUri,
      mcpState: typeof mcpState === "string" ? mcpState : "",
      codeChallenge,
      nonce,
    };
  } catch {
    return null;
  }
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: ISSUER,
    });
    if (
      payload.use === "refresh" ||
      typeof payload.tenant !== "string" ||
      payload.tenant.length === 0
    ) {
      return null;
    }
    return payload as unknown as AccessTokenClaims;
  } catch {
    return null;
  }
}

// ---- Client ID: a JWT containing dynamic-registration metadata ----
// We store no client table — the client_id IS the metadata, signature-protected.

export type ClientMetadata = {
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: "none";
};

export type ClientIdClaims = {
  iss: string;
  sub: "client";
  client: ClientMetadata;
  iat: number;
};

export async function signClientId(metadata: ClientMetadata): Promise<string> {
  return await new SignJWT({ client: metadata })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject("client")
    .setIssuedAt()
    .sign(getSigningKey());
}

export async function verifyClientId(
  clientId: string,
): Promise<ClientMetadata | null> {
  try {
    const { payload } = await jwtVerify(clientId, getSigningKey(), {
      issuer: ISSUER,
      subject: "client",
    });
    const client = payload.client as ClientMetadata | undefined;
    if (!client || !Array.isArray(client.redirect_uris)) return null;
    return client;
  } catch {
    return null;
  }
}
