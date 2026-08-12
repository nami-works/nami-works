// "Sign in with Google", adapted from apps/connector's flow but stripped of
// the MCP-OAuth-provider machinery (PKCE relay, client registration) that app
// needs and this one doesn't — this app just needs a browser login gate for
// a small invited team. Invited-emails-only: a User row must already exist
// (status "active") before Google sign-in will bind to it.

import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { issueSession, clearSession } from "./session.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function stateKey(): Uint8Array {
  const key = process.env.SESSION_SIGNING_KEY;
  if (!key) throw new Error("SESSION_SIGNING_KEY not configured");
  return new TextEncoder().encode(key);
}

export function mountGoogleAuth(app: FastifyInstance): void {
  app.get("/auth/google/start", async (_request, reply) => {
    const cfg = googleConfig();
    if (!cfg) return reply.code(503).send("Login com Google não configurado.");

    const nonce = randomBytes(16).toString("base64url");
    const state = await new SignJWT({ nonce })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("10m")
      .sign(stateKey());

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

  app.get("/auth/google/callback", async (request, reply) => {
    const cfg = googleConfig();
    if (!cfg) return reply.code(503).send("Login com Google não configurado.");

    const q = request.query as Record<string, string | undefined>;
    if (q.error || !q.code || !q.state) {
      return reply.redirect("/login.html?error=1");
    }

    let nonce: unknown;
    try {
      const { payload } = await jwtVerify(q.state, stateKey());
      nonce = payload.nonce;
    } catch {
      return reply.redirect("/login.html?error=expired");
    }

    let idToken: string | undefined;
    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: q.code,
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
      return reply.redirect("/login.html?error=google");
    }
    if (!idToken) return reply.redirect("/login.html?error=google");

    let email: string;
    let sub: string;
    try {
      const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience: cfg.clientId,
      });
      if (payload.nonce !== nonce) throw new Error("nonce");
      if (payload.email_verified !== true) throw new Error("unverified");
      if (typeof payload.email !== "string" || typeof payload.sub !== "string") {
        throw new Error("claims");
      }
      email = payload.email.toLowerCase();
      sub = payload.sub;
    } catch {
      return reply.redirect("/login.html?error=verify");
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== "active") {
      return reply.redirect("/login.html?error=not_invited");
    }
    if (user.googleSub && user.googleSub !== sub) {
      return reply.redirect("/login.html?error=account_mismatch");
    }
    if (!user.googleSub) {
      await prisma.user.update({ where: { id: user.id }, data: { googleSub: sub } });
    }

    await issueSession(reply, user.id, user.email);
    return reply.redirect("/");
  });

  app.post("/auth/logout", async (_request, reply) => {
    clearSession(reply);
    return reply.send({ ok: true });
  });
}
