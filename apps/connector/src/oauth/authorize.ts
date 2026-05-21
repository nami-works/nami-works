import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  type TenantLookup,
  type TenantContext,
} from "../auth/tenant-auth.js";
import { prisma as defaultPrisma } from "../db/prisma.js";
import { issueCode } from "./codes.js";
import { verifyClientId } from "./jwt.js";

/**
 * GET /oauth/authorize — render an HTML consent page.
 * POST /oauth/authorize — verify the consent bearer, issue auth code, redirect.
 *
 * Flow:
 *   1. Claude.ai redirects the user to this URL with OAuth params.
 *   2. The page renders a form asking the operator to paste the tenant bearer.
 *   3. On submit, we verify the bearer against the tenant's stored hash
 *      (constant-time, same as the existing tenant-auth flow).
 *   4. On success, we mint a one-time auth code and redirect back to claude.ai.
 *
 * Tenant scope comes from a `tenant` query param. The MCP host (claude.ai)
 * derives this from the resource URL it's connecting to (e.g. mcp.nami.works/gebeauty
 * → tenant=gebeauty). For now, the operator enters it on the form alongside
 * the bearer.
 */

const SHA256_DUMMY_HEX = createHash("sha256")
  .update("\0".repeat(64))
  .digest("hex");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderConsent(args: {
  clientName?: string;
  tenantSlug: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  clientId: string;
  errorMessage?: string;
}): string {
  const error = args.errorMessage
    ? `<div class="error">${escapeHtml(args.errorMessage)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Authorize ${escapeHtml(args.clientName ?? "MCP client")} — NAMI Works</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, system-ui, Segoe UI, sans-serif; background: #f7f7f5; margin: 0; padding: 0; color: #222; }
    .card { max-width: 520px; margin: 8vh auto; background: #fff; padding: 36px 40px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    h1 { font-size: 22px; margin: 0 0 12px; }
    p  { color: #555; line-height: 1.5; margin: 0 0 18px; font-size: 14px; }
    .tenant { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f0efeb; padding: 2px 8px; border-radius: 4px; }
    label { display: block; font-size: 13px; color: #444; margin-bottom: 6px; font-weight: 500; }
    input[type=password], input[type=text] { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 14px; border: 1px solid #d4d3cf; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    button { margin-top: 18px; width: 100%; padding: 11px; font-size: 14px; font-weight: 500; border: 0; border-radius: 6px; background: #1f1e1c; color: #fff; cursor: pointer; }
    button:hover { background: #000; }
    .error { background: #fde8e8; color: #9f1d1d; padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
    .footer { margin-top: 22px; color: #888; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/oauth/authorize">
    <h1>Authorize ${escapeHtml(args.clientName ?? "MCP client")}</h1>
    <p>Grant access to NAMI Works tenant <span class="tenant">${escapeHtml(args.tenantSlug)}</span>. Paste the tenant bearer issued by <code>provision-tenant</code> to continue.</p>
    ${error}
    <label for="bearer">Tenant bearer</label>
    <input id="bearer" name="bearer" type="password" autocomplete="off" autofocus required>
    <input type="hidden" name="tenant" value="${escapeHtml(args.tenantSlug)}">
    <input type="hidden" name="client_id" value="${escapeHtml(args.clientId)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(args.redirectUri)}">
    <input type="hidden" name="state" value="${escapeHtml(args.state)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(args.codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(args.codeChallengeMethod)}">
    <button type="submit">Authorize</button>
    <div class="footer">NAMI Works · mcp.nami.works</div>
  </form>
</body>
</html>`;
}

