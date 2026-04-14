import { useEffect, useState } from "react";
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

function formatTime(campaign: Campaign): string {
  const fmt = (d: Date | string | null) => {
    if (!d) return "";
    const date = new Date(d);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    }) + ", " + date.toLocaleTimeString("en-US", {
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

function formatDateForInput(d: Date | string | null): { date: string; time: string } {
  if (!d) return { date: "", time: "" };
  const date = new Date(d);
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toTimeString().slice(0, 5),
  };
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

  // Banner
  const [banner, setBanner] = useState<
    { tone: "success" | "critical" | "warning"; message: string } | null
  >(null);

  // Activate modal (used for both draft and scheduled)
  const [activateTarget, setActivateTarget] = useState<Campaign | null>(null);
  const [hasEndDate, setHasEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  // Deactivate confirmation
  const [deactivateTarget, setDeactivateTarget] = useState<Campaign | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  const tzOffset = (() => {
    const offset = new Date().getTimezoneOffset();
    const sign = offset <= 0 ? "+" : "-";
    const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
    return `${sign}${hours}`;
  })();

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

  // Surface delete completion (no payload — redirects).
  useEffect(() => {
    if (deleteFetcher.state === "idle" && deleteFetcher.data === undefined && deleteTarget === null) {
      // No-op: nothing to surface.
    }
  }, [deleteFetcher.state, deleteFetcher.data, deleteTarget]);

  const openActivateModal = (campaign: Campaign) => {
    setActivateTarget(campaign);
    const existing = formatDateForInput(campaign.endAt);
    setHasEndDate(!!campaign.endAt);
    setEndDate(existing.date);
    setEndTime(existing.time);
    requestAnimationFrame(() => {
      document.getElementById("sale-activate-modal")?.setAttribute("open", "");
    });
  };

  const closeActivateModal = () => {
    document.getElementById("sale-activate-modal")?.removeAttribute("open");
    setActivateTarget(null);
  };

  const submitActivate = () => {
    if (!activateTarget) return;
    const isScheduled = activateTarget.status === "scheduled";
    const formData = new FormData();
    formData.set("_action", "activate");
    if (isScheduled) formData.set("startNow", "true");
    if (hasEndDate && endDate) {
      const value = endTime ? `${endDate}T${endTime}` : `${endDate}T23:59`;
      formData.set("endAt", value);
    }
    activateFetcher.submit(formData, {
      method: "POST",
      action: `/app/merchandising/sale/${activateTarget.id}`,
    });
    closeActivateModal();
  };

  const openDeactivateModal = (campaign: Campaign) => {
    setDeactivateTarget(campaign);
    requestAnimationFrame(() => {
      document.getElementById("sale-deactivate-modal")?.setAttribute("open", "");
    });
  };

  const closeDeactivateModal = () => {
    document.getElementById("sale-deactivate-modal")?.removeAttribute("open");
    setDeactivateTarget(null);
  };

  const submitDeactivate = () => {
    if (!deactivateTarget) return;
    const formData = new FormData();
    formData.set("_action", "deactivate");
    deactivateFetcher.submit(formData, {
      method: "POST",
      action: `/app/merchandising/sale/${deactivateTarget.id}`,
    });
    closeDeactivateModal();
  };

  const openDeleteModal = (campaign: Campaign) => {
    setDeleteTarget(campaign);
    requestAnimationFrame(() => {
      document.getElementById("sale-delete-modal")?.setAttribute("open", "");
    });
  };

  const closeDeleteModal = () => {
    document.getElementById("sale-delete-modal")?.removeAttribute("open");
    setDeleteTarget(null);
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
    closeDeleteModal();
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
    if (campaign.status === "expired" || campaign.status === "cancelled") return;
    if (campaign.status === "active") {
      openDeactivateModal(campaign);
    } else {
      // draft or scheduled
      openActivateModal(campaign);
    }
  };

  const formatDateOnly = (d: Date | string | null) => {
    if (!d) return "";
    return new Date(d).toLocaleDateString(undefined, {
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
                  const toggleDisabled =
                    campaign.status === "expired" || campaign.status === "cancelled";
                  const popoverId = `sale-row-actions-${campaign.id}`;
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
                        <div className={styles.rowActionsMenu}>
                          <s-button
                            variant="tertiary"
                            icon="menu-horizontal"
                            accessibilityLabel={t("campaigns.rowActions")}
                            commandFor={popoverId}
                            command="--toggle"
                          />
                          <s-popover id={popoverId}>
                            <s-menu accessibilityLabel={t("campaigns.rowActions")}>
                              <s-button
                                commandFor={popoverId}
                                command="--hide"
                                onClick={() => submitDuplicate(campaign)}
                              >
                                {t("campaigns.actionDuplicate")}
                              </s-button>
                              <s-button
                                tone="critical"
                                commandFor={popoverId}
                                command="--hide"
                                onClick={() => openDeleteModal(campaign)}
                              >
                                {t("campaigns.actionDelete")}
                              </s-button>
                            </s-menu>
                          </s-popover>
                        </div>
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
      {activateTarget && (
        <s-modal
          id="sale-activate-modal"
          heading={
            activateTarget.status === "scheduled"
              ? t("campaigns.startNowModalTitle")
              : t("campaigns.activateModalTitle")
          }
        >
          <div style={{ padding: "16px" }}>
            {activateTarget.status === "scheduled" ? (
              <div className={styles.modalBanner}>
                {t("campaigns.startNowModalBanner", {
                  name: activateTarget.name,
                  date: formatDateOnly(activateTarget.startAt),
                })}
              </div>
            ) : (
              <div className={styles.modalBody}>
                {t("campaigns.activateModalBody", { name: activateTarget.name })}
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
                <div>
                  <label className={styles.dateTimeLabel}>{t("campaigns.endDate")}</label>
                  <div className={styles.dateTimeInputWrap}>
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className={styles.dateTimeIcon}>
                      <path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v1h4V3a1 1 0 1 1 2 0v1h1a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1ZM5 9v7h10V9H5Z" />
                    </svg>
                    <input
                      type="date"
                      className={styles.dateTimeInput}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label className={styles.dateTimeLabel}>
                    {t("campaigns.endTime")} ({tzOffset})
                  </label>
                  <div className={styles.dateTimeInputWrap}>
                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className={styles.dateTimeIcon}>
                      <path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.75 3.75v4.5l3.1 1.86a.75.75 0 1 1-.77 1.28l-3.46-2.07a.75.75 0 0 1-.37-.65V5.75a.75.75 0 0 1 1.5 0Z" />
                    </svg>
                    <input
                      type="time"
                      className={styles.dateTimeInput}
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div slot="footer" className={styles.modalFooter}>
            <div className={styles.modalActions} style={{ marginLeft: "auto" }}>
              <s-button variant="secondary" onClick={closeActivateModal}>
                {t("campaigns.cancel")}
              </s-button>
              <s-button variant="primary" onClick={submitActivate}>
                {t("campaigns.activateButton")}
              </s-button>
            </div>
          </div>
        </s-modal>
      )}

      {/* Deactivate confirmation modal */}
      {deactivateTarget && (
        <s-modal
          id="sale-deactivate-modal"
          heading={t("campaigns.confirmDeactivateTitle")}
        >
          <div style={{ padding: "16px" }}>
            {t("campaigns.confirmDeactivateBody", { name: deactivateTarget.name })}
          </div>
          <div slot="footer" className={styles.modalFooter}>
            <div className={styles.modalActions} style={{ marginLeft: "auto" }}>
              <s-button variant="secondary" onClick={closeDeactivateModal}>
                {t("campaigns.cancel")}
              </s-button>
              <s-button variant="primary" tone="critical" onClick={submitDeactivate}>
                {t("campaigns.deactivate")}
              </s-button>
            </div>
          </div>
        </s-modal>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <s-modal
          id="sale-delete-modal"
          heading={t("campaigns.deleteTitle")}
        >
          <div style={{ padding: "16px" }}>
            {t("campaigns.deleteConfirm")}
          </div>
          <div slot="footer" className={styles.modalFooter}>
            <div className={styles.modalActions} style={{ marginLeft: "auto" }}>
              <s-button variant="secondary" onClick={closeDeleteModal}>
                {t("campaigns.cancel")}
              </s-button>
              <s-button variant="primary" tone="critical" onClick={submitDelete}>
                {t("campaigns.delete")}
              </s-button>
            </div>
          </div>
        </s-modal>
      )}
    </>
  );
}
