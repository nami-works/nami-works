import prisma from "../../db.server";
import {
  decryptSecret,
  encryptSecret,
} from "../security/encryption.server";

const MONDAY_API_URL = "https://api.monday.com/v2";

type MondayConfig = {
  apiKey: string;
  boardIds: string[];
};

const ITEMS_QUERY = `
  query GetBoardItems($boardIds: [ID!]!, $limit: Int!) {
    boards(ids: $boardIds) {
      id
      name
      items_page(limit: $limit) {
        items {
          id
          name
          column_values {
            id
            text
            type
          }
        }
      }
    }
  }
`;

export async function saveMondayConfig(input: {
  shop: string;
  apiKey: string;
  boardIds: string[];
}): Promise<void> {
  const payload = JSON.stringify({
    apiKey: input.apiKey.trim(),
    boardIds: input.boardIds.map((b) => b.trim()).filter(Boolean),
  });
  const { ciphertext, keyVersion } = encryptSecret(payload);

  await prisma.brandIntegrationConfig.upsert({
    where: {
      shop_integrationType: { shop: input.shop, integrationType: "monday" },
    },
    create: {
      shop: input.shop,
      integrationType: "monday",
      configCipher: ciphertext,
      keyVersion,
      enabled: true,
    },
    update: {
      configCipher: ciphertext,
      keyVersion,
      enabled: true,
    },
  });
  console.info(`[tone-sources:monday] config saved shop=${input.shop}`);
}

export async function getMondayConfig(
  shop: string,
): Promise<MondayConfig | null> {
  const row = await prisma.brandIntegrationConfig.findUnique({
    where: { shop_integrationType: { shop, integrationType: "monday" } },
  });
  if (!row || !row.enabled) return null;
  try {
    const decrypted = decryptSecret(row.configCipher);
    const parsed = JSON.parse(decrypted) as MondayConfig;
    if (!parsed.apiKey || !Array.isArray(parsed.boardIds)) return null;
    return parsed;
  } catch (err) {
    console.error(`[tone-sources:monday] decrypt FAILED shop=${shop}`, err);
    return null;
  }
}

export async function ingestMonday(input: {
  shop: string;
  batchId: string;
}): Promise<{ sampled: number; skipped: number } | { error: string }> {
  const { shop, batchId } = input;
  const config = await getMondayConfig(shop);
  if (!config) {
    return { error: "Monday.com is not configured." };
  }
  if (config.boardIds.length === 0) {
    return { error: "No Monday.com boards configured." };
  }

  console.info(
    `[tone-sources:monday] ingest START shop=${shop} boards=${config.boardIds.length}`,
  );

  let response: Response;
  try {
    response = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: config.apiKey,
        "API-Version": "2024-10",
      },
      body: JSON.stringify({
        query: ITEMS_QUERY,
        variables: { boardIds: config.boardIds, limit: 200 },
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fetch failed.";
    console.error(`[tone-sources:monday] fetch FAILED shop=${shop}`, err);
    return { error: message };
  }

  if (!response.ok) {
    const text = await response.text();
    return {
      error: `Monday.com returned ${response.status}: ${text.slice(0, 200)}`,
    };
  }

  const json = (await response.json()) as {
    data?: {
      boards?: Array<{
        id: string;
        name: string;
        items_page?: {
          items?: Array<{
            id: string;
            name: string;
            column_values?: Array<{ id: string; text: string | null; type: string }>;
          }>;
        };
      }>;
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors && json.errors.length > 0) {
    return { error: json.errors.map((e) => e.message).join("; ") };
  }

  const boards = json.data?.boards ?? [];
  let sampled = 0;
  let skipped = 0;

  for (const board of boards) {
    const items = board.items_page?.items ?? [];
    for (const item of items) {
      const columnTextParts: string[] = [];
      for (const col of item.column_values ?? []) {
        if (col.text && col.text.trim().length > 0) {
          columnTextParts.push(col.text.trim());
        }
      }
      const text = [item.name, ...columnTextParts]
        .filter(Boolean)
        .join("\n")
        .trim();

      if (text.length < 30) {
        skipped += 1;
        continue;
      }

      await prisma.brandToneSource.upsert({
        where: {
          shop_sourceType_sourceId: {
            shop,
            sourceType: "monday",
            sourceId: item.id,
          },
        },
        create: {
          shop,
          sourceType: "monday",
          sourceId: item.id,
          sourceUrl: null,
          rawText: text.slice(0, 50_000),
          metaJson: { boardId: board.id, boardName: board.name, itemName: item.name },
          batchId,
        },
        update: {
          rawText: text.slice(0, 50_000),
          capturedAt: new Date(),
          batchId,
          metaJson: { boardId: board.id, boardName: board.name, itemName: item.name },
        },
      });
      sampled += 1;
    }
  }

  console.info(
    `[tone-sources:monday] ingest OK shop=${shop} sampled=${sampled} skipped=${skipped}`,
  );
  return { sampled, skipped };
}

export async function clearMondayConfig(shop: string): Promise<void> {
  await prisma.brandIntegrationConfig.deleteMany({
    where: { shop, integrationType: "monday" },
  });
  console.info(`[tone-sources:monday] config cleared shop=${shop}`);
}
