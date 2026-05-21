/**
 * Read-only inspect of the 10 Lalamove orders Lucas flagged as
 * "finished yesterday, some stops failed, none reflected in Shopify."
 *
 * For each order, prints:
 *   - Lalamove order-level status
 *   - per-stop POD outcome with details (status, deliveredAt, image)
 *   - stop count vs delivered vs failed vs pending
 *
 * Usage:  node scripts/inspect-yesterday-orders.mjs
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

const API_KEY = process.env.LALAMOVE_API_KEY?.trim();
const API_SECRET = process.env.LALAMOVE_API_SECRET?.trim();
const BASE_URL = "https://rest.lalamove.com";
const MARKET = "BR";

const ORDERS = [
  "3496880797028401487",
  "3496880797028401590",
  "3496888467470893374",
  "3496881288651162145",
  "3496890061373522427",
  "3496890061373522454",
  "3496905241507614901",
  "3496905241507614915",
  "3496905254946164994",
  "3496905241507614973",
];

async function fetchOrder(orderId) {
  const ts = Date.now().toString();
  const apiPath = `/v3/orders/${encodeURIComponent(orderId)}`;
  const sig = crypto
    .createHmac("sha256", API_SECRET)
    .update(`${ts}\r\nGET\r\n${apiPath}\r\n\r\n`)
    .digest("hex");
  const res = await fetch(`${BASE_URL}${apiPath}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `hmac ${API_KEY}:${ts}:${sig}`,
      Market: MARKET,
      "Request-ID": crypto.randomUUID(),
    },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

for (const id of ORDERS) {
  const { status, body } = await fetchOrder(id);
  if (status !== 200) {
    console.log(`\n[${id}] HTTP ${status}:`, JSON.stringify(body).slice(0, 200));
    continue;
  }
  const order = body.data ?? body;
  const stops = order.stops ?? [];

  console.log(`\n=== ${id} ===`);
  console.log(`  orderStatus=${order.status} driverId=${order.driverId ?? "-"} priorityFee=${order.priceBreakdown?.priorityFee ?? "-"}`);

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const role = i === 0 ? "PICKUP " : `STOP ${i} `;
    const podStatus = s?.POD?.status ?? "";
    const podAt = s?.POD?.deliveredAt ?? "";
    const podImg = s?.POD?.image ? "[image]" : "";
    console.log(
      `  ${role} name=${JSON.stringify(s.name).padEnd(28)} phone=${(s.phone ?? "").padEnd(15)} POD=${podStatus.padEnd(11)} at=${podAt} ${podImg}`,
    );
  }
}
