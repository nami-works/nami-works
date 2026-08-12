// Production server. Simplified vs. omnify-admin's server.mjs — no
// BASE_PATH complexity (single app identity, no multi-brand routing).
import path from "node:path";
import express from "express";
import compression from "compression";
import morgan from "morgan";
import { createRequestHandler } from "@react-router/express";

const BUILD_PATH = path.resolve("./build/server/index.js");
const PUBLIC_BUILD_DIR = path.resolve("./build/client");
const port = Number(process.env.PORT) || 3100;

const app = express();
app.disable("x-powered-by");

// Health check first, before anything that could fail — same lesson
// codified in omnify-admin's server.mjs after a real production incident.
app.get("/health", (_req, res) => res.status(200).type("text/plain").send("ok"));

app.use(compression());
app.use("/assets", express.static(path.join(PUBLIC_BUILD_DIR, "assets"), { immutable: true, maxAge: "1y" }));
app.use(express.static(PUBLIC_BUILD_DIR, { maxAge: "1h" }));
app.use(morgan("tiny"));
app.all("*", createRequestHandler({ build: await import(BUILD_PATH) }));

app.listen(port, () => console.log(`sales-whatsapp listening on ${port}`));
