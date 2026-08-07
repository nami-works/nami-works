// Signed, httpOnly session cookie. No DB session table — the JWT itself
// carries the identity and is re-verified (signature + expiry) on every
// request; email/status is re-checked against the User table so a disabled
// account loses access immediately even with a still-valid cookie.

import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";

const COOKIE_NAME = "cf_session";
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function signingKey(): Uint8Array {
  const key = process.env.SESSION_SIGNING_KEY;
  if (!key) throw new Error("SESSION_SIGNING_KEY not configured");
  return new TextEncoder().encode(key);
}

export async function issueSession(reply: FastifyReply, userId: string, email: string) {
  const jwt = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(signingKey());

  reply.setCookie(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export type SessionUser = { id: string; email: string; name: string | null };

/** Resolves the current request's session to an active User, or null. */
export async function currentUser(request: FastifyRequest): Promise<SessionUser | null> {
  const token = request.cookies[COOKIE_NAME];
  if (!token) return null;
  let userId: string | undefined;
  try {
    const { payload } = await jwtVerify(token, signingKey());
    userId = payload.sub;
  } catch {
    return null;
  }
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "active") return null;
  return { id: user.id, email: user.email, name: user.name };
}

/** Route hook: 401s JSON requests, redirects browser navigations to login. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const user = await currentUser(request);
  if (!user) {
    if (request.url.startsWith("/api/")) {
      return reply.code(401).send({ error: "not_authenticated" });
    }
    return reply.redirect("/login.html");
  }
  (request as FastifyRequest & { user: SessionUser }).user = user;
}
