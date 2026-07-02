import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrincipalRole } from "@prisma/client-connector";
import { type TenantLookup } from "../auth/tenant-auth.js";
import { prisma as defaultPrisma } from "../db/prisma.js";
import { issueCode } from "./codes.js";
import { CONSENT_FONT_INTER_WOFF2, CONSENT_LOGO_HOLO } from "./consent-assets.js";
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

// Google's four-color "G" mark — placed in a white chip on the sign-in button so
// the control reads as the standard Google login (the holographic gradient stays
// as the button background; per Lucas it drives more clicks).
const GOOGLE_G_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

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
  const client = escapeHtml(args.clientName ?? "o aplicativo");
  const googleHref =
    "/oauth/google/start?client_id=" +
    encodeURIComponent(args.clientId) +
    "&redirect_uri=" +
    encodeURIComponent(args.redirectUri) +
    "&code_challenge=" +
    encodeURIComponent(args.codeChallenge) +
    "&state=" +
    encodeURIComponent(args.state) +
    "&tenant=" +
    encodeURIComponent(args.tenantSlug);
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Autorizar ${client} · GE Beauty</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url(${CONSENT_FONT_INTER_WOFF2}) format("woff2");}
    @keyframes holo{0%{background-position:100% 0;}100%{background-position:-100% 0;}}
    :root{--ink:#1A1A18;--sub:#5A5A57;--faint:#8F8C85;--danger:#C0392B;--page:#ECEDE9;--card:#FFFFFF;--line:#DAD8D1;}
    *{box-sizing:border-box;}
    body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Inter","Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--page);color:var(--ink);min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:32px 16px;-webkit-font-smoothing:antialiased;}
    .card{position:relative;width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:38px 36px 30px;overflow:hidden;box-shadow:0 12px 40px -18px rgba(31,30,28,.28);}
    .brandbar{position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#5ecece,#b09fda,#d4a8d4,#5ecece);background-size:200% 100%;animation:holo 3.6s linear infinite;}
    .logo{display:block;width:104px;height:104px;object-fit:cover;margin:4px auto 24px;border-radius:20px;box-shadow:4px -4px 11px -4px rgba(31,30,28,.18),11px -11px 30px -10px rgba(31,30,28,.13);}
    h1{font-weight:700;font-size:23px;letter-spacing:-.01em;margin:0 0 12px;}
    .lead{font-weight:500;font-size:14.5px;line-height:1.55;color:var(--sub);margin:0 0 22px;}
    .lead strong{color:var(--ink);font-weight:700;}
    .error{background:#FCE9E7;color:#9F1D1D;border-left:3px solid var(--danger);padding:10px 13px;border-radius:8px;font-size:13px;font-weight:500;line-height:1.4;margin:0 0 20px;}
    .footer{margin-top:24px;text-align:center;font-size:12px;color:#A9A69F;font-weight:500;letter-spacing:.02em;}
    .gbtn{display:flex;align-items:center;justify-content:center;gap:11px;width:100%;margin-top:4px;padding:12px;text-decoration:none;font-weight:700;font-size:15px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.32);background:linear-gradient(100deg,#5ecece,#b09fda,#d4a8d4);border-radius:10px;transition:filter .12s;}
    .gbtn:hover{filter:saturate(1.08) brightness(1.03);}
    .gchip{display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:28px;height:28px;background:#fff;border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.2);}
    .gchip svg{display:block;width:17px;height:17px;}
  </style>
</head>
<body>
  <div class="card">
    <div class="brandbar"></div>
    <img class="logo" alt="GE Beauty" src="${CONSENT_LOGO_HOLO}">
    <h1>Autorizar acesso</h1>
    <p class="lead">Entre com sua conta Google para conectar o <strong>${client}</strong> à central de inteligência da GE&nbsp;Beauty.</p>
    ${error}
    <a class="gbtn" href="${googleHref}"><span class="gchip">${GOOGLE_G_SVG}</span><span>Entrar com Google</span></a>
    <div class="footer">GE&nbsp;Beauty · Acesso interno</div>
  </div>
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
      process.env.DEFAULT_TENANT ?? // single-tenant: bare URL resolves here
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

    // Resolve the pasted bearer to a principal (per-user) or the legacy
    // tenant-level owner bearer. This sets the role + identity that will ride
    // the issued access token.
    const db = deps.prisma ?? defaultPrisma;
    const presentedHash = createHash("sha256").update(bearer).digest("hex");

    let resolved:
      | {
          tenantSlug: string;
          role: PrincipalRole;
          principalId?: string;
          actorLabel?: string;
        }
      | null = null;

    try {
      // Per-principal bearer first (the current model).
      if (db.tenantPrincipal) {
        const p = await db.tenantPrincipal.findUnique({
          where: { bearerTokenHash: presentedHash },
          include: { tenant: true },
        });
        if (
          p &&
          p.status === "active" &&
          p.tenant.slug === tenantSlug &&
          p.tenant.status === "active"
        ) {
          resolved = {
            tenantSlug: p.tenant.slug,
            role: p.role,
            principalId: p.id,
            actorLabel: p.label,
          };
        }
      }

      // Legacy tenant-level owner bearer. Constant-time compare with a decoy
      // hash so latency doesn't leak whether the tenant/bearer exists.
      if (!resolved) {
        const row = await db.integrationTenant.findUnique({
          where: { slug: tenantSlug },
        });
        const storedHash =
          row && row.status === "active"
            ? row.bearerTokenHash
            : SHA256_DUMMY_HEX;
        const a = Buffer.from(presentedHash, "hex");
        const b = Buffer.from(storedHash, "hex");
        if (row && a.length === b.length && timingSafeEqual(a, b)) {
          resolved = { tenantSlug: row.slug, role: "owner" };
        }
      }
    } catch {
      return reply
        .code(503)
        .type("text/html")
        .send(renderError("Auth backend unavailable. Retry shortly."));
    }

    if (!resolved) {
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
      tenantSlug: resolved.tenantSlug,
      ...(resolved.principalId ? { principalId: resolved.principalId } : {}),
      role: resolved.role,
      ...(resolved.actorLabel ? { actorLabel: resolved.actorLabel } : {}),
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
