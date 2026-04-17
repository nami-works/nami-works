// Campaigns tab — route-agnostic React component.
// Mounted today by app.retail-goals.tsx; portable to a standalone /app/campaigns
// route later without changes.
//
// Receives loader data + fetchers via props. Doesn't import react-router loader
// primitives itself; the hosting route passes everything in.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./campaigns.module.css";
import sharedStyles from "./styles.module.css";
import { formatCurrencyCompact } from "../../i18n/format";
import type {
  CampaignGoalView,
  CampaignMatchRule,
  CampaignProgressView,
} from "../../campaign-goals/types";
import type { RetailLocation } from "../../sales-goals/classification";

// ─── Props ───────────────────────────────────────────────────────────────────

export type CampaignsTabProps = {
  locations: RetailLocation[];
  campaigns: CampaignGoalView[];
  progressByCampaignId: Record<string, CampaignProgressView>;
  currencyCode: string;
  onSubmit: (payload: FormData) => void;
  isSubmitting: boolean;
};

// ─── Sub-components ──────────────────────────────────────────────────────────

type MatchRuleType =
  | "lineItemTag"
  | "lineItemSku"
  | "lineItemProductId"
  | "lineItemProperty"
  | "orderTag";

const parseMatchRuleForForm = (rule: CampaignMatchRule) => {
  if (rule.type === "lineItemProperty") {
    return {
      type: rule.type,
      values: "",
      propertyKey: rule.key,
      propertyValue: rule.value ?? "",
    };
  }
  if (
    rule.type === "lineItemTag" ||
    rule.type === "lineItemSku" ||
    rule.type === "lineItemProductId" ||
    rule.type === "orderTag"
  ) {
    return {
      type: rule.type,
      values: rule.values.join(", "),
      propertyKey: "",
      propertyValue: "",
    };
  }
  // any/all composites collapse to a placeholder for V1; user can re-enter.
  return { type: "lineItemTag" as const, values: "", propertyKey: "", propertyValue: "" };
};

const buildMatchRuleFromForm = (form: {
  type: MatchRuleType;
  values: string;
  propertyKey: string;
  propertyValue: string;
}): CampaignMatchRule => {
  if (form.type === "lineItemProperty") {
    return {
      type: "lineItemProperty",
      key: form.propertyKey.trim(),
      value: form.propertyValue.trim() || undefined,
    };
  }
  const vals = form.values
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return { type: form.type, values: vals };
};

// ─── Campaign progress card ──────────────────────────────────────────────────

const ProgressBar = ({ pct }: { pct: number }) => (
  <div className={styles.progressBar}>
    <div
      className={styles.progressFill}
      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
    />
  </div>
);

