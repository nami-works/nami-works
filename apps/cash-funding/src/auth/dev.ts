// Local-dev-only login bypass — skips Google OAuth entirely so the app can
// be clicked through before a real Google OAuth client is configured. Never
// mounted in production (see server.ts).

import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { issueSession } from "./session.js";

export function mountDevAuth(app: FastifyInstance): void {
  app.get("/auth/dev-login", async (_request, reply) => {
    const user = await prisma.user.findFirst({ where: { status: "active" } });
    if (!user) return reply.code(404).send("Nenhum usuário convidado — rode o seed primeiro.");
    await issueSession(reply, user.id, user.email);
    return reply.redirect("/");
  });
}
