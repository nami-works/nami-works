import { prisma } from "../../db/prisma.js";
import { rootLogger } from "../../lib/logger.js";
import { decryptSecret, encryptSecret } from "../security/encryption.js";

// Monday.com adapter. Credentials (API key + selected boards + filter rules)
// live encrypted in BrandIntegrationConfig. The 4-phase merchant onboarding
// (connect, choose columns, define filters, preview) is what produces the
// filter rules stored alongside the API key.

const MONDAY_API_URL = "https://api.monday.com/v2";

export type MondayFilterRule = {
  // Column ID, or the special "_group_" sentinel to filter by board group.
  column: string;
  op: "is_one_of" | "is_not_one_of" | "is_empty";
  values: string[];
};

export type MondayConfig = {
  apiKey: string;
  boardIds: string[];
  // Filter rules combine: multiple values inside ONE rule → OR; multiple
  // rules → AND. Items must satisfy every rule. Empty array = sample
  // everything (backward compatible with pre-filter configs).
  filters?: MondayFilterRule[];
};

export type MondayBoardSchema = {
  id: string;
  name: string;
  itemsCount: number;
  groups: Array<{ id: string; title: string }>;
  columns: Array<{
    id: string;
    title: string;
    type: string;
    filterable: boolean;
    values?: string[];
    sampledAsContent: boolean;
  }>;
};

const ITEMS_QUERY = `
  query GetBoardItems($boardIds: [ID!]!, $limit: Int!) {
    boards(ids: $boardIds) {
      id
      name
      groups {
        id
        title
      }
      items_page(limit: $limit) {
        items {
          id
          name
          group {
            id
            title
          }
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

const SCHEMA_QUERY = `
  query GetBoardSchema($boardIds: [ID!]!) {
    boards(ids: $boardIds) {
      id
      name
      items_count
      groups {
        id
        title
      }
      columns {
        id
        title
        type
        settings_str
      }
    }
  }
