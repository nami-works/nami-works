/**
 * Affiliates · Settings sub-tab.
 *
 * Manages the registry of "affiliate programs" — Shopify code-discount nodes
 * whose codes auto-sync hourly into AffiliateCode. The tab exposes:
 *   • A search-and-pick modal for adding a program from a Shopify discount
 *     (no GID copy-paste; query by title)
 *   • A list of program cards with re-sync, label edit, and remove actions
 *   • Soft-delete confirmation for Remove (codes stay, sync stops)
 *
 * Sibling-tab style — `<button onClick>` switches content in place. All
 * server I/O goes through `useFetcher` against the parent route's action.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";
import type { TFunction } from "i18next";
import styles from "./styles.module.css";
import type {
  AffiliateProgramSummary,
  DiscountSearchResult,
} from "../../affiliates/types";

type Props = {
  shop: string;
  programs: AffiliateProgramSummary[];
  t: TFunction<"affiliates">;
};

type SearchOk = {
  ok: true;
  intent: "programs-search-discounts";
  results: DiscountSearchResult[];
};
type SearchErr = {
  ok: false;
  intent: "programs-search-discounts";
  error: string;
};
type AddOk = { ok: true; intent: "programs-add"; programId: string };
type AddErr = { ok: false; intent: "programs-add"; error: string };
type RemoveOk = { ok: true; intent: "programs-remove" };
type RemoveErr = { ok: false; intent: "programs-remove"; error: string };
type ResyncOk = {
  ok: true;
  intent: "programs-resync";
  codesCount: number;
  mappedCount: number;
};
type ResyncErr = { ok: false; intent: "programs-resync"; error: string };

type AnyResp =
  | SearchOk
  | SearchErr
  | AddOk
  | AddErr
  | RemoveOk
  | RemoveErr
  | ResyncOk
  | ResyncErr
  | undefined;

function shopSlug(shop: string): string {
  return shop.replace(/\.myshopify\.com$/, "");
}

function discountAdminUrl(shop: string, discountNodeId: string): string {
  const id = discountNodeId.split("/").pop() ?? "";
  return `https://admin.shopify.com/store/${shopSlug(shop)}/discounts/${id}`;
}

function formatDistanceShort(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function AffiliatesSettings({
  shop,
  programs,
  t,
}: Props): React.ReactElement {
  // Local search filter for the program list (client-side).
  const [filterText, setFilterText] = useState("");

  // Add-program modal state.
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DiscountSearchResult[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchFetcher = useFetcher<AnyResp>();
  const addFetcher = useFetcher<AnyResp>();

  // Remove confirmation state.
  const [removeTarget, setRemoveTarget] = useState<AffiliateProgramSummary | null>(
    null,
  );
  const removeFetcher = useFetcher<AnyResp>();

  // Per-program resync state (which programId is currently in flight).
  const [resyncBusyId, setResyncBusyId] = useState<string | null>(null);
  const resyncFetcher = useFetcher<AnyResp>();

  // ─── Filtered list ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return programs;
    return programs.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.discountTitle.toLowerCase().includes(q),
    );
  }, [programs, filterText]);

  // ─── Discount search (debounced) ──────────────────────────────────────
  useEffect(() => {
    if (!addModalOpen) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearchLoading(true);
      const fd = new FormData();
      fd.append("intent", "programs-search-discounts");
      fd.append("query", searchQuery);
      searchFetcher.submit(fd, { method: "post" });
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, addModalOpen]);

  useEffect(() => {
    const data = searchFetcher.data;
    if (!data) return;
    if (data.intent !== "programs-search-discounts") return;
    setSearchLoading(false);
    if (data.ok) {
      setSearchResults(data.results);
    } else {
      setSearchResults([]);
    }
  }, [searchFetcher.data]);

  // ─── Add response ─────────────────────────────────────────────────────
  useEffect(() => {
    const data = addFetcher.data;
    if (!data) return;
    if (data.intent !== "programs-add") return;
    if (data.ok) {
      setAddModalOpen(false);
      setSearchQuery("");
      setSearchResults([]);
      setSelectedNodeId(null);
      setLabelDraft("");
      setAddError(null);
    } else {
      setAddError(data.error);
    }
  }, [addFetcher.data]);

  // ─── Remove response ──────────────────────────────────────────────────
  useEffect(() => {
    const data = removeFetcher.data;
    if (!data) return;
    if (data.intent !== "programs-remove") return;
    if (data.ok) {
      setRemoveTarget(null);
    }
  }, [removeFetcher.data]);

  // ─── Resync response ──────────────────────────────────────────────────
  useEffect(() => {
    const data = resyncFetcher.data;
    if (!data) return;
    if (data.intent !== "programs-resync") return;
    setResyncBusyId(null);
  }, [resyncFetcher.data]);

  const ADD_MODAL_ID = "affiliates-add-program-modal";
  const REMOVE_MODAL_ID = "affiliates-remove-program-modal";

  // ─── Modal open/close (DOM imperative) ────────────────────────────────
  // s-modal is controlled via the `open` attribute on the host element.
  useEffect(() => {
    const el = document.getElementById(ADD_MODAL_ID);
    if (!el) return;
    if (addModalOpen) el.setAttribute("open", "");
    else el.removeAttribute("open");
  }, [addModalOpen]);

  useEffect(() => {
    const el = document.getElementById(REMOVE_MODAL_ID);
    if (!el) return;
    if (removeTarget) el.setAttribute("open", "");
    else el.removeAttribute("open");
  }, [removeTarget]);

  // ─── Handlers ─────────────────────────────────────────────────────────
  function openAddModal() {
    setAddModalOpen(true);
    setSearchQuery("");
    setSearchResults([]);
    setSelectedNodeId(null);
    setLabelDraft("");
    setAddError(null);
  }
  function closeAddModal() {
    setAddModalOpen(false);
  }
  function handleSelectResult(r: DiscountSearchResult) {
    setSelectedNodeId(r.nodeId);
    if (!labelDraft.trim()) {
      setLabelDraft(r.title);
    }
  }
  function handleAddSubmit() {
    if (!selectedNodeId || !labelDraft.trim()) {
      setAddError(t("settings.addModal.selectFirst", "Select a discount and choose a label."));
      return;
    }
    const selected = searchResults.find((r) => r.nodeId === selectedNodeId);
    const fd = new FormData();
    fd.append("intent", "programs-add");
    fd.append("discountNodeId", selectedNodeId);
    fd.append("label", labelDraft.trim());
    fd.append("discountTitle", selected?.title ?? "");
    addFetcher.submit(fd, { method: "post" });
  }
  function handleRequestRemove(p: AffiliateProgramSummary) {
    setRemoveTarget(p);
  }
  function handleConfirmRemove() {
    if (!removeTarget) return;
    const fd = new FormData();
    fd.append("intent", "programs-remove");
    fd.append("programId", removeTarget.id);
    removeFetcher.submit(fd, { method: "post" });
  }
  function handleResync(programId: string) {
    setResyncBusyId(programId);
    const fd = new FormData();
    fd.append("intent", "programs-resync");
    fd.append("programId", programId);
    resyncFetcher.submit(fd, { method: "post" });
  }

  const totalCodes = programs.reduce((s, p) => s + p.codesCount, 0);
  const totalMapped = programs.reduce((s, p) => s + p.mappedCount, 0);

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div>
      <h2 className={styles.settingsHeader}>
        {t("settings.title", "Affiliate programs")}
      </h2>
      <p className={styles.settingsSubtitle}>
        {t(
          "settings.subtitle",
          "The system pulls coupon codes directly from these Shopify discounts every hour. Adding a code in Shopify makes it active here within ~1 hour, no upload needed.",
        )}
      </p>

      <div className={styles.registryHeader}>
        <div className={styles.registrySearch}>
          <s-text-field
            label={t("settings.searchPlaceholder", "Search registered programs…")}
            labelAccessibilityVisibility="exclusive"
            placeholder={t(
              "settings.searchPlaceholder",
              "Search registered programs…",
            )}
            value={filterText}
            onChange={(event: Event) =>
              setFilterText((event.currentTarget as HTMLInputElement).value)
            }
          />
        </div>
        <s-button variant="primary" onClick={openAddModal}>
          {t("settings.addProgram", "+ Add program")}
        </s-button>
      </div>

      <p className={styles.registrySummary}>
        {t("settings.summary", {
          n: programs.length,
          codes: totalCodes,
          mapped: totalMapped,
          count: programs.length,
          defaultValue:
            "{{n}} programs · {{codes}} codes synced · {{mapped}} mapped to profiles",
        })}
      </p>

      {programs.length === 0 ? (
        <div className={styles.settingsEmpty}>
          {t(
            "settings.noPrograms",
            'No affiliate programs registered yet. Click "Add program" to register a Shopify code-discount as an affiliate program.',
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.settingsEmpty}>
          {t("settings.noMatches", "No programs match your search.")}
        </div>
      ) : (
        filtered.map((p) => {
          const failed = p.lastSyncStatus === "failed";
          const lastWhen = p.lastSyncedAt
            ? formatDistanceShort(p.lastSyncedAt)
            : null;
          const busy = resyncBusyId === p.id;
          return (
            <div key={p.id} className={styles.programCard}>
              <div className={styles.programCardHeader}>
                <span className={styles.programCardLabel}>{p.label}</span>
                <span
                  className={`${styles.programBadge}${failed ? ` ${styles.programBadgeFailed}` : ""}`}
                >
                  {failed
                    ? t("settings.programCard.syncFailed", "Sync failed")
                    : t("settings.programCard.active", "Active")}
                </span>
                <span className={styles.programCardSpacer}></span>
                <span className={styles.programCardCount}>
                  {t("settings.addModal.codesCount", {
                    count: p.codesCount,
                    defaultValue: "{{count}} codes",
                  })}
                </span>
              </div>
              <div className={styles.programCardMeta}>
                {t("settings.programCard.discountLabel", "Shopify discount")}:{" "}
                <strong>{p.discountTitle || "(untitled)"}</strong>
              </div>
              <div className={`${styles.programCardMeta} ${styles.programCardMetaMono}`}>
                {p.discountNodeId}
              </div>
              <div className={styles.programCardStats}>
                {lastWhen
                  ? t("settings.programCard.lastSynced", {
                      when: lastWhen,
                      defaultValue: "Last synced {{when}}",
                    })
                  : t("settings.programCard.neverSynced", "Never synced")}
                {" · "}
                {t("settings.programCard.codesSynced", {
                  count: p.codesCount,
                  defaultValue: "{{count}} codes synced from Shopify",
                })}
                {" · "}
                {t("settings.programCard.mapped", {
                  count: p.mappedCount,
                  defaultValue: "{{count}} mapped to profiles",
                })}
              </div>
              {failed && p.lastSyncError && (
                <div className={styles.programCardError}>
                  {p.lastSyncError}
                </div>
              )}
              <div className={styles.programCardActions}>
                <a
                  className={`${styles.leftSlot} ${styles.programCardLink}`}
                  href={discountAdminUrl(shop, p.discountNodeId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("settings.programCard.openInShopify", "Open in Shopify")} ↗
                </a>
                {busy ? (
                  <s-button
                    variant="secondary"
                    loading
                    disabled
                    key={`resync-${p.id}-busy`}
                  >
                    {t("settings.programCard.resyncing", "Syncing…")}
                  </s-button>
                ) : (
                  <s-button
                    variant="secondary"
                    onClick={() => handleResync(p.id)}
                    key={`resync-${p.id}-idle`}
                  >
                    {t("settings.programCard.resync", "Re-sync now")}
                  </s-button>
                )}
                <s-button
                  variant="secondary"
                  tone="critical"
                  onClick={() => handleRequestRemove(p)}
                >
                  {t("settings.programCard.remove", "Remove")}
                </s-button>
              </div>
            </div>
          );
        })
      )}

      {/* Add-program modal */}
      <s-modal
        id={ADD_MODAL_ID}
        heading={t("settings.addModal.title", "Add affiliate program")}
      >
        <div className={styles.modalBody}>
          <div className={styles.modalFieldGroup}>
            <span className={styles.modalFieldLabel}>
              {t("settings.addModal.searchLabel", "Search Shopify code discounts")}
            </span>
            <input
              type="text"
              className={styles.modalSearchInput}
              placeholder={t(
                "settings.addModal.searchPlaceholder",
                "Type a discount title…",
              )}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
            />
          </div>

          <div className={styles.modalResults}>
            {searchLoading ? (
              <div className={styles.modalEmpty}>
                {t("settings.addModal.searching", "Searching…")}
              </div>
            ) : searchResults.length === 0 ? (
              <div className={styles.modalEmpty}>
                {t("settings.addModal.noResults", "No discounts match. Try a different search.")}
              </div>
            ) : (
              searchResults.map((r) => {
                const selected = selectedNodeId === r.nodeId;
                const statusLabel =
                  r.status === "ACTIVE"
                    ? t("settings.addModal.statusActive", "Active")
                    : r.status === "SCHEDULED"
                      ? t("settings.addModal.statusScheduled", "Scheduled")
                      : t("settings.addModal.statusExpired", "Expired");
                return (
                  <button
                    key={r.nodeId}
                    type="button"
                    className={`${styles.modalResultRow}${selected ? ` ${styles.modalResultRowSelected}` : ""}`}
                    onClick={() => handleSelectResult(r)}
                  >
                    <span className={styles.radio}></span>
                    <span>
                      <strong>{r.title}</strong>
                    </span>
                    <span className={styles.resultMeta}>
                      {statusLabel} ·{" "}
                      {t("settings.addModal.codesCount", {
                        count: r.codesCount,
                        defaultValue: "{{count}} codes",
                      })}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div className={styles.modalFieldGroupTop}>
            <span className={styles.modalFieldLabel}>
              {t("settings.addModal.labelLabel", "Program label (shown in this app)")}
            </span>
            <s-text-field
              label={t("settings.addModal.labelLabel", "Program label")}
              labelAccessibilityVisibility="exclusive"
              placeholder={t("settings.addModal.labelPlaceholder", "BixGrow UGC")}
              value={labelDraft}
              onChange={(event: Event) =>
                setLabelDraft((event.currentTarget as HTMLInputElement).value)
              }
            />
          </div>

          {addError && (
            <div className={styles.modalErrorText}>
              {addError}
            </div>
          )}
        </div>
        <s-button slot="secondary-actions" onClick={closeAddModal}>
          {t("settings.addModal.cancel", "Cancel")}
        </s-button>
        {addFetcher.state !== "idle" ? (
          <s-button
            key="add-busy"
            slot="primary-action"
            variant="primary"
            loading
            disabled
          >
            {t("settings.addModal.add", "Add program")}
          </s-button>
        ) : !selectedNodeId || !labelDraft.trim() ? (
          <s-button
            key="add-disabled"
            slot="primary-action"
            variant="primary"
            disabled
          >
            {t("settings.addModal.add", "Add program")}
          </s-button>
        ) : (
          <s-button
            key="add-ready"
            slot="primary-action"
            variant="primary"
            onClick={handleAddSubmit}
          >
            {t("settings.addModal.add", "Add program")}
          </s-button>
        )}
      </s-modal>

      {/* Remove confirmation modal */}
      <s-modal
        id={REMOVE_MODAL_ID}
        heading={t("settings.removeModal.title", "Remove program?")}
      >
        <p className={styles.removeModalText}>
          {t(
            "settings.removeModal.body",
            "Codes synced from this discount will stay in your records but will no longer be refreshed.",
          )}
        </p>
        {removeTarget && (
          <p className={styles.removeModalLabel}>
            <strong>{removeTarget.label}</strong>
          </p>
        )}
        <s-button
          slot="secondary-actions"
          onClick={() => setRemoveTarget(null)}
        >
          {t("settings.removeModal.cancel", "Cancel")}
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          onClick={handleConfirmRemove}
          loading={removeFetcher.state !== "idle" || undefined}
        >
          {t("settings.removeModal.remove", "Remove")}
        </s-button>
      </s-modal>
    </div>
  );
}
