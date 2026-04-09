// Prevent Prisma session storage crash from killing the process
process.on('unhandledRejection', (err) => {
  if (err && err.message && (err.message.includes('session') || err.message.includes('Prisma') || err.message.includes('database'))) {
    return; // silently ignore DB errors
  }
  console.error('[local] Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  if (err && err.message && (err.message.includes('session') || err.message.includes('Prisma') || err.message.includes('database') || err.message.includes('MissingSessionTable'))) {
    return; // silently ignore DB errors
  }
  console.error('[local] Uncaught exception:', err);
  process.exit(1);
});

const { createRequestHandler } = require("@react-router/express");
const express = require("express");
const path = require("path");

const app = express();

app.use(express.static(path.join(__dirname, "build/client")));
app.use(express.static(path.join(__dirname, "public")));

const handler = createRequestHandler({
  build: require("./build/server/index.js"),
});

app.all("*", async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (err) {
    console.error(`[local] SSR error on ${req.url}:`, err.message);
    res.status(500).send(`<h1>SSR Error</h1><p>${err.message}</p>`);
  }
});

const port = 3456;
app.listen(port, () => {
  console.log(`\nLocal preview running: http://localhost:${port}\n`);
});