`;

export async function saveMondayConfig(input: {
  tenantId: string;
  tenantSlug: string;
  apiKey: string;
  boardIds: string[];
  filters?: MondayFilterRule[];
}): Promise<void> {
  const payload = JSON.stringify({
    apiKey: input.apiKey.trim(),
    boardIds: input.boardIds.map((b) => b.trim()).filter(Boolean),
    filters: input.filters ?? [],
  });
  const { ciphertext, keyVersion } = encryptSecret(payload);

  await prisma.brandIntegrationConfig.upsert({
    where: {
      tenantId_integrationType: {
        tenantId: input.tenantId,
        integrationType: "monday",
      },
    },
    create: {
      tenantId: input.tenantId,
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
  rootLogger
    .child({ tenant: input.tenantSlug, component: "tone-monday" })
    .info({ filters: input.filters?.length ?? 0 }, "config saved");
}

export async function getMondayConfig(input: {
  tenantId: string;
  tenantSlug: string;
}): Promise<MondayConfig | null> {
  const row = await prisma.brandIntegrationConfig.findUnique({
    where: {
      tenantId_integrationType: {
        tenantId: input.tenantId,
        integrationType: "monday",
      },
    },
  });
  if (!row || !row.enabled) return null;
  try {
    const decrypted = decryptSecret(row.configCipher);
    const parsed = JSON.parse(decrypted) as MondayConfig;
    if (!parsed.apiKey || !Array.isArray(parsed.boardIds)) return null;
    return {
      apiKey: parsed.apiKey,
      boardIds: parsed.boardIds,
      filters: Array.isArray(parsed.filters) ? parsed.filters : [],
    };
  } catch (err) {
    rootLogger
      .child({ tenant: input.tenantSlug, component: "tone-monday" })
      .error({ err }, "decrypt FAILED");
    return null;
  }
}

// Fetch board schema (columns, groups, item count) from Monday.com so the
// filter-builder UI can show real column names + values instead of free
// text. Status columns' labels are parsed from `settings_str` (JSON
// encoded).
export async function fetchMondaySchema(input: {
  apiKey: string;
  boardIds: string[];
}): Promise<MondayBoardSchema[] | { error: string }> {
  if (input.boardIds.length === 0) {
    return { error: "No Monday.com boards configured." };
  }

  let response: Response;
  try {
    response = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: input.apiKey,
        "API-Version": "2024-10",
      },
      body: JSON.stringify({
        query: SCHEMA_QUERY,
        variables: { boardIds: input.boardIds },
      }),
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Monday schema fetch failed.",
    };
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
        items_count?: number;
        groups?: Array<{ id: string; title: string }>;
        columns?: Array<{
          id: string;
          title: string;
          type: string;
          settings_str?: string | null;
        }>;
      }>;
    };
    errors?: Array<{ message: string }>;
  };

  if (json.errors && json.errors.length > 0) {
    return { error: json.errors.map((e) => e.message).join("; ") };
  }

  const boards = json.data?.boards ?? [];
  return boards.map((b) => ({
    id: b.id,
    name: b.name,
    itemsCount: b.items_count ?? 0,
    groups: (b.groups ?? []).map((g) => ({ id: g.id, title: g.title })),
    columns: (b.columns ?? []).map((c) => {
      const isStatus = c.type === "status" || c.type === "color";
      const isText =
        c.type === "long_text" || c.type === "text" || c.type === "name";
      let values: string[] | undefined;
      if (isStatus && c.settings_str) {
        try {
          const parsed = JSON.parse(c.settings_str) as {
            labels?: Record<string, string>;
            labels_v2?: { labels?: Array<{ name: string }> };
          };
          if (parsed.labels) {
            values = Object.values(parsed.labels).filter(Boolean);
          } else if (parsed.labels_v2?.labels) {
            values = parsed.labels_v2.labels.map((l) => l.name).filter(Boolean);
          }
        } catch {
          values = undefined;
        }
      }
      return {
        id: c.id,
        title: c.title,
        type: c.type,
        filterable: isStatus,
        ...(values !== undefined ? { values } : {}),
        sampledAsContent: isText,
      };
    }),
  }));
}

// Apply filter rules to a Monday item. Multiple rules combine with AND.
// Multiple values within a single rule combine with OR. The "_group_"
// sentinel references board groups; everything else is matched against
// column_values[].text by column id.
function itemMatchesFilters(
  item: {
    group?: { id: string; title: string } | null;
    column_values?: Array<{ id: string; text: string | null }>;
  },
  filters: MondayFilterRule[],
): boolean {
  if (filters.length === 0) return true;
  for (const rule of filters) {
    let actualValue: string | null = null;
    if (rule.column === "_group_") {
      actualValue = item.group?.title ?? item.group?.id ?? null;
    } else {
      const col = (item.column_values ?? []).find((c) => c.id === rule.column);
      actualValue = col?.text ?? null;
    }
    const normalized = actualValue?.trim() ?? "";

    if (rule.op === "is_empty") {
      if (normalized.length > 0) return false;
      continue;
    }
    const inSet = rule.values.some(
      (v) => v.trim().toLowerCase() === normalized.toLowerCase(),
    );
    if (rule.op === "is_one_of" && !inSet) return false;
    if (rule.op === "is_not_one_of" && inSet) return false;
  }
  return true;
}

export async function ingestMonday(input: {
  tenantId: string;
  tenantSlug: string;
  batchId: string;
}): Promise<
  { sampled: number; skipped: number; filtered: number } | { error: string }
> {
  const { tenantId, tenantSlug, batchId } = input;
  const log = rootLogger.child({
    tenant: tenantSlug,
    component: "tone-monday",
  });
  const config = await getMondayConfig({ tenantId, tenantSlug });
  if (!config) {
    return { error: "Monday.com is not configured." };
  }
  if (config.boardIds.length === 0) {
    return { error: "No Monday.com boards configured." };
  }

  log.info(
    { boards: config.boardIds.length, filters: config.filters?.length ?? 0 },
    "ingest START",
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
    log.error({ err }, "fetch FAILED");
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
        groups?: Array<{ id: string; title: string }>;
        items_page?: {
          items?: Array<{
            id: string;
            name: string;
            group?: { id: string; title: string } | null;
            column_values?: Array<{
              id: string;
              text: string | null;
              type: string;
            }>;
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
  const filters = config.filters ?? [];
  let sampled = 0;
  let skipped = 0;
  let filtered = 0;

  for (const board of boards) {
    const items = board.items_page?.items ?? [];
    for (const item of items) {
      if (!itemMatchesFilters(item, filters)) {
        filtered += 1;
        continue;
      }
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
          tenantId_sourceType_sourceId: {
            tenantId,
            sourceType: "monday",
            sourceId: item.id,
          },
        },
        create: {
          tenantId,
          sourceType: "monday",
          sourceId: item.id,
          sourceUrl: null,
          rawText: text.slice(0, 50_000),
          metaJson: {
            boardId: board.id,
            boardName: board.name,
            itemName: item.name,
            group: item.group?.title ?? null,
          },
          batchId,
        },
        update: {
          rawText: text.slice(0, 50_000),
          capturedAt: new Date(),
          batchId,
          metaJson: {
            boardId: board.id,
            boardName: board.name,
            itemName: item.name,
            group: item.group?.title ?? null,
          },
        },
      });
      sampled += 1;
    }
  }

  log.info({ sampled, skipped, filtered }, "ingest OK");
  return { sampled, skipped, filtered };
}

export async function clearMondayConfig(input: {
  tenantId: string;
  tenantSlug: string;
}): Promise<void> {
  await prisma.brandIntegrationConfig.deleteMany({
    where: { tenantId: input.tenantId, integrationType: "monday" },
  });
  rootLogger
    .child({ tenant: input.tenantSlug, component: "tone-monday" })
    .info("config cleared");
}
