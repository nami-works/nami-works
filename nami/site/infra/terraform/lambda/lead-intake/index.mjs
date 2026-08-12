// Lead-intake handler for the Diagnostico form on nami/site.
//
// Receives a plain HTML form POST (application/x-www-form-urlencoded) via a
// public Lambda Function URL, emails the submission through SES, and
// redirects the browser to a thank-you page -- the same flow shape a
// third-party form service would give, but fully self-hosted.
//
// No CORS handling needed: a native <form method="POST" action="..."> is a
// top-level browser navigation, not a fetch/XHR, so it is not subject to
// CORS at all.
//
// Uses AWS SDK v3, which ships built into the Node.js Lambda runtime -- no
// node_modules, no bundler, just this one file zipped as-is.

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});

const FROM_ADDRESS = process.env.FROM_ADDRESS;
const TO_ADDRESS = process.env.TO_ADDRESS;
const SUCCESS_REDIRECT = process.env.SUCCESS_REDIRECT;
const ERROR_REDIRECT = process.env.ERROR_REDIRECT;

// Field names that can appear more than once in the same submission (chip
// checkbox groups). Object.fromEntries(...).entries() would silently drop
// all but the last value for these -- must read them with getAll() instead.
const MULTI_FIELDS = new Set(["modelo", "gestao", "midia", "atendimento", "dores"]);

function parseFormBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf-8")
    : event.body || "";
  const params = new URLSearchParams(raw);

  const fields = {};
  for (const name of new Set(params.keys())) {
    fields[name] = MULTI_FIELDS.has(name)
      ? params.getAll(name)
      : params.get(name) ?? "";
  }
  return fields;
}

function redirect(location) {
  return { statusCode: 302, headers: { Location: location }, body: "" };
}

function line(label, value) {
  const text = Array.isArray(value) ? value.join(", ") : value;
  return `${label}: ${text && text.length ? text : "(nao informado)"}`;
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const f = parseFormBody(event);

  // Server-side backstop for the HTML `required` attributes on the form --
  // catches direct POSTs that skip the browser's own validation. Matches
  // the required fields on the page itself (nome, empresa, email); the
  // richer field set below is trusted to the client-side validation.
  if (!f.nome || !f.email || !f.empresa) {
    return redirect(ERROR_REDIRECT);
  }

  const bodyText = [
    "== CONTATO ==",
    line("Nome", f.nome),
    line("Empresa", f.empresa),
    line("E-mail", f.email),
    line("Site", f.site),
    line("WhatsApp", f.whatsapp),
    line("Cargo", f.cargo),
    "",
    "== NEGOCIO ==",
    line("O que vende / para quem", f.oferta),
    line("Modelo de venda", f.modelo),
    line("Tamanho do time", f.time),
    line("Faturamento/mes", f.faturamento),
    "",
    "== FERRAMENTAS ==",
    line("Sistema de gestao", f.gestao),
    line("Loja online", f.loja),
    line("Midia / anuncios", f.midia),
    line("Atendimento", f.atendimento),
    line("Dependencia de planilha", f.planilha),
    "",
    "== DORES ==",
    line("Areas que mais pesam", f.dores),
    line("Dor principal", f.dor_principal),
    "",
    "== OBJETIVO ==",
    line("Objetivo em 90 dias", f.objetivo),
    line("Prazo / meta", f.prazo),
  ].join("\n");

  await ses.send(
    new SendEmailCommand({
      Source: FROM_ADDRESS,
      Destination: { ToAddresses: [TO_ADDRESS] },
      ReplyToAddresses: [f.email],
      Message: {
        Subject: { Data: `Novo Diagnostico: ${f.empresa}`, Charset: "UTF-8" },
        Body: { Text: { Data: bodyText, Charset: "UTF-8" } },
      },
    })
  );

  return redirect(SUCCESS_REDIRECT);
};
