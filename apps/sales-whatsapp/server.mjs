// Production server. BASE_PATH support (2026-08-14) ported from
// omnify-admin's server.mjs: apps.gebeauty.com.br is a shared path-routed
// host, this app lives at /beautyback. The health check matches ANY path
// ending in /health regardless of BASE_PATH — omnify-admin's 2026-04-17
// incident (stale BASE_PATH baked into a build, ALB health check 404ing,
// crash-loop) is the reason this isn't just a plain "/health" route.
import path from "node:path";
import url from "node:url";
import express from "express";
import compression from "compression";
import morgan from "morgan";
import { createRequestHandler } from "@react-router/express";
import { PrismaClient } from "@prisma/client-sales-whatsapp";
import { startExpiringCreditScheduler } from "./dist/worker/scheduler.js";

const BUILD_PATH = path.resolve("./build/server/index.js");
const PUBLIC_BUILD_DIR = path.resolve("./build/client");
const port = Number(process.env.PORT) || 3100;
const BASE_PATH = process.env.BASE_PATH || "/";

const HEALTH_RE = /^\/(?:[^/?#]+\/)*health\/?(?:[?#].*)?$/;

const app = express();
app.disable("x-powered-by");

// Health check first, before anything that could fail — before BASE_PATH
// is even consulted.
app.use((req, res, next) => {
  if (req.method === "GET" && HEALTH_RE.test(req.url)) {
    res.status(200).type("text/plain").send("ok");
    return;
  }
  next();
});

app.use(compression());
// Static assets must be mounted under BASE_PATH — a request for
// /beautyback/assets/app.js otherwise falls through to the React Router
// handler with no matching route.
app.use(
  path.posix.join(BASE_PATH, "assets"),
  express.static(path.join(PUBLIC_BUILD_DIR, "assets"), { immutable: true, maxAge: "1y" }),
);
app.use(BASE_PATH, express.static(PUBLIC_BUILD_DIR, { maxAge: "1h" }));
app.use(morgan("tiny"));
app.all("*", createRequestHandler({ build: await import(url.pathToFileURL(BUILD_PATH).href) }));

app.listen(port, () => console.log(`sales-whatsapp listening on ${port} basePath=${BASE_PATH}`));

// Scheduled "credit expiring soon" WhatsApp push (handoff §7) — same
// single-process-polls-its-own-interval pattern as apps/connector's
// pending-credit sweep, no separate worker process for this app either.
// Requires SHOPIFY_SHOP_DOMAIN + ZOKO_API_KEY at runtime; skip (don't
// crash the whole app) if either is unset, since not every environment
// (e.g. a fresh dev install) has them configured yet.
const SHOP = process.env.SHOPIFY_SHOP_DOMAIN;
const ZOKO_API_KEY = process.env.ZOKO_API_KEY;
if (SHOP && ZOKO_API_KEY) {
  startExpiringCreditScheduler({
    shop: SHOP,
    zokoApiKey: ZOKO_API_KEY,
    db: new PrismaClient(),
    log: { info: (msg) => console.log(`[scheduler] ${msg}`), error: (err, msg) => console.error(`[scheduler] ${msg}`, err) },
  });
} else {
  console.warn("[scheduler] SHOPIFY_SHOP_DOMAIN or ZOKO_API_KEY not set — expiring-credit push scheduler disabled");
}
