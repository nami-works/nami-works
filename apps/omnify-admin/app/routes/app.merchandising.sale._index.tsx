import { useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import styles from "./app.merchandising/styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const campaigns = await prisma.bulkPriceCampaign.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  return { campaigns };
};

type Campaign = Awaited<ReturnType<typeof loader>>["campaigns"][number];

const STATUS_CLASSES: Record<string, string> = {
  active: styles.statusActive ?? "",
  scheduled: styles.statusScheduled ?? "",
  expired: styles.statusOther ?? "",
  draft: styles.statusDraft ?? "",
  cancelled: styles.statusCancelled ?? "",
};

const BR_TZ = "America/Sao_Paulo";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toLocalDateParts(d: Date | string | null | undefined): { date: string; time: string } {
  if (!d) return { date: "", time: "" };
  const date = typeof d === "string" ? new Date(d) : d;
  return {
    date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}`,
  };
}

function toServerIso(date: string, time: string | undefined, fallbackTime: string): string {
  if (!date) return "";
  const t = time && /^\d{2}:\d{2}$/.test(time) ? time : fallbackTime;
  return `${date}T${t}:00-03:00`;
}

function formatTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function formatTime(campaign: Campaign): string {
  const fmt = (d: Date | string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleString("en-US", {
      timeZone: BR_TZ,
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const start = `Start: ${fmt(campaign.startAt)}`;
  if (campaign.endAt) {
    return `${start}\nEnd: ${fmt(campaign.endAt)}`;
  }
  return start;
}

export default function CampaignsList() {
  const { campaigns } = useLoaderData<typeof loader>();
  const { t } = useTranslation("merchandising");
  const navigate = useNavigate();
  const [filter, setFilter] = useState<string>("all");

  // Action fetchers — one per action to keep statuses isolated.
  const activateFetcher = useFetcher();
  const deactivateFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const duplicateFetcher = useFetcher();

  // Modal refs — Polaris <s-modal> uses imperative showOverlay/hideOverlay.
  const activateModalRef = useRef<any>(null);
  const deactivateModalRef = useRef<any>(null);
  const deleteModalRef = useRef<any>(null);

  // Banner
  const [banner, setBanner] = useState<
    { tone: "success" | "critical" | "warning"; message: string } | null
  >(null);

  // Activate modal target (used for both draft and scheduled)
  const [activateTarget, setActivateTarget] = useState<Campaign | null>(null);
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  const [deactivateTarget, setDeactivateTarget] = useState<Campaign | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  // Surface activate result.
  useEffect(() => {
    const data = activateFetcher.data as any;
    if (!data || activateFetcher.state !== "idle") return;
    if (data.intent !== "activate") return;
    const errs: string[] = Array.isArray(data.errors) ? data.errors : [];
    if (data.ok && errs.length === 0) {
      setBanner({
        tone: "success",
        message: t("campaigns.activateSuccess", {
          products: data.productCount ?? 0,
          variants: data.variantCount ?? 0,
        }),
      });
    } else if (data.ok && errs.length > 0) {
      setBanner({
        tone: "warning",
        message: t("campaigns.activatePartial", {
          products: data.productCount ?? 0,
          variants: data.variantCount ?? 0,
          errors: errs.join("; "),
        }),
      });
    } else {
      setBanner({
        tone: "critical",
        message: t("campaigns.activateFailed", {
          errors: errs.length > 0 ? errs.join("; ") : t("campaigns.unknownError"),
        }),
      });
    }
  }, [activateFetcher.data, activateFetcher.state, t]);

  // Surface deactivate result.
  useEffect(() => {
    const data = deactivateFetcher.data as any;
    if (!data || deactivateFetcher.state !== "idle") return;
    if (data.intent !== "deactivate") return;
    const errs: string[] = Array.isArray(data.errors) ? data.errors : [];
    if (data.ok && errs.length === 0) {
      setBanner({
        tone: "success",
        message: t("campaigns.deactivateSuccess", { reverted: data.reverted ?? 0 }),
      });
    } else {
      setBanner({
        tone: "critical",
        message: t("campaigns.deactivateFailed", {
          errors: errs.length > 0 ? errs.join("; ") : t("campaigns.unknownError"),
        }),
      });
    }
  }, [deactivateFetcher.data, deactivateFetcher.state, t]);

  const openActivateModal = (campaign: Campaign) => {
    setActivateTarget(campaign);
    // Expired campaigns: ignore the stale past endAt — user must set a fresh one
    // or leave it unchecked for no end date.
    const staleEnd = campaign.status === "expired" || !campaign.endAt;
    if (staleEnd) {
      setHasEndDate(false);
      setEndDate("");
      setEndTime("");
    } else {
      const existing = toLocalDateParts(campaign.endAt);
      setHasEndDate(true);
      setEndDate(existing.date);
      setEndTime(existing.time);
    }
    activateModalRef.current?.showOverlay?.();
  };

  const submitActivate = () => {
    if (!activateTarget) return;
    // Anything that isn't already 'active' goes through startNow so the
    // activation backdates startAt to now (covers draft, scheduled, expired).
    const formData = new FormData();
    formData.set("_action", "activate");
    formData.set("startNow", "true");
    // Always send endAt so the server overwrites any stale value:
    // empty string = clear, ISO string = set.
    formData.set("endAt", hasEndDate && endDate ? toServerIso(endDate, endTime, "23:59") : "");
    activateFetcher.submit(formData, {
      method: "POST",
      action: `/app/merchandising/sale/${activateTarget.id}`,
    });
    activateModalRef.current?.hideOverlay?.();
  };

  const openDeactivateModal = (campaign: Campaign) => {
    setDeactivateTarget(campaign);
    deactivateModalRef.current?.showOverlay?.();
  };

  const submitDeactivate = () => {
    if (!deactivateTarget) return;
    const formData = new FormData();
    formData.set("_action", "deactivate");
    deactivateFetcher.submit(formData, {
      method: "POST",
      action: `/app/merchandising/sale/${deactivateTarget.id}`,
    });
    deactivateModalRef.current?.hideOverlay?.();
  };

  const openDeleteModal = (campaign: Campaign) => {
    setDeleteTarget(campaign);
    deleteModalRef.current?.showOverlay?.();
  };

  const submitDelete = () => {
    if (!deleteTarget) return;
    const formData = new FormData();
    formData.set("_action", "delete");
    deleteFetcher.submit(formData, {
      method: "POST",
      action: `/app/merchandising/sale/${deleteTarget.id}`,
    });
    setBanner({ tone: "success", message: t("campaigns.deletedSuccess") });
    deleteModalRef.current?.hideOverlay?.();
  };

  const submitDuplicate = (campaign: Campaign) => {
    const formData = new FormData();
    formData.set("_action", "duplicate");
    duplicateFetcher.submit(formData, {
      method: "POST",
      action: `/app/merchandising/sale/${campaign.id}`,
    });
  };

  const filtered = filter === "all"
    ? campaigns
    : campaigns.filter((c) => c.status === filter);

  const counts = {
    all: campaigns.length,
    active: campaigns.filter((c) => c.status === "active").length,
    scheduled: campaigns.filter((c) => c.status === "scheduled").length,
    expired: campaigns.filter((c) => c.status === "expired").length,
  };

  const handleToggleClick = (campaign: Campaign) => {
    if (campaign.status === "cancelled") return;
    if (campaign.status === "active") {
      openDeactivateModal(campaign);
    } else {
      // draft, scheduled, or expired — all route through the activate modal.
      // For expired, the modal acts like a restart: reschedules startAt = now
      // and lets the user set a fresh end date.
      openActivateModal(campaign);
    }
  };

  const formatDateOnly = (d: Date | string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleString(undefined, {
      timeZone: BR_TZ,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <>
      <s-section>
        {banner && (
          <s-banner tone={banner.tone} dismissible onDismiss={() => setBanner(null)}>
            {banner.message}
          </s-banner>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginBottom: "16px" }}>
          <s-button
            variant="secondary"
            onClick={() => navigate("/app/merchandising/sale/quick-apply")}
          >
            {t("campaigns.quickApplyTags")}
          </s-button>
          <s-button
            variant="primary"
            onClick={() => navigate("/app/merchandising/sale/new")}
          >
            {t("campaigns.createSale")}
          </s-button>
        </div>

        <div className={styles.campaignFilterTabs}>
          {(["all", "active", "scheduled", "expired"] as const).map((tab) => (
            <button
              key={tab}
              className={`${styles.campaignFilterTab} ${filter === tab ? styles.campaignFilterTabActive : ""}`}
              onClick={() => setFilter(tab)}
            >
              {t(`campaigns.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)} ({counts[tab]})
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <p>{t("campaigns.noResults")}</p>
          </div>
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeader}>
                  <th>{t("campaigns.colName")}</th>
                  <th>{t("campaigns.colType")}</th>
                  <th>{t("campaigns.colStatus")}</th>
                  <th>{t("campaigns.colProducts")}</th>
                  <th>{t("campaigns.colTime")}</th>
                  <th>{t("campaigns.colTags")}</th>
                  <th aria-label={t("campaigns.rowActions")}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((campaign) => {
                  const isOn = campaign.status === "active";
                  const toggleDisabled = campaign.status === "cancelled";
                  const menuId = `sale-row-menu-${campaign.id}`;
                  return (
                    <tr
                      key={campaign.id}
                      className={`${styles.tableRow} ${styles.campaignRow}`}
                      onClick={() => navigate(`/app/merchandising/sale/${campaign.id}`)}
                    >
                      <td className={styles.tableCell}>
                        <div>{campaign.name}</div>
                        <div className={styles.campaignNameSub}>
                          {campaign.discountValue}%
                        </div>
                      </td>
                      <td className={styles.tableCell}>
                        {t("campaigns.bulkPriceEditor")}
                      </td>
                      <td className={styles.tableCell}>
                        <div
                          className={styles.saleStatusCell}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            className={`${styles.statusToggle}${isOn ? ` ${styles.statusToggleOn}` : ""}${toggleDisabled ? ` ${styles.statusToggleDisabled}` : ""}`}
                            role="button"
                            aria-label={isOn ? t("campaigns.toggleDeactivate") : t("campaigns.toggleActivate")}
                            aria-disabled={toggleDisabled || undefined}
                            onClick={() => !toggleDisabled && handleToggleClick(campaign)}
                          />
                          <span className={`${styles.statusBadge} ${STATUS_CLASSES[campaign.status] ?? styles.statusOther}`}>
                            {t(`campaigns.status${campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}`)}
                          </span>
                        </div>
                      </td>
                      <td className={styles.tableCell}>
                        {campaign.productCount > 0
                          ? `${campaign.productCount} (${campaign.variantCount} ${t("campaigns.variants")})`
                          : "-"}
                      </td>
                      <td className={styles.tableCell} style={{ whiteSpace: "pre-line", fontSize: "12px" }}>
                        {formatTime(campaign)}
                      </td>
                      <td className={styles.tableCell}>
                        {campaign.priceTagsEnabled ? (
                          <span style={{ color: "#008060", fontWeight: 500 }}>✓ {t("campaigns.tagsOn")}</span>
                        ) : (
                          <span style={{ color: "#6d7175" }}>— {t("campaigns.tagsOff")}</span>
                        )}
                      </td>
                      <td
                        className={`${styles.tableCell} ${styles.rowActionsCell}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <s-button
                          variant="tertiary"
                          icon="menu-horizontal"
                          accessibilityLabel={t("campaigns.rowActions")}
                          commandFor={menuId}
                        />
                        <s-menu id={menuId} accessibilityLabel={t("campaigns.rowActions")}>
                          <s-button icon="duplicate" onClick={() => submitDuplicate(campaign)}>
                            {t("campaigns.actionDuplicate")}
                          </s-button>
                          <s-button icon="delete" tone="critical" onClick={() => openDeleteModal(campaign)}>
                            {t("campaigns.actionDelete")}
                          </s-button>
                        </s-menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {/* Activate modal — used for draft (simple activate) and scheduled (start now) */}
      <s-modal
        id="sale-activate-modal"
        ref={activateModalRef}
        heading={
          activateTarget?.status === "scheduled"
            ? t("campaigns.startNowModalTitle")
            : t("campaigns.activateModalTitle")
        }
      >
        <div style={{ padding: "16px" }}>
          {activateTarget?.status === "scheduled" ? (
            <div className={styles.modalBanner}>
              {t("campaigns.startNowModalBanner", {
                name: activateTarget?.name ?? "",
                date: formatDateOnly(activateTarget?.startAt ?? null),
              })}
            </div>
          ) : (
            <div className={styles.modalBody}>
              {t("campaigns.activateModalBody", { name: activateTarget?.name ?? "" })}
            </div>
          )}

          <div
            className={styles.checkboxToggle}
            onClick={() => setHasEndDate((prev) => !prev)}
            role="button"
          >
            <s-checkbox
              checked={hasEndDate || undefined}
              onChange={() => setHasEndDate((prev) => !prev)}
            />
            {t("campaigns.setEndDate")}
          </div>

          {hasEndDate && (
            <div className={styles.dateTimeRow} style={{ marginTop: "12px" }}>
              <s-date-field
                label={t("campaigns.endDate")}
                value={endDate}
                onChange={(e: any) => setEndDate(e.currentTarget.value)}
              />
              <s-text-field
                label={`${t("campaigns.endTime")} (-03)`}
                value={endTime}
                onChange={(e: any) => setEndTime(formatTimeInput(e.currentTarget.value))}
                placeholder="23:59"
              />
            </div>
          )}
        </div>
        <div slot="footer" className={styles.modalFooter}>
          <div className={styles.modalActions} style={{ marginLeft: "auto" }}>
            <s-button variant="secondary" onClick={() => activateModalRef.current?.hideOverlay?.()}>
              {t("campaigns.cancel")}
            </s-button>
            <s-button variant="primary" onClick={submitActivate}>
              {t("campaigns.activateButton")}
            </s-button>
          </div>
        </div>
      </s-modal>

      {/* Deactivate confirmation modal */}
      <s-modal
        id="sale-deactivate-modal"
        ref={deactivateModalRef}
        heading={t("campaigns.confirmDeactivateTitle")}
      >
        <div style={{ padding: "16px" }}>
          {t("campaigns.confirmDeactivateBody", { name: deactivateTarget?.name ?? "" })}
        </div>
        <div slot="footer" className={styles.modalFooter}>
          <div className={styles.modalActions} style={{ marginLeft: "auto" }}>
            <s-button variant="secondary" onClick={() => deactivateModalRef.current?.hideOverlay?.()}>
              {t("campaigns.cancel")}
            </s-button>
            <s-button variant="primary" tone="critical" onClick={submitDeactivate}>
              {t("campaigns.deactivate")}
            </s-button>
          </div>
        </div>
      </s-modal>

      {/* Delete confirmation modal */}
      <s-modal
        id="sale-delete-modal"
        ref={deleteModalRef}
        heading={t("campaigns.deleteTitle")}
      >
        <div style={{ padding: "16px" }}>
          {t("campaigns.deleteConfirm")}
        </div>
        <div slot="footer" className={styles.modalFooter}>
          <div className={styles.modalActions} style={{ marginLeft: "auto" }}>
            <s-button variant="secondary" onClick={() => deleteModalRef.current?.hideOverlay?.()}>
              {t("campaigns.cancel")}
            </s-button>
            <s-button variant="primary" tone="critical" onClick={submitDelete}>
              {t("campaigns.delete")}
            </s-button>
          </div>
        </div>
      </s-modal>
    </>
  );
}
