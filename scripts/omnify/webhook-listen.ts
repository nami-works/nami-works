import http from "node:http";
import fs from "node:fs";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShopifyGraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

type WebhookSubscriptionNode = {
  id: string;
  topic: string;
  endpoint?: {
    __typename: string;
    callbackUrl?: string;
  };
};

type SubscriptionsQueryResult = {
  webhookSubscriptions: {
    nodes: WebhookSubscriptionNode[];
  };
};

type SubscriptionCreateResult = {
  webhookSubscriptionCreate: {
    webhookSubscription: { id: string; topic: string } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
};

type SubscriptionDeleteResult = {
  webhookSubscriptionDelete: {
    deletedWebhookSubscriptionId: string | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
};

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

// ---------------------------------------------------------------------------
// Curated webhook topics (REST format -> GraphQL enum)
// ---------------------------------------------------------------------------

const CURATED_TOPICS: Record<string, string> = {
  "orders/create": "ORDERS_CREATE",
  "orders/updated": "ORDERS_UPDATED",
  "orders/delete": "ORDERS_DELETE",
  "orders/fulfilled": "ORDERS_FULFILLED",
  "orders/paid": "ORDERS_PAID",
  "orders/cancelled": "ORDERS_CANCELLED",
  "products/create": "PRODUCTS_CREATE",
  "products/update": "PRODUCTS_UPDATE",
  "products/delete": "PRODUCTS_DELETE",
  "customers/create": "CUSTOMERS_CREATE",
  "customers/update": "CUSTOMERS_UPDATE",
  "customers/delete": "CUSTOMERS_DELETE",
  "discounts/create": "DISCOUNTS_CREATE",
  "discounts/update": "DISCOUNTS_UPDATE",
  "discounts/delete": "DISCOUNTS_DELETE",
  "discounts/redeemcode_added": "DISCOUNTS_REDEEMCODE_ADDED",
  "discounts/redeemcode_removed": "DISCOUNTS_REDEEMCODE_REMOVED",
  "checkouts/create": "CHECKOUTS_CREATE",
  "checkouts/update": "CHECKOUTS_UPDATE",
  "carts/create": "CARTS_CREATE",
  "carts/update": "CARTS_UPDATE",
  "collections/create": "COLLECTIONS_CREATE",
  "collections/update": "COLLECTIONS_UPDATE",
  "collections/delete": "COLLECTIONS_DELETE",
  "inventory_levels/connect": "INVENTORY_LEVELS_CONNECT",
  "inventory_levels/update": "INVENTORY_LEVELS_UPDATE",
  "inventory_levels/disconnect": "INVENTORY_LEVELS_DISCONNECT",
  "fulfillments/create": "FULFILLMENTS_CREATE",
  "fulfillments/update": "FULFILLMENTS_UPDATE",
  "themes/create": "THEMES_CREATE",
  "themes/update": "THEMES_UPDATE",
  "themes/delete": "THEMES_DELETE",
  "themes/publish": "THEMES_PUBLISH",
  "draft_orders/create": "DRAFT_ORDERS_CREATE",
  "draft_orders/update": "DRAFT_ORDERS_UPDATE",
  "draft_orders/delete": "DRAFT_ORDERS_DELETE",
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const shopArg = args.find((a) => a.startsWith("--shop="));
const tokenArg = args.find((a) => a.startsWith("--token="));
const topicsArg = args.find((a) => a.startsWith("--topics="));
const portArg = args.find((a) => a.startsWith("--port="));
const callbackArg = args.find((a) => a.startsWith("--callback-url="));
const allTopics = args.includes("--all");
const verbose = args.includes("--verbose");
const jsonOutput = args.includes("--json");
const listTopics = args.includes("--list-topics");
const noCleanup = args.includes("--no-cleanup");
const useNgrok = args.includes("--ngrok");

const SHOP = shopArg?.split("=")[1] || "";
const TOKEN = tokenArg?.split("=")[1] || "";
const PORT = portArg ? Number(portArg.split("=")[1]) : 9010;
const CALLBACK_URL = callbackArg?.split("=")[1] || "";

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const a = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
};

// ---------------------------------------------------------------------------
// Shopify GraphQL helper
// ---------------------------------------------------------------------------

const shopifyGraphql = async <T>(
  query: string,
  variables?: Record<string, unknown>,
) => {
  const response = await fetch(
    `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify GraphQL failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as ShopifyGraphqlResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join(", "));
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data.");
  }
  return json.data;
};

// ---------------------------------------------------------------------------
// GraphQL operations
// ---------------------------------------------------------------------------

const LIST_SUBSCRIPTIONS = `
  query WebhookSubscriptions {
    webhookSubscriptions(first: 100) {
      nodes {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
`;

const CREATE_SUBSCRIPTION = `
  mutation WebhookSubscriptionCreate(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: $webhookSubscription
    ) {
      webhookSubscription { id topic }
      userErrors { field message }
    }
  }
`;

const DELETE_SUBSCRIPTION = `
  mutation WebhookSubscriptionDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors { field message }
    }
  }
`;

// ---------------------------------------------------------------------------
// Webhook subscription management
// ---------------------------------------------------------------------------

async function listSubscriptions() {
  const data = await shopifyGraphql<SubscriptionsQueryResult>(LIST_SUBSCRIPTIONS);
  return data.webhookSubscriptions.nodes;
}

async function registerTopic(
  topicEnum: string,
  callbackUrl: string,
): Promise<string | null> {
  const data = await shopifyGraphql<SubscriptionCreateResult>(
    CREATE_SUBSCRIPTION,
    {
      topic: topicEnum,
      webhookSubscription: { callbackUrl, format: "JSON" },
    },
  );

  const errors = data.webhookSubscriptionCreate.userErrors;
  if (errors.length) {
    console.warn(
      `${a.yellow}  [warn]${a.reset} ${topicEnum}: ${errors.map((e) => e.message).join(", ")}`,
    );
    return null;
  }
  return data.webhookSubscriptionCreate.webhookSubscription?.id ?? null;
}

async function unregisterTopic(id: string) {
  try {
    await shopifyGraphql<SubscriptionDeleteResult>(DELETE_SUBSCRIPTION, { id });
  } catch (err) {
    console.warn(
      `${a.yellow}  [warn]${a.reset} Failed to delete subscription ${id}:`,
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// Payload summary
// ---------------------------------------------------------------------------

function summarizePayload(
  topic: string,
  payload: Record<string, unknown>,
): string {
  try {
    if (topic.startsWith("orders/")) {
      const name = payload.name ?? payload.order_number ?? "?";
      const total = payload.current_total_price ?? payload.total_price ?? "?";
      const currency = payload.currency ?? "";
      return `Order ${name} ($${total} ${currency})`;
    }
    if (topic.startsWith("products/")) {
      const title = payload.title ?? "?";
      const variants = Array.isArray(payload.variants) ? payload.variants : [];
      const priceInfo = variants.length > 0
        ? ` price=${variants[0].price ?? "?"} compareAt=${variants[0].compare_at_price ?? "null"}`
        : "";
      return `"${title}"${priceInfo}`;
    }
    if (topic.startsWith("customers/")) {
      const city =
        (payload.default_address as Record<string, unknown>)?.city ?? "?";
      return `customer city=${city}`;
    }
    if (topic.startsWith("discounts/")) {
      const title = payload.title ?? payload.code ?? "?";
      return `Discount "${title}"`;
    }
    if (topic.startsWith("checkouts/")) {
      const token = String(payload.token ?? "?").slice(0, 8);
      const total = payload.total_price ?? "?";
      return `token=${token}... total=$${total}`;
    }
    if (topic.startsWith("inventory_levels/")) {
      const itemId = payload.inventory_item_id ?? "?";
      const locId = payload.location_id ?? "?";
      const avail = payload.available ?? "?";
      return `item=${itemId} location=${locId} available=${avail}`;
    }
    if (topic.startsWith("fulfillments/")) {
      const status = payload.status ?? "?";
      return `status=${status}`;
    }
    if (topic.startsWith("collections/")) {
      const title = payload.title ?? "?";
      return `"${title}"`;
    }
    if (topic.startsWith("themes/")) {
      const name = payload.name ?? "?";
      const role = payload.role ?? "?";
      return `"${name}" role=${role}`;
    }
    if (topic.startsWith("draft_orders/")) {
      const name = payload.name ?? "?";
      const total = payload.total_price ?? "?";
      return `Draft ${name} ($${total})`;
    }
    // Fallback
    const keys = Object.keys(payload).slice(0, 3);
    return keys
      .map((k) => `${k}=${JSON.stringify(payload[k]).slice(0, 30)}`)
      .join(" ");
  } catch {
    return "(parse error)";
  }
}

// ---------------------------------------------------------------------------
// Ngrok tunnel
// ---------------------------------------------------------------------------

function findNgrok(): string | null {
  // Try PATH first
  try {
    execSync("ngrok version", { stdio: "ignore" });
    return "ngrok";
  } catch {
    // noop
  }

  // Try common Windows install locations
  const home = process.env.LOCALAPPDATA || "";
  if (home) {
    const wingetDir = path.join(home, "Microsoft", "WinGet", "Packages");
    try {
      const entries = fs.readdirSync(wingetDir);
      const ngrokDir = entries.find((e: string) => e.startsWith("Ngrok.Ngrok"));
      if (ngrokDir) {
        const fullPath = path.join(wingetDir, ngrokDir, "ngrok.exe");
        if (fs.existsSync(fullPath)) return fullPath;
      }
    } catch {
      // noop
    }
  }
  return null;
}

async function startNgrok(port: number): Promise<{
  process: ChildProcess;
  publicUrl: string;
}> {
  const ngrokBin = findNgrok();
  if (!ngrokBin) {
    throw new Error("ngrok not found");
  }

  const useShell = ngrokBin === "ngrok";
  const ngrokProcess = spawn(ngrokBin, ["http", String(port)], {
    stdio: "ignore",
    ...(useShell ? { shell: true } : {}),
    detached: false,
  });

  // Wait for ngrok to start and get the public URL from its local API
  const publicUrl = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("ngrok startup timed out after 10s"));
    }, 10_000);

    const poll = setInterval(async () => {
      try {
        const res = await fetch("http://127.0.0.1:4040/api/tunnels");
        const data = (await res.json()) as {
          tunnels: Array<{ public_url: string; proto: string }>;
        };
        const httpsTunnel = data.tunnels.find((t) => t.proto === "https");
        if (httpsTunnel) {
          clearTimeout(timeout);
          clearInterval(poll);
          resolve(httpsTunnel.public_url);
        }
      } catch {
        // ngrok not ready yet
      }
    }, 500);

    ngrokProcess.on("error", (err) => {
      clearTimeout(timeout);
      clearInterval(poll);
      reject(err);
    });

    ngrokProcess.on("exit", (code) => {
      clearTimeout(timeout);
      clearInterval(poll);
      reject(new Error(`ngrok exited with code ${code}`));
    });
  });

  return { process: ngrokProcess, publicUrl };
}

// ---------------------------------------------------------------------------
// Local HTTP server
// ---------------------------------------------------------------------------

function createWebhookServer(
  port: number,
  isVerbose: boolean,
  isJson: boolean,
): http.Server {
  let eventCount = 0;

  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Webhook listener active");
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");

      const body = Buffer.concat(chunks).toString("utf-8");
      const topic = req.headers["x-shopify-topic"] as string | undefined;
      const shop = req.headers["x-shopify-shop-domain"] as string | undefined;

      eventCount++;

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(body);
      } catch {
        payload = { _raw: body.slice(0, 200) };
      }

      if (isJson) {
        console.info(
          JSON.stringify({
            n: eventCount,
            topic: topic ?? "unknown",
            shop: shop ?? "unknown",
            payload,
            receivedAt: new Date().toISOString(),
          }),
        );
        return;
      }

      const time = new Date().toLocaleTimeString("en-US", { hour12: false });
      const topicDisplay = (topic ?? "unknown").padEnd(30);
      const summary = summarizePayload(topic ?? "", payload);

      console.info(
        `${a.gray}[${time}]${a.reset} ${a.cyan}${topicDisplay}${a.reset} ${a.dim}--${a.reset} ${summary}`,
      );

      if (isVerbose) {
        console.info(`${a.dim}${JSON.stringify(payload, null, 2)}${a.reset}\n`);
      }
    });
  });

  server.listen(port);
  return server;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --list-topics
  if (listTopics) {
    console.info(`\n${a.bold}  Available webhook topics:${a.reset}\n`);
    for (const [rest, gql] of Object.entries(CURATED_TOPICS)) {
      console.info(`    ${rest.padEnd(35)} ${a.dim}${gql}${a.reset}`);
    }
    console.info();
    return;
  }

  // Validate args
  if (!SHOP) {
    console.error(
      `${a.red}  Error: --shop=store.myshopify.com is required.${a.reset}`,
    );
    process.exit(1);
  }
  if (!TOKEN) {
    console.error(
      `${a.red}  Error: --token=shpat_... is required.${a.reset}`,
    );
    process.exit(1);
  }
  if (!allTopics && !topicsArg) {
    console.error(
      `${a.red}  Error: Provide --all or --topics=topic1,topic2${a.reset}`,
    );
    process.exit(1);
  }
  if (!useNgrok && !CALLBACK_URL) {
    console.error(
      `${a.red}  Error: Provide --ngrok or --callback-url=https://...${a.reset}`,
    );
    process.exit(1);
  }

  // Determine topics to register
  let requestedTopics: string[];
  if (allTopics) {
    requestedTopics = Object.keys(CURATED_TOPICS);
  } else {
    requestedTopics = topicsArg!.split("=")[1]!.split(",").map((t) => t.trim());
    for (const t of requestedTopics) {
      if (!CURATED_TOPICS[t]) {
        console.error(
          `${a.red}  Error: Unknown topic "${t}". Run with --list-topics to see options.${a.reset}`,
        );
        process.exit(1);
      }
    }
  }

  // Start local HTTP server
  const server = createWebhookServer(PORT, verbose, jsonOutput);
  console.info(
    `\n${a.bold}  Webhook Listener${a.reset} ${a.dim}-- ${SHOP}${a.reset}`,
  );
  console.info(`${a.dim}  Local server on port ${PORT}${a.reset}`);

  // Resolve public callback URL
  let callbackUrl = CALLBACK_URL;
  let ngrokProcess: ChildProcess | null = null;

  if (useNgrok) {
    if (!findNgrok()) {
      console.error(
        `${a.red}  Error: ngrok is not installed. Install it from https://ngrok.com or use --callback-url instead.${a.reset}`,
      );
      server.close();
      process.exit(1);
    }

    console.info(`${a.dim}  Starting ngrok tunnel...${a.reset}`);
    const tunnel = await startNgrok(PORT);
    ngrokProcess = tunnel.process;
    callbackUrl = tunnel.publicUrl;
    console.info(`${a.green}  Tunnel: ${callbackUrl}${a.reset}`);
  }

  // Clean up orphaned subscriptions from prior sessions
  const existing = await listSubscriptions();
  const orphans = existing.filter((s) => {
    const url = s.endpoint?.callbackUrl ?? "";
    return url.includes("ngrok") || url.includes("/webhook-listen");
  });
  if (orphans.length > 0) {
    console.info(
      `${a.yellow}  Cleaning up ${orphans.length} orphaned subscription(s)...${a.reset}`,
    );
    for (const o of orphans) {
      await unregisterTopic(o.id);
    }
  }

  // Register topics
  const registeredIds: string[] = [];
  const existingTopics = new Set(existing.map((s) => s.topic));

  for (const rest of requestedTopics) {
    const gqlEnum = CURATED_TOPICS[rest]!;

    if (existingTopics.has(gqlEnum)) {
      console.info(
        `${a.yellow}  [skip]${a.reset} ${rest} ${a.dim}(already registered by another app/config)${a.reset}`,
      );
      continue;
    }

    const id = await registerTopic(gqlEnum, callbackUrl);
    if (id) {
      registeredIds.push(id);
      console.info(
        `${a.green}  [registered]${a.reset} ${rest} ${a.dim}(${gqlEnum})${a.reset}`,
      );
    }
  }

  console.info(
    `\n${a.bold}  Listening for events...${a.reset} ${a.dim}(Ctrl+C to stop)${a.reset}\n`,
  );

  // Cleanup handler
  let cleanupDone = false;
  const cleanup = async () => {
    if (cleanupDone) return;
    cleanupDone = true;

    console.info(`\n${a.bold}  Shutting down...${a.reset}`);

    if (!noCleanup && registeredIds.length > 0) {
      for (const id of registeredIds) {
        await unregisterTopic(id);
      }
      console.info(
        `${a.green}  Unregistered ${registeredIds.length} webhook subscription(s)${a.reset}`,
      );
    }

    if (ngrokProcess) {
      ngrokProcess.kill();
      console.info(`${a.dim}  Stopped ngrok tunnel${a.reset}`);
    }

    server.close();
    console.info(`${a.bold}  Done.${a.reset}\n`);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((e) => {
  console.error(`${a.red}[webhook-listen] FATAL${a.reset}`, e);
  process.exit(1);
});
