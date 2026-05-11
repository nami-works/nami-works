import "dotenv/config";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../src/db/prisma.js";
import { extractInstagramVoiceCard } from "../src/services/instagram/voice-card.js";

/**
 * Run the voice-card extractor for a tenant and persist a `VoiceCard` row.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *     npm run instagram-voice-card -- \
 *       --tenant gebeauty \
 *       [--top 30] [--recent 50] [--random 30] \
 *       [--model claude-opus-4-7] \
 *       [--print]
 *
 * Reads `InstagramPost` rows already in the DB (run instagram-dump first),
 * samples them, and calls Claude. Pass --print to dump the resulting card
 * to stdout for inspection.
 */

function die(message: string, code = 1): never {
  console.error(`[instagram-voice-card] ${message}`);
  process.exit(code);
}

const { values } = parseArgs({
  options: {
    tenant: { type: "string" },
    top: { type: "string" },
    recent: { type: "string" },
    random: { type: "string" },
    model: { type: "string" },
    print: { type: "boolean" },
  },
  strict: true,
});

const slug = values.tenant;
if (!slug) die("--tenant <slug> is required");

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey || apiKey.length < 10) die("ANTHROPIC_API_KEY env var is required");

const topN = values.top ? Number(values.top) : undefined;
const recentN = values.recent ? Number(values.recent) : undefined;
const randomN = values.random ? Number(values.random) : undefined;
const modelId = values.model;

async function main(): Promise<void> {
  const tenant = await prisma.integrationTenant.findUnique({ where: { slug: slug! } });
  if (!tenant) die(`Tenant '${slug}' not found.`);

  const anthropic = new Anthropic({ apiKey });

  const result = await extractInstagramVoiceCard({
    tenantId: tenant.id,
    prisma,
    anthropic,
    ...(topN !== undefined ? { topN } : {}),
    ...(recentN !== undefined ? { recentN } : {}),
    ...(randomN !== undefined ? { randomN } : {}),
    ...(modelId ? { modelId } : {}),
  });

  console.log("[instagram-voice-card] done");
  console.log(
    JSON.stringify(
      {
        voiceCardId: result.voiceCardId,
        corpusSize: result.corpusSize,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
      null,
      2,
    ),
  );

  if (values.print) {
    console.log("\n--- voice card ---");
    console.log(JSON.stringify(result.card, null, 2));
  }
}

main()
  .catch((err: unknown) => {
    console.error("[instagram-voice-card] failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
