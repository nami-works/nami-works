import { readFile, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSecret } from "../apps/connector/src/secrets/ssm.js";

/**
 * Populate a sandbox/<tenant>/.env from /nami-works/tenants/<tenant>/* SSM params.
 *
 * Usage:
 *   npx tsx scripts/ssm-to-env.ts --tenant gebeauty
 *   npx tsx scripts/ssm-to-env.ts --tenant gebeauty --force
 *
 * Static values in .env.example (shop domain, API version, control URL) are
 * preserved verbatim. Secrets are overlaid from SSM. Refuses to overwrite an
 * existing .env without --force.
 */

type SsmMap = Record<string, string>;

const TENANT_SSM_MAP: Record<string, SsmMap> = {
  gebeauty: {
    SHOPIFY_ADMIN_ACCESS_TOKEN:
      "/nami-works/tenants/gebeauty/shopify/access_token",
    CPG_LABS_CONTROL_TOKEN:
      "/nami-works/tenants/gebeauty/cpg-labs/control_token",
  },
};

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    force: { type: "boolean", default: false },
  },
  strict: true,
});

const tenant = values.tenant;
if (!tenant) {
  console.error("[ssm-to-env] --tenant <slug> is required");
  process.exit(1);
}

const ssmMap = TENANT_SSM_MAP[tenant];
if (!ssmMap) {
  console.error(
    `[ssm-to-env] no SSM map defined for tenant "${tenant}". Add an entry to TENANT_SSM_MAP.`,
  );
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandboxDir = resolve(repoRoot, "sandbox", tenant);
const examplePath = resolve(sandboxDir, ".env.example");
const envPath = resolve(sandboxDir, ".env");

try {
  await access(examplePath, fsConstants.R_OK);
} catch {
  console.error(`[ssm-to-env] missing template: ${examplePath}`);
  process.exit(1);
}

const envExists = await access(envPath, fsConstants.F_OK)
  .then(() => true)
  .catch(() => false);
if (envExists && !values.force) {
  console.error(
    `[ssm-to-env] ${envPath} already exists. Pass --force to overwrite.`,
  );
  process.exit(1);
}

const template = await readFile(examplePath, "utf-8");
const templateLines = template.split(/\r?\n/);

const resolvedSecrets: Record<string, string> = {};
for (const [varName, ssmPath] of Object.entries(ssmMap)) {
  console.info(`[ssm-to-env] fetch ${varName} ← ${ssmPath}`);
  try {
    resolvedSecrets[varName] = await getSecret(ssmPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ssm-to-env] failed to fetch ${ssmPath}: ${msg}`);
    process.exit(2);
  }
}

const outputLines = templateLines.map((line) => {
  const match = /^([A-Z_]+)=(.*)$/.exec(line);
  if (!match) return line;
  const [, name] = match;
  if (name && name in resolvedSecrets) {
    return `${name}=${resolvedSecrets[name]}`;
  }
  return line;
});

const output = outputLines.join("\n");
await writeFile(envPath, output, { mode: 0o600 });

console.info(
  `[ssm-to-env] wrote ${envPath} (${Object.keys(resolvedSecrets).length} secrets overlaid, mode 0600)`,
);