function renderError(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Authorization error</title>
<style>body{font-family:system-ui,sans-serif;padding:40px;max-width:520px;margin:0 auto;color:#222}h1{font-size:18px}p{color:#555;line-height:1.5}</style>
</head><body><h1>Authorization error</h1><p>${escapeHtml(message)}</p></body></html>`;
}

export type AuthorizeDeps = {
  prisma?: TenantLookup;
};

function deriveTenantFromResource(resource: string | undefined): string | null {
  if (!resource) return null;
  try {
    const url = new URL(resource);
    const slug = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!/^[a-z0-9-]+$/.test(slug)) return null;
    return slug;
  } catch {
    return null;
  }
}

export function mountOAuthAuthorize(
  app: FastifyInstance,
  deps: AuthorizeDeps = {},
): void {
  app.get("/oauth/authorize", async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const clientId = q.client_id;
    const redirectUri = q.redirect_uri;
    const responseType = q.response_type ?? "code";
    const state = q.state ?? "";
    const codeChallenge = q.code_challenge;
    const codeChallengeMethod = q.code_challenge_method ?? "S256";
    const tenantSlug =
      q.tenant ??
      deriveTenantFromResource(q.resource) ??
      undefined;

    if (!clientId || !redirectUri || !codeChallenge) {
      return reply
        .code(400)
        .type("text/html")
        .send(
          renderError(
            "Missing required OAuth parameters (client_id, redirect_uri, code_challenge).",
          ),
        );
    }
    if (responseType !== "code") {
      return reply
        .code(400)
        .type("text/html")
        .send(renderError(`Unsupported response_type: ${responseType}.`));
    }
    if (codeChallengeMethod !== "S256") {
      return reply
        .code(400)
        .type("text/html")
        .send(
          renderError(
            "Only the S256 code_challenge_method is supported.",
          ),
        );
    }
    if (!tenantSlug || !/^[a-z0-9-]+$/.test(tenantSlug)) {
      return reply
        .code(400)
        .type("text/html")
        .send(
          renderError(
            "Missing or invalid tenant. Append ?tenant=<slug> to the authorize URL, or include resource=https://mcp.nami.works/<slug>.",
          ),
        );
    }

    const client = await verifyClientId(clientId);
    if (!client) {
      return reply
        .code(400)
        .type("text/html")
        .send(
          renderError(
            "Unknown or invalid client_id. Re-register at /oauth/register.",
          ),
        );
    }
    if (!client.redirect_uris.includes(redirectUri)) {
      return reply
        .code(400)
        .type("text/html")
        .send(
          renderError(
            "redirect_uri does not match any registered URI for this client.",
          ),
        );
    }

    return reply
      .code(200)
      .type("text/html")
      .send(
        renderConsent({
          ...(client.client_name !== undefined
            ? { clientName: client.client_name }
            : {}),
          tenantSlug,
          redirectUri,
          state,
          codeChallenge,
          codeChallengeMethod,
          clientId,
        }),
      );
  });

  app.post("/oauth/authorize", async (request, reply) => {
    const body = request.body as Record<string, string | undefined>;
    const tenantSlug = body.tenant;
    const bearer = body.bearer;
    const clientId = body.client_id;
    const redirectUri = body.redirect_uri;
    const state = body.state ?? "";
    const codeChallenge = body.code_challenge;
    const codeChallengeMethod = body.code_challenge_method ?? "S256";

    if (
      !tenantSlug ||
      !bearer ||
      !clientId ||
      !redirectUri ||
      !codeChallenge ||
      codeChallengeMethod !== "S256"
    ) {
      return reply
        .code(400)
        .type("text/html")
        .send(
          renderError("Missing required form fields. Restart authorization."),
        );
    }

    const client = await verifyClientId(clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) {
      return reply
        .code(400)
        .type("text/html")
        .send(renderError("Invalid client_id or redirect_uri."));
    }

    // Verify the consent bearer against the tenant row (constant-time).
    const db = deps.prisma ?? defaultPrisma;
    let tenant: TenantContext | null = null;
    let storedHash = SHA256_DUMMY_HEX;
    try {
      const row = await db.integrationTenant.findUnique({
        where: { slug: tenantSlug },
      });
      if (row) {
        tenant = {
          id: row.id,
          slug: row.slug,
          displayName: row.displayName,
          brand: row.brand,
          shopifyShop: row.shopifyShop,
          ssmPrefix: row.ssmPrefix,
        };
        if (row.status === "active") {
          storedHash = row.bearerTokenHash;
        }
      }
    } catch {
      return reply
        .code(503)
        .type("text/html")
        .send(renderError("Auth backend unavailable. Retry shortly."));
    }

    const presentedHash = createHash("sha256").update(bearer).digest("hex");
    const a = Buffer.from(presentedHash, "hex");
    const b = Buffer.from(storedHash, "hex");
    const ok =
      a.length === b.length && timingSafeEqual(a, b) && tenant !== null;

    if (!ok) {
      return reply
        .code(401)
        .type("text/html")
        .send(
          renderConsent({
            ...(client.client_name !== undefined
              ? { clientName: client.client_name }
              : {}),
            tenantSlug,
            redirectUri,
            state,
            codeChallenge,
            codeChallengeMethod,
            clientId,
            errorMessage:
              "Bearer did not match this tenant. Check the value and try again.",
          }),
        );
    }

    const code = issueCode({
      tenantSlug,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: "S256",
    });

    const url = new URL(redirectUri);
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    return reply.code(302).redirect(url.toString());
  });
}
