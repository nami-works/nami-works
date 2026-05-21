/**
 * One-off: cancel a Lalamove order via DELETE /v3/orders/{orderId}.
 *
 * Usage:
 *   node scripts/_cancel-lalamove-order.mjs <orderId>
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
  console.error("Usage: node scripts/_cancel-lalamove-order.mjs <orderId>");
  process.exit(2);
}

const API_KEY = process.env.LALAMOVE_API_KEY?.trim();
const API_SECRET = process.env.LALAMOVE_API_SECRET?.trim();
const BASE_URL = "https://rest.lalamove.com";
const MARKET = "BR";

const timestamp = Date.now().toString();
const method = "DELETE";
const apiPath = `/v3/orders/${encodeURIComponent(ORDER_ID)}`;
const body = "";

const rawSignature = `${timestamp}\r\n${method}\r\n${apiPath}\r\n\r\n${body}`;
const signature = crypto.createHmac("sha256", API_SECRET).update(rawSignature).digest("hex");
const token = `${API_KEY}:${timestamp}:${signature}`;

console.log(`DELETE ${BASE_URL}${apiPath}  Market=${MARKET}\n`);

const response = await fetch(`${BASE_URL}${apiPath}`, {
  method,
  headers: {
    "Content-Type": "application/json",
    Authorization: `hmac ${token}`,
    Market: MARKET,
    "Request-ID": crypto.randomUUID(),
  },
});

const text = await response.text();
console.log(`HTTP ${response.status}`);
console.log(text || "(empty body)");
process.exit(response.ok ? 0 : 1);
