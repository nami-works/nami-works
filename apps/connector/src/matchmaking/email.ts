import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import type { FastifyBaseLogger } from "fastify";

// Confirmation email for the nami.works matchmaking funnel. No professional
// roster exists yet (v1, 2026-10-01), so this never claims a match already
// happened -- it confirms the request landed and sets the expectation that
// a person (Lucas) follows up once a match exists, per the "nada é cobrado
// agora" promise that must hold everywhere.

let client: SESClient | undefined;
function getClient(): SESClient {
  client ??= new SESClient({
    ...(process.env.AWS_REGION ? { region: process.env.AWS_REGION } : {}),
  });
  return client;
}

const FROM_ADDRESS = "nami.works <contato@nami.works>";

type ConfirmedEmailInput = {
  to: string;
  dor: string;
  fase: string;
  tier: string;
};

export async function sendConfirmedEmail(
  input: ConfirmedEmailInput,
  log: FastifyBaseLogger,
): Promise<void> {
  const body = [
    `sua conversa: ${input.dor} · ${input.fase} · plano ${input.tier}`,
    "",
    "a gente já está procurando a pessoa certa pra essa conversa e te chama assim que encontrar.",
    "",
    "nada é cobrado antes de você aceitar a conexão.",
  ].join("\n");

  await send(input.to, "sua conversa com a nami.works está confirmada", body, log);
}

type WaitlistEmailInput = {
  to: string;
  dor: string;
};

export async function sendWaitlistEmail(
  input: WaitlistEmailInput,
  log: FastifyBaseLogger,
): Promise<void> {
  const body = [
    `recebemos seu contato sobre: ${input.dor}`,
    "",
    "esse tema ainda não tem ninguém no nosso time pra conversar, mas guardamos seu contato.",
    "assim que a gente encontrar a pessoa certa, te chama.",
  ].join("\n");

  await send(input.to, "recebemos seu contato — nami.works", body, log);
}

async function send(to: string, subject: string, body: string, log: FastifyBaseLogger): Promise<void> {
  try {
    await getClient().send(
      new SendEmailCommand({
        Source: FROM_ADDRESS,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: body, Charset: "UTF-8" } },
        },
      }),
    );
  } catch (err) {
    // Best-effort: the submission is already stored by the time this runs,
    // so a failed send must never surface as a failed confirmation to the
    // visitor. Logged for manual follow-up instead.
    log.error({ err, to }, "matchmaking: confirmation email failed to send");
  }
}
