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
  sub: string; // tenant:<slug>
  tenant: string;
  iat: number;
  exp: number;
};

export async function signAccessToken(args: {
  tenantSlug: string;
  ttlSeconds?: number;
}): Promise<string> {
  const ttl = args.ttlSeconds ?? 60 * 60 * 24; // 24h
  return await new SignJWT({ tenant: args.tenantSlug })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setSubject(`tenant:${args.tenantSlug}`)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(getSigningKey());
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: ISSUER,
    });
    if (typeof payload.tenant !== "string" || payload.tenant.length === 0) {
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
