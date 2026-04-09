type AdminClient = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export interface MetaobjectType {
  type: string;
  name: string;
}

export interface MetaobjectEntry {
  handle: string;
  gid: string;
  displayName: string;
}

export async function fetchMetaobjectTypes(
  admin: AdminClient,
): Promise<MetaobjectType[]> {
  const response = await admin.graphql(
    `#graphql
    query MetaobjectDefinitions {
      metaobjectDefinitions(first: 50) {
        edges {
          node {
            type
            name
          }
        }
      }
    }`,
  );

  const json = await response.json();

  // Surface GraphQL-level errors (e.g. missing scopes) instead of silently returning []
  if (json.errors?.length) {
    const msg = json.errors.map((e: any) => e.message).join("; ");
    console.error("[metaobject] GraphQL errors in MetaobjectDefinitions:", msg);
    throw new Error(msg);
  }

  const edges = json.data?.metaobjectDefinitions?.edges ?? [];

  return edges.map((edge: any) => ({
    type: edge.node.type,
    name: edge.node.name,
  }));
}

export async function fetchMetaobjectEntries(
  admin: AdminClient,
  type: string,
): Promise<MetaobjectEntry[]> {
  const entries: MetaobjectEntry[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query MetaobjectEntries($type: String!, $after: String) {
        metaobjects(type: $type, first: 100, after: $after) {
          edges {
            node {
              id
              handle
              displayName
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`,
      { variables: { type, after: cursor } },
    );

    const json = await response.json();
    const data = json.data?.metaobjects;

    if (!data) break;

    for (const edge of data.edges) {
      entries.push({
        handle: edge.node.handle,
        gid: edge.node.id,
        displayName: edge.node.displayName,
      });
    }

    hasNextPage = data.pageInfo.hasNextPage;
    cursor = data.pageInfo.endCursor;
  }

  return entries;
}

export function buildHandleGidMap(
  entries: MetaobjectEntry[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    map.set(entry.handle, entry.gid);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Metaobject definition field introspection
// ---------------------------------------------------------------------------

export interface MetaobjectFieldDef {
  key: string;
  name: string;
  typeName: string;
  required: boolean;
  isDisplayName: boolean;
}

export async function fetchMetaobjectDefinitionFields(
  admin: AdminClient,
  type: string,
): Promise<{ fields: MetaobjectFieldDef[]; displayNameKey: string }> {
  const response = await admin.graphql(
    `#graphql
    query MetaobjectDefinitionFields($type: String!) {
      metaobjectDefinitionByType(type: $type) {
        displayNameKey
        fieldDefinitions {
          key
          name
          type { name }
          required
        }
      }
    }`,
    { variables: { type } },
  );

  const json = await response.json();
  const def = json.data?.metaobjectDefinitionByType;
  if (!def) {
    console.warn(`[metaobject] fetchMetaobjectDefinitionFields → definition not found for type="${type}"`);
    return { fields: [], displayNameKey: "" };
  }

  const displayNameKey: string = def.displayNameKey ?? "";
  const fields: MetaobjectFieldDef[] = (def.fieldDefinitions ?? []).map(
    (f: any) => ({
      key: f.key,
      name: f.name,
      typeName: f.type?.name ?? "single_line_text_field",
      required: f.required ?? false,
      isDisplayName: f.key === displayNameKey,
    }),
  );

  return { fields, displayNameKey };
}

// ---------------------------------------------------------------------------
// Shared ensureMetaobjectEntry — creates or finds a metaobject entry
// ---------------------------------------------------------------------------

export async function ensureMetaobjectEntry(
  admin: AdminClient,
  metaobjectType: string,
  handle: string,
  labelText: string,
  cache: Map<string, string>,
  fieldDefaults: Record<string, string>,
  displayNameKey: string,
): Promise<{ gid: string; created: boolean }> {
  const alreadyCached = cache.has(handle);

  // Build fields dynamically from saved defaults
  const fields: Array<{ key: string; value: string }> = [];
  const addedKeys = new Set<string>();

  // Add display-name field with the label text
  if (displayNameKey) {
    fields.push({ key: displayNameKey, value: labelText });
    addedKeys.add(displayNameKey);
  }

  // Add all other field defaults
  for (const [key, value] of Object.entries(fieldDefaults)) {
    if (!addedKeys.has(key) && value !== "") {
      fields.push({ key, value });
      addedKeys.add(key);
    }
  }

  // Always upsert — ensures status is ACTIVE even if the metaobject already exists as draft
  const response = await admin.graphql(
    `#graphql
    mutation MetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
      metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
        metaobject { id }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        handle: { type: metaobjectType, handle },
        metaobject: { fields, capabilities: { publishable: { status: "ACTIVE" } } },
      },
    },
  );

  const json = await response.json();
  const result = json.data?.metaobjectUpsert;
  if (result?.userErrors?.length > 0) {
    console.error(`[price-tags] metaobjectUpsert FAILED:`, JSON.stringify(result.userErrors));
    throw new Error(result.userErrors[0].message);
  }
  if (!result?.metaobject?.id) {
    console.error(`[price-tags] metaobjectUpsert returned no metaobject:`, JSON.stringify(json));
    throw new Error("metaobjectUpsert returned no metaobject ID");
  }

  const gid = result.metaobject.id as string;
  const created = !alreadyCached;
  cache.set(handle, gid);
  console.log(`[price-tags] ensureMetaobjectEntry handle=${handle} → ${gid} (${created ? "created" : "activated"})`);
  return { gid, created };
}
