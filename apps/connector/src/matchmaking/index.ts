import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prismaNamiMatchmaking } from "../db/prisma-nami-matchmaking.js";
import { sendConfirmedEmail, sendWaitlistEmail } from "./email.js";

// nami.works matchmaking funnel (2026-10-01). The only CORS-enabled route in
// this app -- every other route (MCP transport, OAuth, webhooks) is either
// server-to-server or same-origin, so CORS is scoped to just this prefix
// rather than registered globally.

const createSchema = z.object({
  fase: z.string().min(1),
  dor: z.string().min(1),
  caminhos: z.array(z.string()),
  seguimentos: z.record(z.string(), z.string()),
  valor: z.string().min(1),
  diagnosticoTexto: z.string().min(1),
  inNetwork: z.boolean(),
  persona: z.string().optional(),
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmContent: z.string().optional(),
});

const updateSchema = z.object({
  tierRecomendado: z.string().optional(),
  tierEscolhido: z.string().optional(),
  nome: z.string().optional(),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
  status: z.enum(["confirmed", "waitlist"]),
});

// Zod's `.optional()` types a missing field as `T | undefined`; Prisma's
// input types (under `exactOptionalPropertyTypes`) want the key entirely
// absent instead. Strips undefined-valued keys so parsed bodies satisfy
// both.
function omitUndefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

export async function mountMatchmakingRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scope) => {
    const allowedOrigin = process.env.MATCHMAKING_ALLOWED_ORIGIN ?? "https://nami.works";
    await scope.register(cors, {
      origin: allowedOrigin,
      methods: ["POST", "PATCH"],
    });

    // Fired as soon as the visitor reaches the diagnostic (end of the quiz),
    // before any contact info exists -- captures "left without confirming"
    // as real data, per funnel-spec.md's data model.
    scope.post("/nami-matchmaking/submissions", async (req, reply) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const row = await prismaNamiMatchmaking.matchmakingSubmission.create({
        data: omitUndefined({ ...parsed.data, status: "quiz_done" }),
      });
      return reply.code(201).send({ id: row.id });
    });

    // Fired on "confirmar minha conversa" (tier path) or "me avise"
    // (out-of-network waitlist path) -- adds contact info and the final
    // status to the row already created above.
    scope.patch("/nami-matchmaking/submissions/:id", async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      let row;
      try {
        row = await prismaNamiMatchmaking.matchmakingSubmission.update({
          where: { id },
          data: omitUndefined(parsed.data),
        });
      } catch {
        return reply.code(404).send({ error: "submission not found" });
      }

      // Respond first -- the submission is already durably stored, and a
      // slow or failed email send must never delay or break confirmation.
      reply.code(200).send({ ok: true });

      if (row.email) {
        if (row.status === "confirmed") {
          await sendConfirmedEmail(
            { to: row.email, dor: row.dor, fase: row.fase, tier: row.tierEscolhido ?? row.tierRecomendado ?? "" },
            req.log,
          );
        } else if (row.status === "waitlist") {
          await sendWaitlistEmail({ to: row.email, dor: row.dor }, req.log);
        }
      }
    });
  });
}
