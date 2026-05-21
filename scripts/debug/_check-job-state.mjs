// READ-ONLY: deep-check the two active dispatch jobs.
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const SHOP = "ge-beauty-cosmeticos.myshopify.com";
const LAL_BASE = "https://rest.lalamove.com";
const JOBS = ["cmpa8il7h0042ma2z0g3565zu", "cmpa77sgk000nma2zmr43t1sb"];

function decryptSecret(ciphertext) {
  const parsed = JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8"));
  const key = Buffer.from(process.env.APP_ENCRYPTION_KEY.trim(), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(parsed.ct, "base64")), decipher.final()]).toString("utf8");
}

const prisma = new PrismaClient();
const cred = await prisma.lalamoveShopCredential.findUnique({ where: { shop: SHOP } });
const LAL_KEY = decryptSecret(cred.apiKeyCiphertext);
const LAL_SECRET = decryptSecret(cred.apiSecretCiphertext);

async function fetchLal(orderId) {
  const ts = Date.now().toString();
  const p = `/v3/orders/${encodeURIComponent(orderId)}`;
  const sig = crypto.createHmac("sha256", LAL_SECRET).update(`${ts}\r\nGET\r\n${p}\r\n\r\n`).digest("hex");
  const res = await fetch(`${LAL_BASE}${p}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `hmac ${LAL_KEY}:${ts}:${sig}`,
      Market: "BR",
      "Request-ID": crypto.randomUUID(),
    },
  });
  if (res.status !== 200) return { status: res.status };
  const body = await res.json().catch(() => ({}));
  return { status: 200, order: body.data ?? body };
}

// Get all Lalamove orders that have been created for these two jobs today
const todayLalOrders = {
  "cmpa8il7h0042ma2z0g3565zu": [
    "3497739360839881687","3497750963433984831","3497713946738245863","3497713946738245926",
    "3497714553637257549","3497739360856654168","3497750963442368696","3497750963450757147",
    "3497750963459150060","3498104598617604940","3498124200336642966","3498142275370963112",
    "3498153283615412819",
  ],
  "cmpa77sgk000nma2zmr43t1sb": [
    "3497750963433984783","3497713946738245815","3497713946738245888","3497714553637257499",
    "3497750963433985076","3497713946738246105","3497750963442368730","3497750963450757239",
    "3497750963450757789","3497825539023127434","3498112416137560764","3498137394652332428",
    "3498148757944615894","3498176747055301358","3498197244484731398",
  ],
};

for (const jobId of JOBS) {
  const job = await prisma.lalamoveDispatchJob.findUnique({
    where: { id: jobId },
    select: { id: true, lalamoveOrderId: true, status: true, retryCount: true, requestedAt: true, locationId: true, updatedAt: true, podBucket: true, methodOverride: true, lastRetryAt: true, priorityFeeLevel: true },
  });
  console.log(`\n=== Job ${jobId} ===`);
  console.log(JSON.stringify(job, null, 2));

  // Check every Lalamove order created for this job today
  console.log(`\n  Lalamove orders created today (${todayLalOrders[jobId].length}):`);
  for (const lalId of todayLalOrders[jobId]) {
    const r = await fetchLal(lalId);
    if (r.status !== 200) {
      console.log(`    ${lalId}: FETCH_${r.status}`);
      continue;
    }
    const o = r.order;
    console.log(`    ${lalId}: status=${o.status} driverId=${o.driverId ?? "-"} priceTotal=${o.priceBreakdown?.total ?? "?"} ${o.priceBreakdown?.currency ?? ""}`);
  }
}

await prisma[String.fromCharCode(36) + "disconnect"]();
