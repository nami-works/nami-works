// Lead-intake handler for the Diagnostico form on apps/nami-site.
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

function parseFormBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf-8")
    : event.body || "";
  return Object.fromEntries(new URLSearchParams(raw).entries());
}

function redirect(location) {
  return { statusCode: 302, headers: { Location: location }, body: "" };
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const fields = parseFormBody(event);
  const { nome, email, empresa, site, area_interesse, mensagem } = fields;

  // Server-side backstop for the HTML `required` attributes on the form --
  // catches direct POSTs that skip the browser's own validation.
  if (!nome || !email || !empresa) {
    return redirect(ERROR_REDIRECT);
  }

  const bodyText = [
    `Nome: ${nome}`,
    `E-mail: ${email}`,
    `Empresa: ${empresa}`,
    `Site: ${site || "(nao informado)"}`,
    `Area de interesse: ${area_interesse || "(nao informado)"}`,
    "",
    "Mensagem:",
    mensagem || "(vazio)",
  ].join("\n");

  await ses.send(
    new SendEmailCommand({
      Source: FROM_ADDRESS,
      Destination: { ToAddresses: [TO_ADDRESS] },
      ReplyToAddresses: [email],
      Message: {
        Subject: { Data: `Novo Diagnostico: ${empresa}`, Charset: "UTF-8" },
        Body: { Text: { Data: bodyText, Charset: "UTF-8" } },
      },
    })
  );

  return redirect(SUCCESS_REDIRECT);
};
