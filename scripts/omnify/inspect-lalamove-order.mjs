/**
 * Read-only inspect of a Lalamove order via /v3/orders/{orderId}.
 *
 * Usage:
 *   node scripts/inspect-lalamove-order.mjs <orderId>
 *
 * Env (from .env or shell):
 *   LALAMOVE_API_KEY, LALAMOVE_API_SECRET (production keys)
 *   LLM_ENV=prod (default), or LLM_ENV=sandbox
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Minimal .env loader (no dotenv dep).
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, vRaw] = m;
    if (process.env[k]) continue;
    let v = vRaw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

const ORDER_ID = process.argv[2];
if (!ORDER_ID) {
  console.error("Usage: node scripts/inspect-lalamove-order.mjs <orderId>");
  process.exit(2);
}

const API_KEY = process.env.LALAMOVE_API_KEY?.trim();
const API_SECRET = process.env.LALAMOVE_API_SECRET?.trim();
if (!API_KEY || !API_SECRET) {
  console.error("Missing LALAMOVE_API_KEY / LALAMOVE_API_SECRET in env.");
  process.exit(3);
}

const BASE_URL = process.env.LLM_ENV === "sandbox"
  ? "https://rest.sandbox.lalamove.com"
  : "https://rest.lalamove.com";
const MARKET = process.env.LLM_MARKET ?? "BR";

const timestamp = Date.now().toString();
const method = "GET";
const apiPath = `/v3/orders/${encodeURIComponent(ORDER_ID)}`;
const body = "";

const rawSignature = `${timestamp}\r\n${method}\r\n${apiPath}\r\n\r\n${body}`;
const signature = crypto.createHmac("sha256", API_SECRET).update(rawSignature).digest("hex");
const token = `${API_KEY}:${timestamp}:${signature}`;

console.log(`GET ${BASE_URL}${apiPath}  Market=${MARKET}\n`);

const response = await fetch(`${BASE_URL}${apiPath}`, {
  method,
  headers: {
    "Content-Type": "application/json",
    Authorization: `hmac ${token}`,
    Market: MARKET,
    "Request-ID": crypto.randomUUID(),
  },
});

const payload = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error(`ERROR ${response.status}:`, JSON.stringify(payload, null, 2));
  process.exit(1);
}

// Lalamove wraps in { data: ... }; some endpoints return raw object. Handle both.
const order = payload.data ?? payload;

console.log("======== RAW RESPONSE ========");
console.log(JSON.stringify(payload, null, 2));

console.log("\n======== STOP LIST ========");
const stops = order.stops ?? [];
console.log(`stops.length=${stops.length}`);
for (let i = 0; i < stops.length; i++) {
  const s = stops[i];
  console.log(`\n  [${i}] stopId=${s.stopId ?? "?"}`);
  console.log(`      name    = ${JSON.stringify(s.name)}`);
  console.log(`      phone   = ${JSON.stringify(s.phone)}`);
  console.log(`      address = ${JSON.stringify(s.address)}`);
  console.log(`      POD     = ${JSON.stringify(s.POD)}`);
  // Dump every other key on the stop so we don't miss "type"/"kind"/"return" fields.
  const otherKeys = Object.keys(s).filter(
    (k) => !["stopId", "name", "phone", "address", "POD"].includes(k),
  );
  if (otherKeys.length > 0) {
    console.log(`      OTHER   = ${JSON.stringify(Object.fromEntries(otherKeys.map((k) => [k, s[k]])))}`);
  }
}

console.log("\n======== TOP-LEVEL KEYS ========");
for (const k of Object.keys(order)) {
  if (k === "stops") continue;
  const v = order[k];
  const flat = typeof v === "object" ? JSON.stringify(v) : String(v);
  console.log(`  ${k} = ${flat.length > 200 ? flat.slice(0, 200) + "..." : flat}`);
}
