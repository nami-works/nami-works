type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export interface ThemeInfo {
  id: string;
  name: string;
}

export interface ThemeSettingsField {
  key: string;
  value: unknown;
  section?: string;
}

export interface ThemeSchemaField {
  id: string;
  label: string;
  type: string;
  default?: unknown;
  info?: string;
}

export interface ThemeSchemaSection {
  name: string;
  settings: ThemeSchemaField[];
}

// ---------------------------------------------------------------------------
// Get the published (main) theme
// ---------------------------------------------------------------------------

export async function getMainTheme(admin: AdminClient): Promise<ThemeInfo | null> {
  const response = await admin.graphql(
    `#graphql
    query MainTheme {
      themes(roles: [MAIN], first: 1) {
        nodes {
          id
          name
        }
      }
    }`,
  );

  const json = await response.json();
  const nodes = json.data?.themes?.nodes ?? [];
  if (nodes.length === 0) {
    console.warn("[merchandising] getMainTheme → no published theme found");
    return null;
  }
  console.log(`[merchandising] getMainTheme → ${nodes[0].name} (${nodes[0].id})`);
  return { id: nodes[0].id, name: nodes[0].name };
}

// ---------------------------------------------------------------------------
// Read settings_data.json and settings_schema.json from a theme
// ---------------------------------------------------------------------------

export async function getThemeSettingsAndSchema(
  admin: AdminClient,
  themeId: string,
): Promise<{ settingsData: Record<string, unknown> | null; settingsSchema: ThemeSchemaSection[] }> {
  const response = await admin.graphql(
    `#graphql
    query ThemeSettings($themeId: ID!) {
      theme(id: $themeId) {
        files(filenames: ["config/settings_data.json", "config/settings_schema.json"]) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }`,
    { variables: { themeId } },
  );

  const json = await response.json();
  const files = json.data?.theme?.files?.nodes ?? [];
  console.log(`[merchandising] getThemeSettingsAndSchema → ${files.length} file(s) returned for theme ${themeId}`);

  let settingsData: Record<string, unknown> | null = null;
  let settingsSchema: ThemeSchemaSection[] = [];

  for (const file of files) {
    const content = file.body?.content;
    if (!content) continue;

    try {
      // Shopify theme files may contain JS-style comments (/* ... */ and // ...)
      const cleaned = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
      if (file.filename === "config/settings_data.json") {
        settingsData = JSON.parse(cleaned);
      } else if (file.filename === "config/settings_schema.json") {
        const raw = JSON.parse(cleaned);
        settingsSchema = parseSettingsSchema(raw);
      }
    } catch (err) {
      console.error(`[merchandising] Failed to parse ${file.filename}:`, err);
    }
  }

  const settingsKeyCount = settingsData ? Object.keys(extractSettingsValues(settingsData)).length : 0;
  console.log(`[merchandising] getThemeSettingsAndSchema → ${settingsKeyCount} setting values, ${settingsSchema.length} schema sections`);
  return { settingsData, settingsSchema };
}

// ---------------------------------------------------------------------------
// Parse settings_schema.json into structured sections
// ---------------------------------------------------------------------------

function parseSettingsSchema(raw: unknown): ThemeSchemaSection[] {
  if (!Array.isArray(raw)) return [];

  const sections: ThemeSchemaSection[] = [];

  for (const block of raw) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;

    // Schema blocks with a "name" and "settings" are sections
    if (b.name && Array.isArray(b.settings)) {
      sections.push({
        name: b.name as string,
        settings: (b.settings as Record<string, unknown>[])
          .filter((s) => s.type !== "header" && s.id)
          .map((s) => ({
            id: s.id as string,
            label: (s.label ?? s.id) as string,
            type: (s.type ?? "text") as string,
            default: s.default,
            info: s.info as string | undefined,
          })),
      });
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Extract flat settings values from settings_data.json
// ---------------------------------------------------------------------------

export function extractSettingsValues(
  settingsData: Record<string, unknown>,
): Record<string, unknown> {
  // settings_data.json has structure: { current: { ... values ... } }
  // or { current: "theme-name", presets: { "theme-name": { ... } } }
  const current = settingsData.current;

  if (typeof current === "object" && current !== null) {
    return current as Record<string, unknown>;
  }

  // If current is a string, it's a preset name
  if (typeof current === "string") {
    const presets = settingsData.presets as Record<string, unknown> | undefined;
    if (presets && typeof presets[current] === "object") {
      return presets[current] as Record<string, unknown>;
    }
  }

  return {};
}

// ---------------------------------------------------------------------------
// Extract numeric theme ID from GID for theme editor URL
// ---------------------------------------------------------------------------

export function themeIdToNumeric(gid: string): string {
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : gid;
}
