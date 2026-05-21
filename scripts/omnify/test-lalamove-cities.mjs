/**
 * Quick test: fetch Lalamove /v3/cities for BR market
 *
 * Sandbox:  node scripts/test-lalamove-cities.mjs
 * Prod:     LLM_KEY=pk_prod_... LLM_SECRET=sk_prod_... LLM_ENV=prod node scripts/test-lalamove-cities.mjs
 */
import crypto from "node:crypto";

const API_KEY = process.env.LLM_KEY ?? "pk_test_ce94d60bde45e91c66abece149f5b85a";
const API_SECRET = process.env.LLM_SECRET ?? "sk_test_Qoj6RG+TxXgPyTd2QTYat+r6BfZUyORWF4GMWZth7eyWS6WgqCpnCBNXkVNNDzE5";
const BASE_URL = process.env.LLM_ENV === "prod"
  ? "https://rest.lalamove.com"
  : "https://rest.sandbox.lalamove.com";
const MARKET = "BR";

const timestamp = Date.now().toString();
const method = "GET";
const path = "/v3/cities";
const body = "";

const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
const signature = crypto.createHmac("sha256", API_SECRET).update(rawSignature).digest("hex");
const token = `${API_KEY}:${timestamp}:${signature}`;

console.log(`Calling ${BASE_URL}${path} with Market: ${MARKET}\n`);

const response = await fetch(`${BASE_URL}${path}`, {
  method,
  headers: {
    "Content-Type": "application/json",
    Authorization: `hmac ${token}`,
    Market: MARKET,
    "Request-ID": crypto.randomUUID(),
  },
});

const payload = await response.json();

if (!response.ok) {
  console.error(`ERROR ${response.status}:`, JSON.stringify(payload, null, 2));
  process.exit(1);
}

const cities = payload.data;
console.log(`Found ${cities.length} cities:\n`);

const FILTER = (process.argv[2] ?? "").toLowerCase();
for (const city of cities) {
  if (FILTER && !city.name?.toLowerCase().includes(FILTER) && !city.locode?.toLowerCase().includes(FILTER)) continue;
  console.log(`=== ${JSON.stringify(city.name)} (locode: ${JSON.stringify(city.locode)}) ===`);
  for (const service of city.services ?? []) {
    const srs = service.specialRequests?.map(sr => `${sr.name} — ${sr.description}`).join("\n    ") || "(none)";
    console.log(`  Service: ${service.key} (${service.description ?? ""})`);
    console.log(`    Special Requests:\n    ${srs}`);
  }
  console.log();
}
if (FILTER && !cities.some(c => c.name?.toLowerCase().includes(FILTER) || c.locode?.toLowerCase().includes(FILTER))) {
  console.log(`No city matching "${FILTER}". Available: ${cities.map(c => `${c.name} (${c.locode})`).join(", ")}`);
}
