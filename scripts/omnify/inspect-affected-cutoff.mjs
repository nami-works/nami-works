/**
 * Read-only summary of the 11 Lalamove orders whose cpg-labs dispatch jobs
 * had their ld_rota tags stripped by the failed-retry CUTOFF chain on
 * 2026-05-16 22:00-22:35 UTC. For each order, prints the order-level status
 * and per-stop POD outcome so we can tell whether the team actually
 * delivered the order in real life vs the Lalamove status reading
 * REJECTED/EXPIRED.
 *
 * Usage:  node scripts/inspect-affected-cutoff.mjs
 * Env:    LALAMOVE_API_KEY, LALAMOVE_API_SECRET (production)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Minimal .env loader.
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
if (!API_KEY || !API_SECRET) {
  console.error("Missing LALAMOVE_API_KEY / LALAMOVE_API_SECRET in env.");
  process.exit(3);
}

const BASE_URL = "https://rest.lalamove.com";
const MARKET = "BR";

const ORDERS = [
  { date: "2026-03-25 18:30", lal: "3459181148369011035", job: "cmn6dp6f9" },
  { date: "2026-03-25 18:30", lal: "3459182650399604943", job: "cmn6dpj25" },
  { date: "2026-03-25 18:30", lal: "3459182650399604996", job: "cmn6dpu2g" },
  { date: "2026-03-28 18:15", lal: "3461324176441430743", job: "cmnanh9ie" },
  { date: "2026-03-31 19:25", lal: "3463558537790313243", job: "cmnf0bl4p" },
  { date: "2026-03-31 19:25", lal: "3463558161334752213", job: "cmnf0bva7" },
  { date: "2026-04-26 19:06", lal: "3482346408303088149", job: "cmog53kr8" },
  { date: "2026-04-28 21:06", lal: "3483886527313039863", job: "cmoj2rett" },
  { date: "2026-05-03 19:30", lal: "3487432590347162196", job: "cmoq48y1l" },
  { date: "2026-05-05 19:35", lal: "3488932192942510257", job: "cmot13e8x" },
  { date: "2026-05-10 23:32", lal: "3492604331637817781", job: "cmp02ruk8" },
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
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function summarisePOD(stops) {
  const counts = { delivered: 0, failed: 0, pending: 0, missing: 0, other: 0 };
  for (let i = 0; i < stops.length; i++) {
    // Stop[0] is pickup per Lalamove convention; we don't count it.
    if (i === 0) continue;
    const raw = (stops[i]?.POD?.status ?? "").trim().toUpperCase();
    if (!raw) {
      counts.missing += 1;
    } else if (["DELIVERED", "COMPLETED", "SUCCESS", "SIGNED"].includes(raw)) {
      counts.delivered += 1;
    } else if (["FAILED", "FAIL", "REJECTED"].includes(raw)) {
      counts.failed += 1;
    } else if (["PENDING", "IN_PROGRESS", "ON_GOING"].includes(raw)) {
      counts.pending += 1;
    } else {
      counts.other += 1;
    }
  }
  return counts;
}

console.log("date              | lalamove status        | POD: del/fail/pend/miss/oth | stops | lalamoveOrderId    | job");
console.log("------------------|------------------------|-----------------------------|-------|--------------------|----------");

for (const o of ORDERS) {
  try {
    const { status, body } = await fetchOrder(o.lal);
    if (status !== 200) {
      console.log(`${o.date}  | HTTP ${status}: ${JSON.stringify(body).slice(0, 80)}  | ${o.lal} | ${o.job}`);
      continue;
    }
    const order = body.data ?? body;
    const stops = order.stops ?? [];
    const pod = summarisePOD(stops);
    const podStr = `${pod.delivered}/${pod.failed}/${pod.pending}/${pod.missing}/${pod.other}`;
    console.log(
      `${o.date} | ${(order.status ?? "?").padEnd(22)} | ${podStr.padEnd(27)} | ${String(stops.length).padEnd(5)} | ${o.lal}  | ${o.job}`,
    );
  } catch (err) {
    console.log(`${o.date}  | ERROR: ${err.message}  | ${o.lal} | ${o.job}`);
  }
}
