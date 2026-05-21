import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import {
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { prisma } from "../apps/connector/src/db/prisma.js";

const VALID_BRANDS = ["cpg-labs"] as const;
type BrandInput = (typeof VALID_BRANDS)[number];

const BRAND_TO_PRISMA: Record<BrandInput, "cpg_labs"> = {
  "cpg-labs": "cpg_labs",
};

const SLUG_RE = /^[a-z0-9-]+$/;
const SHOP_RE = /^[a-z0-9-]+\.myshopify\.com$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IG_USER_ID_RE = /^17841\d{8,15}$/;

function die(message: string, code = 1): never {
  console.error(`[provision-tenant] ${message}`);
  process.exit(code);
}

function errorName(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "name" in err) {
    return String((err as { name: unknown }).name);
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    brand: { type: "string" },
    "display-name": { type: "string" },
    shop: { type: "string" },
    contact: { type: "string" },
    notes: { type: "string" },
    "aws-region": { type: "string" },
    "ig-user-id": { type: "string" },
    "ig-username": { type: "string" },
  },
  strict: true,
});

const slug = values.slug;
const brandInput = values.brand;
const displayName = values["display-name"];
const shop = values.shop;
const contact = values.contact;
const notes = values.notes;
const region = values["aws-region"] ?? process.env.AWS_REGION;
const igUserId = values["ig-user-id"];
const igUsername = values["ig-username"];

if (!slug || !SLUG_RE.test(slug)) {
  die("--slug is required and must match /^[a-z0-9-]+$/");
}
if (
  !brandInput ||
  !(VALID_BRANDS as readonly string[]).includes(brandInput)
) {
  die(`--brand is required and must be one of: ${VALID_BRANDS.join(", ")}`);
}
if (!displayName) die("--display-name is required");
if (!contact || !EMAIL_RE.test(contact)) {
  die("--contact is required and must be a valid email");
}
if (shop && !SHOP_RE.test(shop)) {
  die("--shop must match *.myshopify.com");
}
if (igUserId && !IG_USER_ID_RE.test(igUserId)) {
  die("--ig-user-id must match /^17841\\d{8,15}$/ (Instagram Business Account ID format)");
}
if (!region) {
  die("AWS region missing (pass --aws-region or set AWS_REGION env var)");
}

const brand = brandInput as BrandInput;
const prismaBrand = BRAND_TO_PRISMA[brand];
const ssmPrefix = `/nami-works/tenants/${slug}`;

const ssm = new SSMClient({ region });

// Sanity-probe AWS: a GetParameter on a non-existent path proves creds reach
// SSM and are authorized. ParameterNotFound is the expected happy path.
try {
  await ssm.send(
    new GetParameterCommand({ Name: `/nami-works/_probe/${slug}` }),
  );
} catch (err) {
  if (errorName(err) !== "ParameterNotFound") {
    die(
      `AWS SSM not reachable: ${errorName(err) ?? "Error"}: ${errorMessage(err)}`,
    );
  }
}

const existing = await prisma.integrationTenant.findUnique({ where: { slug } });
if (existing) {
  die(`tenant "${slug}" already exists (id=${existing.id})`);
}

const bearer = randomBytes(48).toString("base64url");
const bearerTokenHash = createHash("sha256").update(bearer).digest("hex");

const tenant = await prisma.integrationTenant.create({
  data: {
    slug,
    displayName,
    brand: prismaBrand,
    shopifyShop: shop ?? null,
    bearerTokenHash,
    ssmPrefix,
    status: "active",
    contactEmail: contact,
    notes: notes ?? null,
  },
});

// Atomic Instagram link — if --ig-user-id was passed, the tenant arrives
// with the InstagramAccount row already in place. The first operator who
// opens claude.ai sees Instagram pre-wired (modulo the SSM token, which
// still has to be set with a real value before refresh works).
if (igUserId) {
  await prisma.instagramAccount.create({
    data: {
      tenantId: tenant.id,
      igUserId,
      ...(igUsername ? { username: igUsername } : {}),
    },
  });
}

const paramsToWrite = [
  `${ssmPrefix}/shopify/access_token`,
  `${ssmPrefix}/omie/app_key`,
  `${ssmPrefix}/omie/app_secret`,
  `${ssmPrefix}/google_drive/service_account_json`,
  ...(igUserId
    ? [
        `${ssmPrefix}/instagram/long_lived_token`,
        `${ssmPrefix}/instagram/token_expires_at`,
      ]
    : []),
];

const failed: { name: string; reason: string }[] = [];
for (const name of paramsToWrite) {
  try {
    await ssm.send(
      new PutParameterCommand({
        Name: name,
        Value: "REPLACE_ME",
        Type: "SecureString",
        Overwrite: false,
      }),
    );
  } catch (err) {
    if (errorName(err) === "ParameterAlreadyExists") {
      console.warn(
        `[provision-tenant] ${name} already exists — leaving untouched.`,
      );
      continue;
    }
    failed.push({
      name,
      reason: `${errorName(err) ?? "Error"}: ${errorMessage(err)}`,
    });
  }
}

const line = "=".repeat(72);
console.log(`
${line}
Tenant provisioned: ${tenant.slug} (brand=${brand}, status=${tenant.status})
SSM namespace:      ${ssmPrefix}

Bearer (SHOWN ONCE — save to password manager now):
  ${bearer}

Next steps:
  1. Fill the ${paramsToWrite.length} SSM placeholders with real values:
       ${paramsToWrite.join("\n       ")}
  2. In claude.ai org settings, register the custom connector:
       URL:    https://mcp.nami.works/${tenant.slug}
       Bearer: <the value above>
${igUserId ? `  3. Instagram Business Account already linked (igUserId=${igUserId}${igUsername ? `, @${igUsername}` : ""}).
     Once the long-lived token is set in SSM, the tenant can call
     instagram_refresh_ingest from claude.ai to pull their media.\n` : ""}${line}
`);

await prisma.$disconnect();

if (failed.length > 0) {
  console.error(
    `\nSome SSM writes failed. DB row is created; finish these manually:\n`,
  );
  for (const f of failed) {
    console.error(`  - ${f.name}: ${f.reason}`);
  }
  console.error(`\nExample command:
  aws ssm put-parameter --region ${region} \\
    --name ${paramsToWrite[0]} \\
    --value REPLACE_ME --type SecureString
`);
  process.exit(2);
}
