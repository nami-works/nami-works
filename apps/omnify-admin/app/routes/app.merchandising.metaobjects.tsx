import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import {
  fetchMetaobjectTypes,
  fetchMetaobjectDefinitionFields,
} from "../services/price-tags/metaobject.server";
import styles from "./app.merchandising/styles.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetaobjectEntryField {
  key: string;
  value: string;
  typeName: string;
  imageUrl?: string;
}

interface MetaobjectEntryData {
  id: string;
  handle: string;
  displayName: string;
  fields: MetaobjectEntryField[];
}

interface MetaobjectBlockData {
  definitionName: string;
  displayNameKey: string;
  fieldDefs: { key: string; name: string; typeName: string; required: boolean }[];
  entries: MetaobjectEntryData[];
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const typesParam = url.searchParams.get("types") ?? "";
  const activeTypes = typesParam
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  console.info(`[merchandising:metaobjects] loader START shop=${shop} activeTypes=${activeTypes.join(",") || "(none)"}`);

  // ── Sidebar: all metaobject definitions ──────────────────────────
  let metaobjectTypes: { type: string; name: string }[] = [];
  let metaobjectError = false;
  let metaobjectErrorDetail = "";
  try {
    metaobjectTypes = await fetchMetaobjectTypes(admin);
    console.info(`[merchandising:metaobjects] loader → ${metaobjectTypes.length} metaobject types found`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[merchandising:metaobjects] loader → fetchMetaobjectTypes failed:", detail);
    metaobjectError = true;
    metaobjectErrorDetail = detail;
  }

  // ── Fetch data for each active metaobject type in parallel ───────
  const blocks: Record<string, MetaobjectBlockData> = {};

  if (activeTypes.length > 0) {
    const results = await Promise.allSettled(
      activeTypes.map(async (type) => {
        console.info(`[merchandising:metaobjects] loader → fetching type="${type}"`);
        const [defResult, entriesRes] = await Promise.all([
          fetchMetaobjectDefinitionFields(admin, type),
          fetchAllMetaobjectEntries(admin, type),
        ]);

        const typeName = metaobjectTypes.find((mt) => mt.type === type)?.name ?? type;
        console.info(`[merchandising:metaobjects] loader → type="${type}" entries=${entriesRes.length} fields=${defResult.fields.length}`);

        return {
          type,
          block: {
            definitionName: typeName,
            displayNameKey: defResult.displayNameKey,
            fieldDefs: defResult.fields.map((f) => ({
              key: f.key,
              name: f.name,
              typeName: f.typeName,
              required: f.required,
            })),
            entries: entriesRes,
          } satisfies MetaobjectBlockData,
        };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        blocks[result.value.type] = result.value.block;
      } else {
        console.error("[merchandising:metaobjects] loader → block fetch failed:", result.reason);
      }
    }
  }

  console.info(`[merchandising:metaobjects] loader DONE → blocks=${Object.keys(blocks).length}`);

  return {
    shop,
    metaobjectTypes,
    activeTypes,
    blocks,
    metaobjectError,
    metaobjectErrorDetail,
  };
};

// ---------------------------------------------------------------------------
// Paginated metaobject entries fetch (Fix C: was limited to 100)
// ---------------------------------------------------------------------------

async function fetchAllMetaobjectEntries(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  type: string,
): Promise<MetaobjectEntryData[]> {
  const entries: MetaobjectEntryData[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response: Response = await admin.graphql(
      `#graphql
      query MetaobjectEntriesWithRefs($type: String!, $after: String) {
        metaobjects(type: $type, first: 100, after: $after) {
          nodes {
            id
            handle
            displayName
            fields {
              key
              value
              type { name }
              reference {
                ... on MediaImage {
                  image { url altText }
                }
              }
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const n of data.nodes ?? []) {
      entries.push({
        id: n.id as string,
        handle: n.handle as string,
        displayName: n.displayName as string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fields: (n.fields ?? []).map((f: any) => ({
          key: f.key as string,
          value: (f.value ?? "") as string,
          typeName: (f.type?.name ?? "single_line_text_field") as string,
          imageUrl: f.reference?.image?.url as string | undefined,
        })),
      });
    }

    hasNextPage = data.pageInfo?.hasNextPage ?? false;
    cursor = data.pageInfo?.endCursor ?? null;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("_action") as string;
  console.info(`[merchandising:metaobjects] action → intent=${intent}`);

  // ── Metaobject update ────────────────────────────────────────────
  if (intent === "updateMetaobject") {
    const id = formData.get("metaobjectId") as string;
    const fieldsJson = formData.get("fields") as string;

    // Fix A: Safe JSON parse
    let fields: { key: string; value: string }[];
    try {
      fields = JSON.parse(fieldsJson);
    } catch {
      console.error(`[merchandising:metaobjects] updateMetaobject FAILED → invalid JSON`);
      return { ok: false, error: "Invalid field data" };
    }

    console.info(`[merchandising:metaobjects] updateMetaobject id=${id} fields=${fields.length}`);

    const response = await admin.graphql(
      `#graphql
      mutation MetaobjectUpdate($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject { id }
          userErrors { field message }
        }
      }`,
      { variables: { id, metaobject: { fields } } },
    );

    const json = await response.json();
    const errors = json.data?.metaobjectUpdate?.userErrors ?? [];
    if (errors.length > 0) {
      console.error(`[merchandising:metaobjects] updateMetaobject FAILED id=${id}:`, JSON.stringify(errors));
      return { ok: false, error: errors[0].message };
    }
    console.info(`[merchandising:metaobjects] updateMetaobject OK id=${id}`);
    return { ok: true, intent: "update" };
  }

  // ── Metaobject create ────────────────────────────────────────────
  if (intent === "createMetaobject") {
    const type = formData.get("type") as string;
    const fieldsJson = formData.get("fields") as string;

    // Fix A: Safe JSON parse
    let fields: { key: string; value: string }[];
    try {
      fields = JSON.parse(fieldsJson);
    } catch {
      console.error(`[merchandising:metaobjects] createMetaobject FAILED → invalid JSON`);
      return { ok: false, error: "Invalid field data" };
    }

    console.info(`[merchandising:metaobjects] createMetaobject type=${type} fields=${fields.length}`);

    const response = await admin.graphql(
      `#graphql
      mutation MetaobjectCreate($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message }
        }
      }`,
      {
        variables: {
          metaobject: {
            type,
            fields,
            capabilities: { publishable: { status: "ACTIVE" } },
          },
        },
      },
    );

    const json = await response.json();
    const errors = json.data?.metaobjectCreate?.userErrors ?? [];
    if (errors.length > 0) {
      console.error(`[merchandising:metaobjects] createMetaobject FAILED type=${type}:`, JSON.stringify(errors));
      return { ok: false, error: errors[0].message };
    }
    const newId = json.data?.metaobjectCreate?.metaobject?.id;
    console.info(`[merchandising:metaobjects] createMetaobject OK type=${type} → id=${newId}`);
    return { ok: true, intent: "create", id: newId };
  }

  // ── Metaobject delete ────────────────────────────────────────────
  if (intent === "deleteMetaobject") {
    const id = formData.get("metaobjectId") as string;
    console.info(`[merchandising:metaobjects] deleteMetaobject id=${id}`);

    const response = await admin.graphql(
      `#graphql
      mutation MetaobjectDelete($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors { field message }
        }
      }`,
      { variables: { id } },
    );

    const json = await response.json();
    const errors = json.data?.metaobjectDelete?.userErrors ?? [];
    if (errors.length > 0) {
      console.error(`[merchandising:metaobjects] deleteMetaobject FAILED id=${id}:`, JSON.stringify(errors));
      return { ok: false, error: errors[0].message };
    }
    console.info(`[merchandising:metaobjects] deleteMetaobject OK id=${id}`);
    return { ok: true, intent: "delete" };
  }

  console.warn(`[merchandising:metaobjects] action → unknown intent: ${intent}`);
  return { ok: false, error: "Unknown action" };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MerchandisingMetaobjects() {
  const data = useLoaderData<typeof loader>();
  const { t } = useTranslation("merchandising");
  const [searchParams, setSearchParams] = useSearchParams();
  const fetcher = useFetcher();

  // Sidebar select
  const [selectedType, setSelectedType] = useState("");

  // Metaobject edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});

  // Metaobject create state
  const [creatingForType, setCreatingForType] = useState<string | null>(null);
  const [createFields, setCreateFields] = useState<Record<string, string>>({});

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Banner
  const [banner, setBanner] = useState<{ tone: "success" | "critical"; message: string } | null>(null);

  const isSubmitting = fetcher.state !== "idle";

  const fetcherData = fetcher.data as { ok: boolean; error?: string; intent?: string } | undefined;

  // Handle fetcher completion
  const prevFetcherData = useState<typeof fetcherData>(undefined);
  if (fetcherData && fetcherData !== prevFetcherData[0]) {
    prevFetcherData[1](fetcherData);
    if (fetcherData.ok) {
      const msgKey =
        fetcherData.intent === "create" ? "entry.created"
        : fetcherData.intent === "delete" ? "entry.deleted"
        : "entry.saved";
      setBanner({ tone: "success", message: t(msgKey) });
      setEditingId(null);
      setCreatingForType(null);
      setDeleteConfirmId(null);
    } else if (fetcherData.error) {
      setBanner({ tone: "critical", message: fetcherData.error });
    }
  }

  // ---------------------------------------------------------------------------
  // URL param helpers
  // ---------------------------------------------------------------------------

  const addType = useCallback(
    (type: string) => {
      if (!type || data.activeTypes.includes(type)) return;
      const next = new URLSearchParams(searchParams);
      const current = next.get("types") ?? "";
      const types = current ? `${current},${type}` : type;
      next.set("types", types);
      setSearchParams(next);
    },
    [searchParams, setSearchParams, data.activeTypes],
  );

  const removeType = useCallback(
    (type: string) => {
      const next = new URLSearchParams(searchParams);
      const current = (next.get("types") ?? "").split(",").filter((t) => t.trim() !== type);
      if (current.length > 0) {
        next.set("types", current.join(","));
      } else {
        next.delete("types");
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  // ---------------------------------------------------------------------------
  // Metaobject edit helpers
  // ---------------------------------------------------------------------------

  const startEdit = useCallback((entry: MetaobjectEntryData, blockFieldDefs: MetaobjectBlockData["fieldDefs"]) => {
    setEditingId(entry.id);
    const fields: Record<string, string> = {};
    for (const f of entry.fields) {
      const def = blockFieldDefs.find((d) => d.key === f.key);
      if (def?.typeName === "file_reference") continue;
      fields[f.key] = f.value;
    }
    setEditFields(fields);
  }, []);

  const submitEdit = useCallback(() => {
    if (!editingId) return;
    const fields = Object.entries(editFields).map(([key, value]) => ({ key, value }));
    fetcher.submit(
      { _action: "updateMetaobject", metaobjectId: editingId, fields: JSON.stringify(fields) },
      { method: "post" },
    );
  }, [editingId, editFields, fetcher]);

  const startCreate = useCallback(
    (type: string) => {
      const block = data.blocks[type];
      if (!block) return;
      setCreatingForType(type);
      const fields: Record<string, string> = {};
      for (const def of block.fieldDefs) {
        if (def.typeName === "file_reference") continue;
        fields[def.key] = "";
      }
      setCreateFields(fields);
    },
    [data.blocks],
  );

  const submitCreate = useCallback(() => {
    if (!creatingForType) return;
    const fields = Object.entries(createFields)
      .filter(([, v]) => v !== "")
      .map(([key, value]) => ({ key, value }));
    fetcher.submit(
      { _action: "createMetaobject", type: creatingForType, fields: JSON.stringify(fields) },
      { method: "post" },
    );
  }, [creatingForType, createFields, fetcher]);

  const submitDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    fetcher.submit(
      { _action: "deleteMetaobject", metaobjectId: deleteConfirmId },
      { method: "post" },
    );
  }, [deleteConfirmId, fetcher]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isAlreadyAdded = data.activeTypes.includes(selectedType);

  return (
    <>
      {banner && (
        <s-banner tone={banner.tone} onDismiss={() => setBanner(null)}>
          {banner.message}
        </s-banner>
      )}

      {/* ── Type selector (inline, replaces aside sidebar) ────────── */}
      <s-section>
        <s-stack direction="block" gap="base">
          <div className={styles.locationSettingsBlock}>
            <s-box padding="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                <h2 className={styles.modalTitle}>{t("sidebar.title")}</h2>
                <div className={styles.typeSelectRow}>
                  <s-select
                    value={selectedType}
                    onChange={(e: Event) => {
                      setSelectedType((e.currentTarget as HTMLSelectElement).value);
                    }}
                  >
                    <s-option value="">{t("sidebar.selectPlaceholder")}</s-option>
                    {data.metaobjectTypes.map((mt) => (
                      <s-option key={mt.type} value={mt.type}>
                        {mt.name}
                      </s-option>
                    ))}
                  </s-select>
                  <div className={styles.addTypeRow}>
                    {!selectedType || isAlreadyAdded ? (
                      <s-button disabled key="disabled">
                        {isAlreadyAdded ? t("sidebar.alreadyAdded") : t("sidebar.addType")}
                      </s-button>
                    ) : (
                      <s-button
                        variant="primary"
                        key="add"
                        onClick={() => {
                          addType(selectedType);
                          setSelectedType("");
                        }}
                      >
                        {t("sidebar.addType")}
                      </s-button>
                    )}
                  </div>
                </div>
              </s-stack>
            </s-box>
          </div>

          {/* ── Metaobject error ──────────────────────────────────── */}
          {data.metaobjectError && (
            <s-banner tone="critical">
              {t("apiError")}
              {data.metaobjectErrorDetail && (
                <p style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
                  {data.metaobjectErrorDetail}
                </p>
              )}
            </s-banner>
          )}

          {/* ── Empty hint below selector ────────────────────────── */}
          {data.activeTypes.length === 0 && !data.metaobjectError && (
            <s-text color="subdued">{t("metaobjectsEmpty")}</s-text>
          )}

          {/* ── Metaobject blocks ─────────────────────────────────── */}
          {data.activeTypes.map((type) => {
            const block = data.blocks[type];
            if (!block) return null;

            return (
              <div key={type} className={styles.locationSettingsBlock}>
                <s-box padding="base" borderRadius="base">
                  <s-stack direction="block" gap="base">
                    {/* Block header */}
                    <div className={styles.typeBlockHeader}>
                      <h2 className={styles.modalTitle}>{block.definitionName}</h2>
                      <div className={styles.entryCardActions}>
                        <s-button variant="tertiary" onClick={() => removeType(type)}>
                          {t("block.removeBlock")}
                        </s-button>
                        <s-button variant="secondary" onClick={() => startCreate(type)}>
                          {t("block.newEntry")}
                        </s-button>
                      </div>
                    </div>

                    {/* Create form */}
                    {creatingForType === type && (
                      <div className={styles.entryCard}>
                        <div className={styles.editForm}>
                          <h3 className={styles.subSectionTitle}>{t("block.newEntry")}</h3>
                          {block.fieldDefs
                            .filter((def) => def.typeName !== "file_reference")
                            .map((def) => (
                              <div key={def.key} className={styles.editFieldGroup}>
                                <label className={styles.editFieldGroupLabel}>
                                  {def.name}
                                  {def.required && " *"}
                                </label>
                                <s-text-field
                                  value={createFields[def.key] ?? ""}
                                  onChange={(e: Event) => {
                                    const val = (e.target as HTMLInputElement).value;
                                    setCreateFields((prev) => ({ ...prev, [def.key]: val }));
                                  }}
                                />
                              </div>
                            ))}
                          <div className={styles.editActions}>
                            <s-button variant="secondary" onClick={() => setCreatingForType(null)}>
                              {t("entry.cancel")}
                            </s-button>
                            {isSubmitting ? (
                              <s-button loading disabled key="creating">
                                {t("entry.creating")}
                              </s-button>
                            ) : (
                              <s-button variant="primary" onClick={submitCreate} key="create">
                                {t("entry.create")}
                              </s-button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Entry cards */}
                    {block.entries.length === 0 && creatingForType !== type && (
                      <s-text color="subdued">{t("block.noEntries")}</s-text>
                    )}

                    {block.entries.map((entry) => (
                      <div key={entry.id} className={styles.entryCard}>
                        {editingId === entry.id ? (
                          /* Edit mode */
                          <div className={styles.editForm}>
                            {block.fieldDefs.map((def) => {
                              if (def.typeName === "file_reference") {
                                const field = entry.fields.find((f) => f.key === def.key);
                                return (
                                  <div key={def.key} className={styles.editFieldGroup}>
                                    <label className={styles.editFieldGroupLabel}>
                                      {def.name} ({t("entry.imageReadOnly")})
                                    </label>
                                    {field?.imageUrl ? (
                                      <img src={field.imageUrl} alt="" className={styles.entryFieldImage} />
                                    ) : (
                                      <s-text color="subdued">{field?.value || "\u2014"}</s-text>
                                    )}
                                  </div>
                                );
                              }
                              return (
                                <div key={def.key} className={styles.editFieldGroup}>
                                  <label className={styles.editFieldGroupLabel}>
                                    {def.name}
                                    {def.required && " *"}
                                  </label>
                                  <s-text-field
                                    value={editFields[def.key] ?? ""}
                                    onChange={(e: Event) => {
                                      const val = (e.target as HTMLInputElement).value;
                                      setEditFields((prev) => ({ ...prev, [def.key]: val }));
                                    }}
                                  />
                                </div>
                              );
                            })}
                            <div className={styles.editActions}>
                              <s-button variant="secondary" onClick={() => setEditingId(null)}>
                                {t("entry.cancel")}
                              </s-button>
                              {isSubmitting ? (
                                <s-button loading disabled key="saving">
                                  {t("entry.saving")}
                                </s-button>
                              ) : (
                                <s-button variant="primary" onClick={submitEdit} key="save">
                                  {t("entry.save")}
                                </s-button>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* View mode */
                          <>
                            <div className={styles.entryCardHeader}>
                              <span className={styles.entryCardTitle}>
                                {entry.displayName || entry.handle}
                              </span>
                              <div className={styles.entryCardActions}>
                                <s-button
                                  variant="tertiary"
                                  onClick={() => startEdit(entry, block.fieldDefs)}
                                >
                                  {t("entry.edit")}
                                </s-button>
                                <s-button
                                  variant="tertiary"
                                  tone="critical"
                                  onClick={() => {
                                    setDeleteConfirmId(entry.id);
                                    document.getElementById("delete-confirm-modal")?.setAttribute("open", "");
                                  }}
                                >
                                  {t("entry.delete")}
                                </s-button>
                              </div>
                            </div>
                            {entry.fields.map((f) => {
                              const def = block.fieldDefs.find((d) => d.key === f.key);
                              return (
                                <div key={f.key} className={styles.entryFieldRow}>
                                  <span className={styles.entryFieldLabel}>{def?.name ?? f.key}</span>
                                  <span className={styles.entryFieldValue}>
                                    {f.typeName === "file_reference" && f.imageUrl ? (
                                      <img src={f.imageUrl} alt="" className={styles.entryFieldImage} />
                                    ) : (
                                      f.value || "\u2014"
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    ))}
                  </s-stack>
                </s-box>
              </div>
            );
          })}
        </s-stack>
      </s-section>

      {/* ── Delete confirmation modal ────────────────────────────── */}
      <s-modal id="delete-confirm-modal" heading={t("entry.deleteTitle")}>
        <p>{t("entry.deleteConfirm")}</p>
        <div slot="footer" className={styles.editActions}>
          <s-button
            variant="secondary"
            onClick={() => {
              setDeleteConfirmId(null);
              document.getElementById("delete-confirm-modal")?.removeAttribute("open");
            }}
          >
            {t("entry.cancel")}
          </s-button>
          {isSubmitting ? (
            <s-button variant="primary" tone="critical" loading disabled key="deleting">
              {t("entry.deleting")}
            </s-button>
          ) : (
            <s-button
              variant="primary"
              tone="critical"
              key="delete"
              onClick={() => {
                submitDelete();
                document.getElementById("delete-confirm-modal")?.removeAttribute("open");
              }}
            >
              {t("entry.delete")}
            </s-button>
          )}
        </div>
      </s-modal>
    </>
  );
}