const CampaignCard = ({
  campaign,
  progress,
  locale,
  onArchive,
  onEdit,
}: {
  campaign: CampaignGoalView;
  progress: CampaignProgressView | undefined;
  locale: string;
  onArchive: () => void;
  onEdit: () => void;
}) => {
  const { t } = useTranslation("campaigns");
  const [expanded, setExpanded] = useState(
    campaign.status === "active" || campaign.status === "draft",
  );

  const overallAch = progress?.overallAchievementPercent ?? 0;
  const paceTargetPct = (progress?.elapsedFraction ?? 0) * 100;
  const attachPct =
    progress?.overallAttachRate != null
      ? progress.overallAttachRate * 100
      : null;

  const daysInfo = (() => {
    if (!progress) return "";
    if (campaign.status === "ended" || campaign.status === "archived") {
      return t("ended");
    }
    const pct = Math.round(progress.elapsedFraction * 100);
    return t("paceInfo", { pct });
  })();

  const totalTarget = campaign.targets.reduce((s, t) => s + t.targetOrders, 0);

  return (
    <div className={styles.campaignCard} data-status={campaign.status}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleGroup}>
          <h3 className={styles.cardTitle}>{campaign.name}</h3>
          <span
            className={`${styles.statusBadge} ${styles[`status-${campaign.status}`] ?? ""}`}
          >
            {t(`status.${campaign.status}`)}
          </span>
          <span className={styles.cardDateRange}>
            {campaign.startDate} → {campaign.endDate}
          </span>
          {daysInfo ? (
            <span className={styles.cardPace}>{daysInfo}</span>
          ) : null}
        </div>
        <div className={styles.cardHeaderActions}>
          <button
            type="button"
            className={styles.cardToggle}
            onClick={() => setExpanded((p) => !p)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        </div>
      </div>

      <div className={styles.cardHeadline}>
        <span className={styles.cardHeadlineNumber}>
          {progress?.totalMatched ?? 0} / {totalTarget}
        </span>
        <span className={styles.cardHeadlineAch}>
          {progress?.overallAchievementPercent != null
            ? `${overallAch.toFixed(0)}%`
            : "—"}
        </span>
        <span className={styles.cardHeadlinePace}>
          {t("targetPaceLabel")} {paceTargetPct.toFixed(0)}%
        </span>
        {attachPct != null ? (
          <span className={styles.cardHeadlineAttach}>
            {t("attachLabel")} {attachPct.toFixed(1)}%
          </span>
        ) : null}
      </div>

      <ProgressBar pct={overallAch} />

      {expanded ? (
        <>
          <div className={styles.perLocationTable}>
            <div className={styles.perLocationHeader}>
              <span>{t("col.location")}</span>
              <span>{t("col.progress")}</span>
              <span>{t("col.achievement")}</span>
              <span>{t("col.bar")}</span>
              <span>{t("col.attach")}</span>
            </div>
            {(progress?.perLocation ?? []).map((row) => {
              const achPct = row.achievementPercent ?? 0;
              const achChipClass =
                row.achievementPercent == null
                  ? styles.chipNeutral
                  : achPct >= 100
                    ? styles.chipUp
                    : achPct >= paceTargetPct
                      ? styles.chipNeutral
                      : styles.chipDown;
              return (
                <div
                  key={row.locationId}
                  className={styles.perLocationRow}
                >
                  <span>{row.locationName}</span>
                  <span>
                    {row.matchedOrders}/{row.targetOrders}
                  </span>
                  <span className={achChipClass}>
                    {row.achievementPercent != null
                      ? `${achPct.toFixed(0)}%`
                      : "—"}
                  </span>
                  <span>
                    <ProgressBar pct={achPct} />
                  </span>
                  <span>
                    {row.attachRate != null
                      ? `${(row.attachRate * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
          <div className={styles.cardFooter}>
            <span className={styles.cardFooterNote}>
              {t("baselineNote")}:{" "}
              {campaign.targets.some((t) => t.baselineOrders != null)
                ? campaign.targets
                    .filter((t) => t.baselineOrders != null)
                    .map(
                      (t) =>
                        `${t.locationName} ${formatCurrencyCompact(
                          t.baselineOrders ?? 0,
                          "",
                          locale,
                        )}`,
                    )
                    .join(" · ")
                : t("noBaseline")}
            </span>
            <div className={styles.cardFooterActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={onEdit}
              >
                {t("actions.edit")}
              </button>
              {campaign.status !== "archived" ? (
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={onArchive}
                >
                  {t("actions.archive")}
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

// ─── Wizard (create + edit) ──────────────────────────────────────────────────

type WizardDraft = {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  matchRuleType: MatchRuleType;
  matchRuleValues: string;
  matchRulePropertyKey: string;
  matchRulePropertyValue: string;
  targets: Record<string, { targetOrders: string; baselineOrders: string }>;
};

const emptyDraft = (): WizardDraft => {
  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 3600 * 1000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    name: "",
    startDate: fmt(today),
    endDate: fmt(nextWeek),
    matchRuleType: "lineItemTag",
    matchRuleValues: "",
    matchRulePropertyKey: "",
    matchRulePropertyValue: "",
    targets: {},
  };
};

const draftFromCampaign = (c: CampaignGoalView): WizardDraft => {
  const parsed = parseMatchRuleForForm(c.matchRule);
  const targets: WizardDraft["targets"] = {};
  for (const t of c.targets) {
    targets[t.locationId] = {
      targetOrders: String(t.targetOrders),
      baselineOrders: t.baselineOrders != null ? String(t.baselineOrders) : "",
    };
  }
  return {
    id: c.id,
    name: c.name,
    startDate: c.startDate,
    endDate: c.endDate,
    matchRuleType: parsed.type as MatchRuleType,
    matchRuleValues: parsed.values,
    matchRulePropertyKey: parsed.propertyKey,
    matchRulePropertyValue: parsed.propertyValue,
    targets,
  };
};

const Wizard = ({
  draft,
  setDraft,
  locations,
  onClose,
  onSave,
  isSaving,
  lockedMatchRule,
}: {
  draft: WizardDraft;
  setDraft: (d: WizardDraft) => void;
  locations: RetailLocation[];
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
  lockedMatchRule: boolean;
}) => {
  const { t } = useTranslation("campaigns");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const updateTarget = (
    locationId: string,
    field: "targetOrders" | "baselineOrders",
    value: string,
  ) => {
    setDraft({
      ...draft,
      targets: {
        ...draft.targets,
        [locationId]: {
          targetOrders: draft.targets[locationId]?.targetOrders ?? "",
          baselineOrders: draft.targets[locationId]?.baselineOrders ?? "",
          [field]: value,
        },
      },
    });
  };

  const totalTarget = Object.values(draft.targets).reduce(
    (s, t) => s + (Number(t.targetOrders) || 0),
    0,
  );

  return (
    <div className={styles.wizardBackdrop}>
      <div className={styles.wizardModal}>
        <div className={styles.wizardHeader}>
          <h2 className={styles.wizardTitle}>
            {draft.id ? t("wizard.editTitle") : t("wizard.newTitle")}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className={styles.wizardSteps}>
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className={`${styles.wizardStepDot}${step === n ? ` ${styles.wizardStepDotActive}` : ""}`}
              onClick={() => setStep(n as 1 | 2 | 3 | 4)}
            >
              {n}
            </div>
          ))}
        </div>

        {step === 1 ? (
          <div className={styles.wizardBody}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t("wizard.nameLabel")}</span>
              <input
                type="text"
                className={styles.textInput}
                value={draft.name}
                onChange={(e) =>
                  setDraft({ ...draft, name: e.currentTarget.value })
                }
                placeholder={t("wizard.namePlaceholder")}
              />
            </label>
            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  {t("wizard.startDateLabel")}
                </span>
                <input
                  type="date"
                  className={styles.textInput}
                  value={draft.startDate}
                  onChange={(e) =>
                    setDraft({ ...draft, startDate: e.currentTarget.value })
                  }
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  {t("wizard.endDateLabel")}
                </span>
                <input
                  type="date"
                  className={styles.textInput}
                  value={draft.endDate}
                  onChange={(e) =>
                    setDraft({ ...draft, endDate: e.currentTarget.value })
                  }
                />
              </label>
            </div>
            <p className={styles.fieldHint}>{t("wizard.metricHint")}</p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className={styles.wizardBody}>
            {lockedMatchRule ? (
              <div className={styles.banner}>{t("wizard.matchRuleLocked")}</div>
            ) : null}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {t("wizard.matchRuleTypeLabel")}
              </span>
              <select
                className={styles.textInput}
                value={draft.matchRuleType}
                disabled={lockedMatchRule}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    matchRuleType: e.currentTarget.value as MatchRuleType,
                  })
                }
              >
                <option value="lineItemTag">
                  {t("wizard.matchRuleLineItemTag")}
                </option>
                <option value="lineItemSku">
                  {t("wizard.matchRuleLineItemSku")}
                </option>
                <option value="lineItemProductId">
                  {t("wizard.matchRuleLineItemProductId")}
                </option>
                <option value="lineItemProperty">
                  {t("wizard.matchRuleLineItemProperty")}
                </option>
                <option value="orderTag">
                  {t("wizard.matchRuleOrderTag")}
                </option>
              </select>
            </label>
            {draft.matchRuleType === "lineItemProperty" ? (
              <div className={styles.fieldRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    {t("wizard.propertyKeyLabel")}
                  </span>
                  <input
                    type="text"
                    className={styles.textInput}
                    value={draft.matchRulePropertyKey}
                    disabled={lockedMatchRule}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        matchRulePropertyKey: e.currentTarget.value,
                      })
                    }
                    placeholder="_bundle_id"
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    {t("wizard.propertyValueLabel")}
                  </span>
                  <input
                    type="text"
                    className={styles.textInput}
                    value={draft.matchRulePropertyValue}
                    disabled={lockedMatchRule}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        matchRulePropertyValue: e.currentTarget.value,
                      })
                    }
                    placeholder={t("wizard.propertyValuePlaceholder")}
                  />
                </label>
              </div>
            ) : (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  {t("wizard.matchValuesLabel")}
                </span>
                <input
                  type="text"
                  className={styles.textInput}
                  value={draft.matchRuleValues}
                  disabled={lockedMatchRule}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      matchRuleValues: e.currentTarget.value,
                    })
                  }
                  placeholder={t("wizard.matchValuesPlaceholder")}
                />
              </label>
            )}
            <p className={styles.fieldHint}>{t("wizard.matchRuleHint")}</p>
          </div>
        ) : null}

        {step === 3 ? (
          <div className={styles.wizardBody}>
            <p className={styles.fieldHint}>{t("wizard.targetsHint")}</p>
            <div className={styles.targetsTable}>
              <div className={styles.targetsHeader}>
                <span>{t("col.location")}</span>
                <span>{t("col.baseline")}</span>
                <span>{t("col.target")}</span>
              </div>
              {locations.map((loc) => {
                const row = draft.targets[loc.id] ?? {
                  targetOrders: "",
                  baselineOrders: "",
                };
                return (
                  <div key={loc.id} className={styles.targetsRow}>
                    <span>{loc.name}</span>
                    <input
                      type="number"
                      min="0"
                      className={styles.numberInput}
                      value={row.baselineOrders}
                      onChange={(e) =>
                        updateTarget(
                          loc.id,
                          "baselineOrders",
                          e.currentTarget.value,
                        )
                      }
                      placeholder="—"
                    />
                    <input
                      type="number"
                      min="0"
                      className={styles.numberInput}
                      value={row.targetOrders}
                      onChange={(e) =>
                        updateTarget(
                          loc.id,
                          "targetOrders",
                          e.currentTarget.value,
                        )
                      }
                      placeholder="0"
                    />
                  </div>
                );
              })}
            </div>
            <p className={styles.fieldHint}>
              {t("wizard.totalTargetLabel")}: <strong>{totalTarget}</strong>
            </p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className={styles.wizardBody}>
            <div className={styles.reviewBlock}>
              <h4>{t("wizard.reviewHeading")}</h4>
              <dl className={styles.reviewList}>
                <dt>{t("wizard.nameLabel")}</dt>
                <dd>{draft.name || "—"}</dd>
                <dt>{t("wizard.dateRangeLabel")}</dt>
                <dd>
                  {draft.startDate} → {draft.endDate}
                </dd>
                <dt>{t("wizard.matchRuleTypeLabel")}</dt>
                <dd>{draft.matchRuleType}</dd>
                <dt>{t("wizard.matchValuesLabel")}</dt>
                <dd>
                  {draft.matchRuleType === "lineItemProperty"
                    ? `${draft.matchRulePropertyKey}=${draft.matchRulePropertyValue || "*"}`
                    : draft.matchRuleValues || "—"}
                </dd>
                <dt>{t("wizard.totalTargetLabel")}</dt>
                <dd>{totalTarget}</dd>
              </dl>
            </div>
          </div>
        ) : null}

        <div className={styles.wizardFooter}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={onClose}
            disabled={isSaving}
          >
            {t("actions.cancel")}
          </button>
          <div className={styles.wizardNav}>
            {step > 1 ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setStep((step - 1) as 1 | 2 | 3)}
                disabled={isSaving}
              >
                {t("actions.back")}
              </button>
            ) : null}
            {step < 4 ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => setStep((step + 1) as 2 | 3 | 4)}
                disabled={step === 1 && draft.name.trim().length === 0}
              >
                {t("actions.next")}
              </button>
            ) : (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={onSave}
                disabled={isSaving || totalTarget === 0}
              >
                {isSaving ? t("actions.saving") : t("actions.save")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main export ─────────────────────────────────────────────────────────────

export function CampaignsTab({
  locations,
  campaigns,
  progressByCampaignId,
  onSubmit,
  isSubmitting,
}: CampaignsTabProps) {
  const { t, i18n } = useTranslation("campaigns");
  const locale = i18n.language;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDraft, setWizardDraft] = useState<WizardDraft>(emptyDraft());
  const [wizardLockedMatchRule, setWizardLockedMatchRule] = useState(false);

  const activeCampaigns = useMemo(
    () => campaigns.filter((c) => c.status === "active" || c.status === "draft"),
    [campaigns],
  );
  const pastCampaigns = useMemo(
    () =>
      campaigns.filter(
        (c) => c.status === "ended" || c.status === "archived",
      ),
    [campaigns],
  );

  const openNewWizard = () => {
    setWizardDraft(emptyDraft());
    setWizardLockedMatchRule(false);
    setWizardOpen(true);
  };

  const openEditWizard = (c: CampaignGoalView) => {
    setWizardDraft(draftFromCampaign(c));
    setWizardLockedMatchRule(c.status === "active" || c.status === "ended");
    setWizardOpen(true);
  };

  const submitWizard = () => {
    const targetsPayload = locations
      .map((loc) => {
        const row = wizardDraft.targets[loc.id];
        const target = Number(row?.targetOrders ?? 0) || 0;
        const baselineStr = (row?.baselineOrders ?? "").trim();
        return {
          locationId: loc.id,
          locationName: loc.name,
          targetOrders: target,
          baselineOrders: baselineStr === "" ? null : Number(baselineStr) || 0,
        };
      })
      .filter((t) => t.targetOrders > 0);

    const matchRule = buildMatchRuleFromForm({
      type: wizardDraft.matchRuleType,
      values: wizardDraft.matchRuleValues,
      propertyKey: wizardDraft.matchRulePropertyKey,
      propertyValue: wizardDraft.matchRulePropertyValue,
    });

    const fd = new FormData();
    fd.append("intent", wizardDraft.id ? "update-campaign" : "create-campaign");
    if (wizardDraft.id) fd.append("id", wizardDraft.id);
    fd.append("name", wizardDraft.name);
    fd.append("startDate", wizardDraft.startDate);
    fd.append("endDate", wizardDraft.endDate);
    fd.append("metric", "bundle_orders");
    fd.append("matchRule", JSON.stringify(matchRule));
    fd.append("targets", JSON.stringify(targetsPayload));
    onSubmit(fd);
    setWizardOpen(false);
  };

  const archiveCampaign = (id: string) => {
    const fd = new FormData();
    fd.append("intent", "archive-campaign");
    fd.append("id", id);
    onSubmit(fd);
  };

  return (
    <div className={styles.campaignsTab}>
      <div className={styles.tabHeader}>
        <h2 className={sharedStyles.sectionTitle}>{t("pageHeading")}</h2>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={openNewWizard}
        >
          {t("actions.newCampaign")}
        </button>
      </div>

      {activeCampaigns.length === 0 ? (
        <div className={styles.emptyState}>
          <p>{t("emptyState")}</p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={openNewWizard}
          >
            {t("actions.newCampaign")}
          </button>
        </div>
      ) : (
        <div className={styles.cardList}>
          {activeCampaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              progress={progressByCampaignId[c.id]}
              locale={locale}
              onArchive={() => archiveCampaign(c.id)}
              onEdit={() => openEditWizard(c)}
            />
          ))}
        </div>
      )}

      {pastCampaigns.length > 0 ? (
        <div className={styles.pastSection}>
          <h3 className={sharedStyles.subSectionTitle}>{t("pastCampaigns")}</h3>
          <div className={styles.pastList}>
            {pastCampaigns.map((c) => {
              const progress = progressByCampaignId[c.id];
              const totalTarget = c.targets.reduce(
                (s, t) => s + t.targetOrders,
                0,
              );
              const matched = progress?.totalMatched ?? 0;
              const ach =
                totalTarget > 0 ? ((matched / totalTarget) * 100).toFixed(0) : "—";
              return (
                <div key={c.id} className={styles.pastRow}>
                  <span className={styles.pastName}>{c.name}</span>
                  <span className={styles.pastDate}>
                    {c.startDate} → {c.endDate}
                  </span>
                  <span className={styles.pastResult}>
                    {matched} / {totalTarget} ({ach}%)
                  </span>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => openEditWizard(c)}
                  >
                    {t("actions.view")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {wizardOpen ? (
        <Wizard
          draft={wizardDraft}
          setDraft={setWizardDraft}
          locations={locations}
          onClose={() => setWizardOpen(false)}
          onSave={submitWizard}
          isSaving={isSubmitting}
          lockedMatchRule={wizardLockedMatchRule}
        />
      ) : null}
    </div>
  );
}
