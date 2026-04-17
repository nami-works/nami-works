// Custom production server. Replaces `react-router-serve` to expose a
// basename-independent /health endpoint that returns 200 REGARDLESS of how
// the React Router bundle was built. Everything else mirrors react-router-serve
// (static assets, compression, morgan logging, request handler).
//
// Why: on 2026-04-17 a Docker image was built with a stale BASE_PATH, baking
// <Router basename="/gebeauty"> into the client bundle while the ALB routed
// /full/*. The health check path /full/health didn't match the basename, so
// every health check returned 404. ALB flagged the task unhealthy, ECS killed
// it, the replacement was built from the same bad image, and the service
// crash-looped every ~8 min — producing "TypeError: Failed to fetch" for end
// users during each replacement window.
//
// This server's /health is matched BEFORE the React Router handler, with a
// regex that accepts any path ending in /health. Even if the build throws
// during init, /health still returns 200 and ECS doesn't kill the task.

import path from "node:path";
import url from "node:url";
import express from "express";
import compression from "compression";
import morgan from "morgan";
import { createRequestHandler } from "@react-router/express";

const BUILD_PATH = path.resolve("./build/server/index.js");
const PUBLIC_BUILD_DIR = path.resolve("./build/client");
const port = Number(process.env.PORT) || 3000;

const HEALTH_RE = /^\/(?:[^/?#]+\/)*health\/?(?:[?#].*)?$/;

const app = express();
app.disable("x-powered-by");

// Health check FIRST — before any middleware that could fail, and before the
// React Router handler. This must never 404 regardless of BASE_PATH.
app.use((req, res, next) => {
  if (req.method === "GET" && HEALTH_RE.test(req.url)) {
    res.status(200).type("text/plain").send("ok");
    return;
  }
  next();
});

app.use(compression());
// Static assets must be mounted under BASE_PATH. Otherwise a request for
// /full/assets/app.js falls through to the React Router handler, which has no
// matching route and throws "404 Not Found" — breaking every client bundle.
const BASE_PATH = process.env.BASE_PATH || "/";
app.use(
  path.posix.join(BASE_PATH, "assets"),
  express.static(path.join(PUBLIC_BUILD_DIR, "assets"), { immutable: true, maxAge: "1y" }),
);
app.use(BASE_PATH, express.static(PUBLIC_BUILD_DIR));
app.use(BASE_PATH, express.static("public", { maxAge: "1h" }));
app.use(morgan("tiny"));

let buildModule = null;
let buildError = null;
try {
  buildModule = await import(url.pathToFileURL(BUILD_PATH).href);
} catch (err) {
  buildError = err;
  console.error("[server] FAILED to load build — only /health will respond", err);
}

if (buildModule) {
  app.all(
    "*",
    createRequestHandler({ build: buildModule, mode: process.env.NODE_ENV }),
  );
} else {
  app.all("*", (_req, res) => {
    res.status(503).type("text/plain").send(
      `App failed to initialize: ${buildError?.message ?? "unknown"}. Check logs.`,
    );
  });
}

const server = app.listen(port, () => {
  console.info(`[server] listening port=${port} basePath=${process.env.BASE_PATH ?? "/"} buildLoaded=${Boolean(buildModule)}`);
});

["SIGTERM", "SIGINT"].forEach((signal) => {
  process.once(signal, () => server.close((err) => err && console.error(err)));
});
