/**
 * Test: POST a Lalamove quotation for Recife with WAITING_TIME_030MIN
 * Usage: LLM_ENV=prod node scripts/test-lalamove-quote.mjs
 */
import crypto from "node:crypto";

const API_KEY = process.env.LLM_KEY ?? "pk_test_ce94d60bde45e91c66abece149f5b85a";
const API_SECRET = process.env.LLM_SECRET ?? "sk_test_Qoj6RG+TxXgPyTd2QTYat+r6BfZUyORWF4GMWZth7eyWS6WgqCpnCBNXkVNNDzE5";
const BASE_URL = process.env.LLM_ENV === "prod"
  ? "https://rest.lalamove.com"
  : "https://rest.sandbox.lalamove.com";
const MARKET = "BR";

const path = "/v3/quotations";
const method = "POST";

// Recife coordinates: pickup (Boa Viagem) → delivery (Casa Amarela)
const bodyData = {
  data: {
    language: "pt_BR",
    serviceType: "LALAGO",
    stops: [
      { coordinates: { lat: "-8.1195", lng: "-34.9028" }, address: "Boa Viagem, Recife" },
      { coordinates: { lat: "-8.0222", lng: "-34.9186" }, address: "Casa Amarela, Recife" },
    ],
    isRouteOptimized: false,
    specialRequests: ["WAITING_TIME_030MIN"],
  },
};

const body = JSON.stringify(bodyData);
const timestamp = Date.now().toString();
const rawSignature = `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`;
const signature = crypto.createHmac("sha256", API_SECRET).update(rawSignature).digest("hex");
const token = `${API_KEY}:${timestamp}:${signature}`;

console.log(`POST ${BASE_URL}${path}`);
console.log(`Market: ${MARKET}`);
console.log(`Body: ${JSON.stringify(bodyData.data, null, 2)}\n`);

const response = await fetch(`${BASE_URL}${path}`, {
  method,
  headers: {
    "Content-Type": "application/json",
    Authorization: `hmac ${token}`,
    Market: MARKET,
    "Request-ID": crypto.randomUUID(),
  },
  body,
});

const payload = await response.json();
console.log(`Response ${response.status}:`);
console.log(JSON.stringify(payload, null, 2));
