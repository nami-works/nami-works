// Matchmaking-funnel API for nami.works (2026-10-02).
//
//   POST  /submissions        quiz finished -> stores a row, returns { id }
//   PATCH /submissions/{id}   contact info + final status (confirmed|waitlist),
//                             one-shot: a second PATCH on the same id is 409
//
// CORS is handled by the Lambda Function URL itself (see matchmaking.tf), not
// here. AWS SDK v3 ships inside the Node 20 Lambda runtime, so this is one
// file zipped as-is, no node_modules.
//
// Isolated on purpose: its own table, its own role, nothing shared with the
// GE Beauty connector.

import { randomUUID } from "node:crypto";
import { DynamoDBClient, PutItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ddb = new DynamoDBClient({});
const ses = new SESClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const FROM_ADDRESS = process.env.FROM_ADDRESS;
const TO_ADDRESS = process.env.TO_ADDRESS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_CHARS = 20000;

// ---- helpers --------------------------------------------------------------

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

function log(level, message, extra = {}) {
  console[level === "error" ? "error" : "log"](JSON.stringify({ level, message, ...extra }));
}

// Subjects and one-line values must never carry CR/LF.
function oneLine(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

class ValidationError extends Error {}

function reqStr(obj, key, max) {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "" || v.length > max) {
    throw new ValidationError(`${key} must be a non-empty string up to ${max} chars`);
  }
  return v.trim();
}

function optStr(obj, key, max) {
  const v = obj[key];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > max) {
    throw new ValidationError(`${key} must be a string up to ${max} chars`);
  }
  return v.trim();
}

const S = (value) => ({ S: value });

// ---- request parsing ------------------------------------------------------

function parseJsonBody(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf-8")
    : event.body || "";
  if (raw.length > MAX_BODY_CHARS) throw new ValidationError("body too large");
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new ValidationError("body must be a JSON object");
  }
}

function validateCreate(body) {
  const fase = reqStr(body, "fase", 100);
  const dor = reqStr(body, "dor", 100);
  const valor = reqStr(body, "valor", 300);
  const diagnosticoTexto = reqStr(body, "diagnosticoTexto", 2000);

  if (typeof body.inNetwork !== "boolean") throw new ValidationError("inNetwork must be a boolean");

  if (!Array.isArray(body.caminhos) || body.caminhos.length > 8) {
    throw new ValidationError("caminhos must be an array of up to 8 strings");
  }
  const caminhos = body.caminhos.map((c) => {
    if (typeof c !== "string" || c.length > 100) throw new ValidationError("caminhos entries must be short strings");
    return c;
  });

  const seg = body.seguimentos;
  if (seg === null || typeof seg !== "object" || Array.isArray(seg) || Object.keys(seg).length > 8) {
    throw new ValidationError("seguimentos must be an object of up to 8 entries");
  }
  const seguimentos = {};
  for (const [k, v] of Object.entries(seg)) {
    if (k.length > 100 || typeof v !== "string" || v.length > 100) {
      throw new ValidationError("seguimentos entries must be short strings");
    }
    seguimentos[k] = v;
  }

  return {
    fase,
    dor,
    valor,
    diagnosticoTexto,
    inNetwork: body.inNetwork,
    caminhos,
    seguimentos,
    persona: optStr(body, "persona", 200),
    utmSource: optStr(body, "utmSource", 200),
    utmMedium: optStr(body, "utmMedium", 200),
    utmCampaign: optStr(body, "utmCampaign", 200),
    utmContent: optStr(body, "utmContent", 200),
  };
}

function validateUpdate(body) {
  const status = body.status;
  if (status !== "confirmed" && status !== "waitlist") {
    throw new ValidationError("status must be confirmed or waitlist");
  }
  const email = reqStr(body, "email", 254);
  if (!EMAIL_RE.test(email)) throw new ValidationError("email is not valid");

  return {
    status,
    email,
    nome: optStr(body, "nome", 200),
    telefone: optStr(body, "telefone", 50),
    tierRecomendado: optStr(body, "tierRecomendado", 50),
    tierEscolhido: optStr(body, "tierEscolhido", 50),
  };
}

// ---- handlers -------------------------------------------------------------

async function createSubmission(event) {
  const data = validateCreate(parseJsonBody(event));
  const id = randomUUID();
  const now = new Date().toISOString();

  const item = {
    id: S(id),
    createdAt: S(now),
    updatedAt: S(now),
    status: S("quiz_done"),
    fase: S(data.fase),
    dor: S(data.dor),
    valor: S(data.valor),
    diagnosticoTexto: S(data.diagnosticoTexto),
    inNetwork: { BOOL: data.inNetwork },
    caminhos: { L: data.caminhos.map(S) },
    seguimentos: { M: Object.fromEntries(Object.entries(data.seguimentos).map(([k, v]) => [k, S(v)])) },
  };
  for (const key of ["persona", "utmSource", "utmMedium", "utmCampaign", "utmContent"]) {
    if (data[key] !== undefined) item[key] = S(data[key]);
  }

  await ddb.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: "attribute_not_exists(#id)",
      ExpressionAttributeNames: { "#id": "id" },
    }),
  );
  return json(201, { id });
}

