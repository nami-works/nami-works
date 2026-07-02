import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyInstance } from "fastify";
import { prisma as defaultPrisma } from "../db/prisma.js";
import { issueCode } from "./codes.js";
import {
  signGoogleState,
  verifyClientId,
  verifyGoogleState,
} from "./jwt.js";

/**
 * "Sign in with Google" for the connector. Primary login for invited operators;
 * the raw bearer stays as an owner break-glass (see tenant-auth).
 *
 * Flow:
 *   GET /oauth/google/start  — validate the MCP client, stash the MCP OAuth
 *     params in a signed state, redirect to Google (openid+email+profile).
 *   GET /oauth/google/callback — verify the id_token (Google JWKS + audience +
 *     issuer + nonce), match the VERIFIED email to an invited TenantPrincipal
 *     (invited-emails-only), then resume the connector's own auth-code flow by
 *     issuing a code and redirecting back to claude.ai.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;background:#ECEDE9;color:#1A1A18;min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:32px}.c{max-width:420px;background:#fff;border:1px solid #DAD8D1;border-radius:16px;padding:32px 34px;box-shadow:0 12px 40px -18px rgba(31,30,28,.28)}h1{font-size:19px;margin:0 0 10px}p{color:#5A5A57;line-height:1.55;font-size:14.5px;margin:0}</style>
</head><body><div class="c"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></div></body></html>`;
}

export type GoogleOAuthDeps = { prisma?: typeof defaultPrisma };

export function mountGoogleOAuth(
  app: FastifyInstance,
  deps: GoogleOAuthDeps = {},
): void {
  const db = deps.prisma ?? defaultPrisma;

  app.get("/oauth/google/start", async (request, reply) => {
    const cfg = googleConfig();
    if (!cfg) {
      return reply
        .code(503)
        .type("text/html")
        .send(page("Indisponível", "O login com Google ainda não está configurado."));
    }
    const q = request.query as Record<string, string | undefined>;
    const { client_id: clientId, redirect_uri: redirectUri } = q;
    const codeChallenge = q.code_challenge;
    const tenant = q.tenant;
    const mcpState = q.state ?? "";
    if (!clientId || !redirectUri || !codeChallenge || !tenant) {
      return reply
        .code(400)
        .type("text/html")
        .send(page("Erro", "Parâmetros de autorização ausentes. Reinicie a conexão."));
    }
    const client = await verifyClientId(clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) {
      return reply
        .code(400)
        .type("text/html")
        .send(page("Erro", "Cliente OAuth inválido."));
    }
    const nonce = randomBytes(16).toString("base64url");
    const state = await signGoogleState({
      tenant,
      clientId,
      redirectUri,
      mcpState,
      codeChallenge,
      nonce,
    });
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("prompt", "select_account");
    return reply.redirect(url.toString());
  });

  app.get("/oauth/google/callback", async (request, reply) => {
    const cfg = googleConfig();
    if (!cfg) {
      return reply
        .code(503)
        .type("text/html")
        .send(page("Indisponível", "Login com Google não configurado."));
    }
    const q = request.query as Record<string, string | undefined>;
    if (q.error) {
      return reply
        .code(401)
        .type("text/html")
        .send(page("Login cancelado", "O login com Google foi cancelado."));
    }
    const code = q.code;
    const stateRaw = q.state;
    if (!code || !stateRaw) {
      return reply
        .code(400)
        .type("text/html")
        .send(page("Erro", "Resposta inválida do Google."));
    }
    const st = await verifyGoogleState(stateRaw);
    if (!st) {
      return reply
        .code(400)
        .type("text/html")
        .send(page("Sessão expirada", "Sua sessão de login expirou. Tente conectar novamente."));
    }

    // Exchange the authorization code for tokens.
    let idToken: string | undefined;
    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!res.ok) throw new Error(`token ${res.status}`);
      const json = (await res.json()) as { id_token?: string };
      idToken = json.id_token;
    } catch {
      return reply
        .code(502)
        .type("text/html")
        .send(page("Erro", "Não foi possível validar com o Google. Tente novamente."));
    }
    if (!idToken) {
      return reply
        .code(502)
        .type("text/html")
        .send(page("Erro", "O Google não retornou um token de identidade."));
    }

    // Verify the id_token: signature (Google JWKS), audience, issuer, nonce,
    // and that the email is verified.
    let email: string;
    let sub: string;
    try {
      const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: cfg.clientId,
      });
      if (payload.nonce !== st.nonce) throw new Error("nonce");
      if (payload.email_verified !== true) throw new Error("email_unverified");
      if (typeof payload.email !== "string" || typeof payload.sub !== "string") {
        throw new Error("claims");
      }
      email = payload.email.toLowerCase();
      sub = payload.sub;
    } catch {
      return reply
        .code(401)
        .type("text/html")
        .send(page("Não autorizado", "Não foi possível verificar sua conta Google."));
    }

    // Match a pre-invited principal by verified email (invited-emails-only).
    let principal: Awaited<
      ReturnType<typeof db.tenantPrincipal.findUnique>
    >;
    try {
      const tenant = await db.integrationTenant.findUnique({
        where: { slug: st.tenant },
      });
      if (!tenant || tenant.status !== "active") {
        return reply
          .code(401)
          .type("text/html")
          .send(page("Não autorizado", "Conta de acesso indisponível."));
      }
      principal = await db.tenantPrincipal.findUnique({
        where: {
          tenantId_contactEmail: { tenantId: tenant.id, contactEmail: email },
        },
      });
    } catch {
      return reply
        .code(503)
        .type("text/html")
        .send(page("Instável", "Serviço de autenticação indisponível. Tente em instantes."));
    }
    if (!principal || principal.status !== "active") {
      return reply
        .code(403)
        .type("text/html")
        .send(
          page(
            "Acesso não autorizado",
            `A conta ${email} não tem acesso. Peça um convite ao administrador.`,
          ),
        );
    }
    // First login binds googleSub; afterwards it must match, so a different
    // Google account can't claim an already-bound invite email.
    if (principal.googleSub && principal.googleSub !== sub) {
      return reply
        .code(403)
        .type("text/html")
        .send(page("Conta divergente", "Esta pessoa já está vinculada a outra conta Google."));
    }
    if (!principal.googleSub) {
      try {
        await db.tenantPrincipal.update({
          where: { id: principal.id },
          data: { googleSub: sub },
        });
      } catch {
        /* best effort — a race just means the next request binds it */
      }
    }

    // Resume the connector's own authorization-code flow (same as the bearer
    // consent POST): mint a one-time code bound to this principal + PKCE, and
    // redirect back to claude.ai.
    const codeVal = issueCode({
      tenantSlug: st.tenant,
      principalId: principal.id,
      role: principal.role,
      actorLabel: principal.label,
      clientId: st.clientId,
      redirectUri: st.redirectUri,
      codeChallenge: st.codeChallenge,
      codeChallengeMethod: "S256",
    });
    const back = new URL(st.redirectUri);
    back.searchParams.set("code", codeVal);
    if (st.mcpState) back.searchParams.set("state", st.mcpState);
    return reply.redirect(back.toString());
  });
}
