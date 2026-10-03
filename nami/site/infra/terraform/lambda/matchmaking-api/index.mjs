// Matchmaking-funnel API for nami.works (2026-10-02).
//
//   POST  /submissions        quiz finished -> stores a row (quiz_done), returns { id }
//   PATCH /submissions/{id}   moves the row forward, one step per call:
//                               lead       quiz_done -> lead       e-mail (+ optional WhatsApp);
//                                                                  mails the visitor their plan
//                               confirmed  lead|quiz_done -> confirmed   asked for a conversation
//                               waitlist   quiz_done -> waitlist   out-of-network topic
//                             a PATCH that does not fit the row's current status is 409
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

// Text the visitor's browser sends ends up in e-mails from our domain, so it
// must never carry links.
const LINK_RE = /https?:\/\/|www\./i;
const PROMPT_PREFIX = "contexto do meu negócio:";

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

function noLinks(value, key) {
  if (value !== undefined && LINK_RE.test(value)) throw new ValidationError(`${key} must not contain links`);
  return value;
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
  const fase = noLinks(reqStr(body, "fase", 100), "fase");
  const dor = noLinks(reqStr(body, "dor", 100), "dor");
  const valor = reqStr(body, "valor", 300);
  const diagnosticoTexto = noLinks(reqStr(body, "diagnosticoTexto", 2000), "diagnosticoTexto");

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

const STATUSES = new Set(["lead", "confirmed", "waitlist"]);

// The statuses a row may be in for each move. Anything else is 409.
const ALLOWED_FROM = {
  lead: ["quiz_done"],
  waitlist: ["quiz_done"],
  confirmed: ["quiz_done", "lead"],
};

function validateUpdate(body) {
  const status = body.status;
  if (!STATUSES.has(status)) throw new ValidationError("status must be lead, confirmed or waitlist");

  // A confirmation after the lead step reuses the e-mail already on the row.
  const email = status === "confirmed" ? optStr(body, "email", 254) : reqStr(body, "email", 254);
  if (email !== undefined && !EMAIL_RE.test(email)) throw new ValidationError("email is not valid");

  let promptIA = status === "lead" ? optStr(body, "promptIA", 8000) : undefined;
  if (promptIA !== undefined) {
    if (!promptIA.startsWith(PROMPT_PREFIX)) throw new ValidationError("promptIA has an unexpected format");
    promptIA = noLinks(promptIA, "promptIA");
  }

  return {
    status,
    email,
    nome: optStr(body, "nome", 200),
    telefone: optStr(body, "telefone", 50),
    tierRecomendado: optStr(body, "tierRecomendado", 50),
    tierEscolhido: optStr(body, "tierEscolhido", 50),
    promptIA,
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

async function updateSubmission(event, id) {
  const data = validateUpdate(parseJsonBody(event));
  const now = new Date().toISOString();

  const sets = { status: S(data.status), updatedAt: S(now) };
  if (data.email !== undefined) sets.email = S(data.email);
  // leadAt marks the first contact; finalizedAt marks the end of the funnel.
  sets[data.status === "lead" ? "leadAt" : "finalizedAt"] = S(now);
  for (const key of ["nome", "telefone", "tierRecomendado", "tierEscolhido"]) {
    if (data[key] !== undefined) sets[key] = S(data[key]);
  }

  const names = { "#id": "id", "#status": "status" };
  const values = {};
  const from = ALLOWED_FROM[data.status];
  from.forEach((s, i) => {
    values[`:from${i}`] = S(s);
  });
  let condition = `attribute_exists(#id) AND (${from.map((_, i) => `#status = :from${i}`).join(" OR ")})`;
  if (data.status === "confirmed" && data.email === undefined) {
    names["#email"] = "email";
    condition += " AND attribute_exists(#email)";
  }

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
        ConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
      }),
    );
    updated = result.Attributes;
  } catch (err) {
    if (err?.name === "ConditionalCheckFailedException") {
      // Item present in the failure payload -> it exists but is not in a
      // status this move can start from; absent -> no such submission.
      if (!err.Item) return json(404, { error: "submission not found" });
      if (data.status === "confirmed" && data.email === undefined && err.Item.status?.S === "quiz_done") {
        return json(400, { error: "email is required" });
      }
      return json(409, { error: "already submitted" });
    }
    throw err;
  }

  // The row is durably stored at this point. Lambda freezes once the handler
  // returns, so emails must go out before returning -- but a failed send
  // never fails the request.
  await Promise.allSettled([
    data.status === "lead" ? sendPlanEmail(updated, data.promptIA) : sendVisitorEmail(updated),
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

// The plan the visitor asked for on the lead step: their reading and today's
// steps (stored from the quiz) plus the ready-to-paste text for their own AI.
async function sendPlanEmail(row, promptIA) {
  const v = (key) => row[key]?.S ?? "";
  const principal = v("dor").split(" + ")[0];
  const lines = [
    "olá,",
    "",
    "aqui está o plano que você pediu. ele reúne as suas respostas e o que você pode fazer hoje.",
    "",
    `sua principal trava: ${oneLine(principal)}`,
    `fase do negócio: ${oneLine(v("fase"))}`,
    "",
    v("diagnosticoTexto"),
  ];
  if (promptIA) {
    lines.push(
      "",
      "texto para a sua IA (copie e cole no ChatGPT, no Claude ou na IA que você já usa):",
      "",
      promptIA,
    );
  }
  lines.push(
    "",
    "quer conversar com alguém? volte a https://nami.works e escolha a conversa, ou responda este e-mail. nada é cobrado antes de você aceitar a conexão.",
    "",
    "você recebeu este e-mail porque pediu o seu plano em nami.works.",
  );
  await send({
    to: row.email.S,
    subject: `seu plano da nami.works: ${principal}`,
    body: lines.join("\n"),
  });
}

// No professional roster exists yet (v1), so these never claim a match
// already happened -- they confirm the request landed and keep the "nada e
// cobrado agora" promise.
async function sendVisitorEmail(row) {
  const v = (key) => row[key]?.S ?? "";
  if (v("status") === "confirmed") {
    await send({
      to: row.email.S,
      subject: "recebemos o seu pedido de conversa na nami.works",
      body: [
        `registramos o pedido de uma conversa ${oneLine(v("tierEscolhido") || v("tierRecomendado"))}, de 45 minutos, sobre ${oneLine(v("dor").split(" + ")[0])} (${oneLine(v("fase"))}).`,
        "",
        "a gente entra em contato por e-mail ou WhatsApp assim que encontrar a pessoa certa.",
        "",
        "nada é cobrado antes de você aceitar a conexão.",
      ].join("\n"),
    });
    return;
  }
  await send({
    to: row.email.S,
    subject: "recebemos o seu contato na nami.works",
    body: [
      `recebemos o seu contato sobre: ${oneLine(v("dor"))}`,
      "",
      "esse tema ainda não tem ninguém no nosso time para conversar, mas guardamos o seu contato.",
      "assim que a gente encontrar a pessoa certa, entramos em contato.",
    ].join("\n"),
  });
}

// Every lead/confirmed/waitlist step is a demand signal Lucas follows up by
// hand (no roster yet), so each one is also mailed to him.
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
      `Telefone/WhatsApp: ${v("telefone")}`,
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
      return await updateSubmission(event, match[1].toLowerCase());
    }

    return json(404, { error: "not found" });
  } catch (err) {
    if (err instanceof ValidationError) return json(400, { error: err.message });
    log("error", "unhandled error", { method, path, err: String(err), stack: err?.stack });
    return json(500, { error: "internal error" });
  }
};