async function finalizeSubmission(event, id) {
  const data = validateUpdate(parseJsonBody(event));
  const now = new Date().toISOString();

  const sets = { status: S(data.status), email: S(data.email), updatedAt: S(now), finalizedAt: S(now) };
  for (const key of ["nome", "telefone", "tierRecomendado", "tierEscolhido"]) {
    if (data[key] !== undefined) sets[key] = S(data[key]);
  }

  const names = { "#id": "id", "#fin": "finalizedAt" };
  const values = {};
  const assignments = Object.entries(sets).map(([key, value], i) => {
    names[`#k${i}`] = key;
    values[`:v${i}`] = value;
    return `#k${i} = :v${i}`;
  });

  let updated;
  try {
    const result = await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { id: S(id) },
        UpdateExpression: `SET ${assignments.join(", ")}`,
        ConditionExpression: "attribute_exists(#id) AND attribute_not_exists(#fin)",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    updated = result.Attributes;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      // Item present in the failure payload -> it exists and was already
      // finalized; absent -> no such submission.
      return err.Item ? json(409, { error: "already submitted" }) : json(404, { error: "submission not found" });
    }
    throw err;
  }

  // The row is durably stored at this point. Lambda freezes once the handler
  // returns, so emails must go out before returning -- but a failed send
  // never fails the request.
  const dor = updated?.dor?.S ?? "";
  const fase = updated?.fase?.S ?? "";
  const tier = updated?.tierEscolhido?.S ?? updated?.tierRecomendado?.S ?? "";

  await Promise.allSettled([
    sendVisitorEmail(data, { dor, fase, tier }),
    sendLeadAlert(id, updated),
  ]);

  return json(200, { ok: true });
}

// ---- email ----------------------------------------------------------------

async function send({ to, subject, body, replyTo }) {
  try {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_ADDRESS,
        Destination: { ToAddresses: [to] },
        ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
        Message: {
          Subject: { Data: oneLine(subject), Charset: "UTF-8" },
          Body: { Text: { Data: body, Charset: "UTF-8" } },
        },
      }),
    );
  } catch (err) {
    log("error", "email failed to send", { to, subject, err: String(err) });
  }
}

// No professional roster exists yet (v1), so these never claim a match
// already happened -- they confirm the request landed and keep the "nada e
// cobrado agora" promise.
async function sendVisitorEmail(data, { dor, fase, tier }) {
  if (data.status === "confirmed") {
    await send({
      to: data.email,
      subject: "sua conversa com a nami.works está confirmada",
      body: [
        `sua conversa: ${oneLine(dor)} · ${oneLine(fase)} · plano ${oneLine(tier)}`,
        "",
        "a gente já está procurando a pessoa certa pra essa conversa e te chama assim que encontrar.",
        "",
        "nada é cobrado antes de você aceitar a conexão.",
      ].join("\n"),
    });
    return;
  }
  await send({
    to: data.email,
    subject: "recebemos seu contato — nami.works",
    body: [
      `recebemos seu contato sobre: ${oneLine(dor)}`,
      "",
      "esse tema ainda não tem ninguém no nosso time pra conversar, mas guardamos seu contato.",
      "assim que a gente encontrar a pessoa certa, te chama.",
    ].join("\n"),
  });
}

// Every confirmed/waitlist row is a demand signal Lucas follows up by hand
// (no roster yet), so each one is also mailed to him.
async function sendLeadAlert(id, row) {
  if (!TO_ADDRESS || !row) return;
  const v = (key) => row[key]?.S ?? "(não informado)";
  const caminhos = (row.caminhos?.L ?? []).map((c) => c.S).join(", ") || "(nenhum)";
  const seguimentos =
    Object.entries(row.seguimentos?.M ?? {})
      .map(([k, val]) => `${k}: ${val.S}`)
      .join("; ") || "(nenhum)";

  await send({
    to: TO_ADDRESS,
    replyTo: row.email?.S,
    subject: `Novo lead nami.works (${v("status")}): ${v("dor")}`,
    body: [
      "== CONTATO ==",
      `Nome: ${v("nome")}`,
      `E-mail: ${v("email")}`,
      `Telefone: ${v("telefone")}`,
      "",
      "== QUIZ ==",
      `Fase: ${v("fase")}`,
      `Dor: ${v("dor")}`,
      `Caminhos tentados: ${caminhos}`,
      `Como foram: ${seguimentos}`,
      `Valor agora: ${v("valor")}`,
      "",
      "== RESULTADO ==",
      `Status: ${v("status")}`,
      `Tier recomendado: ${v("tierRecomendado")}`,
      `Tier escolhido: ${v("tierEscolhido")}`,
      `Na rede: ${row.inNetwork?.BOOL ? "sim" : "não"}`,
      "",
      "== ORIGEM ==",
      `Persona: ${v("persona")}`,
      `utm_source: ${v("utmSource")}`,
      `utm_medium: ${v("utmMedium")}`,
      `utm_campaign: ${v("utmCampaign")}`,
      `utm_content: ${v("utmContent")}`,
      "",
      `ID: ${id}`,
    ].join("\n"),
  });
}

// ---- entry ----------------------------------------------------------------

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const path = (event.rawPath || "/").replace(/\/+$/, "") || "/";

  try {
    if (method === "OPTIONS") return { statusCode: 204, body: "" };

    if (method === "POST" && path === "/submissions") {
      return await createSubmission(event);
    }

    const match = path.match(/^\/submissions\/([^/]+)$/);
    if (method === "PATCH" && match) {
      if (!UUID_RE.test(match[1])) return json(404, { error: "submission not found" });
      return await finalizeSubmission(event, match[1].toLowerCase());
    }

    return json(404, { error: "not found" });
  } catch (err) {
    if (err instanceof ValidationError) return json(400, { error: err.message });
    log("error", "unhandled error", { method, path, err: String(err), stack: err?.stack });
    return json(500, { error: "internal error" });
  }
};
