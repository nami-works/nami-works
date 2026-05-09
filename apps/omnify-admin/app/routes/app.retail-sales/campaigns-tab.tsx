// Campaigns tab — route-agnostic React component.
// Mounted by app.retail-sales.tsx; portable to a standalone /app/campaigns
// route later without changes.

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./campaigns.module.css";
import sharedStyles from "./styles.module.css";
import type {
  CampaignGoalView,
  CampaignMatchRule,
  CampaignMetric,
  CampaignProgressView,
} from "../../campaign-goals/types";
import type { RetailLocation } from "../../sales-goals/classification";

// ─── Types ──────────────────────────────────────────────────────────────────

type MatchRuleType =
  | "lineItemTag"
  | "lineItemProductType"
  | "lineItemProductId"
  | "lineItemProperty"
  | "orderTag";

type MatchOptionsFetcher = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submit: (...args: any[]) => void;
  state: string;
  data?: {
    ok: boolean;
    options?: Array<{ value: string; label: string }>;
  };
};

type BaselineFetcher = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submit: (...args: any[]) => void;
  state: string;
  data?: {
    ok: boolean;
    baseline?: Record<string, { orderCount: number; revenue: number }>;
  };
};

export type CampaignsTabProps = {
  locations: RetailLocation[];
  campaigns: CampaignGoalView[];
  progressByCampaignId: Record<string, CampaignProgressView>;
  currencyCode: string;
  onSubmit: (payload: FormData) => void;
  isSubmitting: boolean;
  matchOptionsFetcher: MatchOptionsFetcher;
  baselineFetcher: BaselineFetcher;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const METRIC_OPTIONS: CampaignMetric[] = [
  "bundle_orders",
  "specific_products",
  "specific_combination",
  "aov",
  "revenue",
];

const parseMatchRuleForForm = (rule: CampaignMatchRule) => {
  if (rule.type === "lineItemProperty") {
    return {
      type: rule.type as MatchRuleType,
      values: [] as string[],
      propertyKey: rule.key,
      propertyValue: rule.value ?? "",
    };
  }
  if (
    rule.type === "lineItemTag" ||
    rule.type === "lineItemSku" ||
    rule.type === "lineItemProductType" ||
    rule.type === "lineItemProductId" ||
    rule.type === "orderTag"
  ) {
    const mappedType: MatchRuleType =
      rule.type === "lineItemSku" ? "lineItemTag" : (rule.type as MatchRuleType);
    return {
      type: mappedType,
      values: rule.values,
      propertyKey: "",
      propertyValue: "",
    };
  }
  return {
    type: "lineItemTag" as MatchRuleType,
    values: [] as string[],
    propertyKey: "",
    propertyValue: "",
  };
};

const buildMatchRuleFromForm = (form: {
  type: MatchRuleType;
  values: string[];
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
  return { type: form.type, values: form.values };
};

const statusToBadgeTone = (
  status: string,
): "success" | "info" | undefined => {
  switch (status) {
    case "active":
      return "success";
    case "draft":
      return "info";
    default:
      return undefined;
  }
};

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ─── Campaign progress card ────────────────────────────────────────────────

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
  onArchive,
  onEdit,
}: {
  campaign: CampaignGoalView;
  progress: CampaignProgressView | undefined;
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

  const totalTarget = campaign.targets.reduce(
    (s, tgt) => s + tgt.targetOrders,
    0,
  );
  const badgeTone = statusToBadgeTone(campaign.status);

  return (
    <div className={styles.campaignCard} data-status={campaign.status}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleGroup}>
          <h3 className={styles.cardTitle}>{campaign.name}</h3>
          <s-badge tone={badgeTone || undefined}>
            {t(`status.${campaign.status}`)}
          </s-badge>
          <span className={styles.cardDateRange}>
            {campaign.startDate} → {campaign.endDate}
          </span>
          {daysInfo ? (
            <span className={styles.cardPace}>{daysInfo}</span>
          ) : null}
        </div>
        <div className={styles.cardHeaderActions}>
          <s-button
            variant="tertiary"
            onClick={() => setExpanded((p) => !p)}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▾" : "▸"}
          </s-button>
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
            <div className={styles.cardFooterActions}>
              <s-button variant="secondary" onClick={onEdit}>
                {t("actions.edit")}
              </s-button>
              {campaign.status !== "archived" ? (
                <s-button
                  variant="secondary"
                  tone="critical"
                  onClick={onArchive}
                >
                  {t("actions.archive")}
                </s-button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

// ─── Wizard state ───────────────────────────────────────────────────────────

type WizardDraft = {
  id?: string;
  name: string;
  startDate: string;
  endDate: string;
  metric: CampaignMetric;
  matchRuleType: MatchRuleType;
  matchRuleValues: string[];
  matchRulePropertyKey: string;
  matchRulePropertyValue: string;
  baselinePeriod: "none" | "last_month" | "last_quarter" | "last_year";
  targets: Record<string, { targetOrders: string; baselineOrders: string }>;
};

const emptyDraft = (): WizardDraft => {
  const today = new Date();
  const nextWeek = new Date(today.getTime() + 7 * 24 * 3600 * 1000);
  return {
    name: "",
    startDate: fmtDate(today),
    endDate: fmtDate(nextWeek),
    metric: "bundle_orders",
    matchRuleType: "lineItemTag",
    matchRuleValues: [],
    matchRulePropertyKey: "",
    matchRulePropertyValue: "",
    baselinePeriod: "none",
    targets: {},
  };
};

const draftFromCampaign = (c: CampaignGoalView): WizardDraft => {
  const parsed = parseMatchRuleForForm(c.matchRule);
  const targets: WizardDraft["targets"] = {};
  for (const tgt of c.targets) {
    targets[tgt.locationId] = {
      targetOrders: String(tgt.targetOrders),
      baselineOrders:
        tgt.baselineOrders != null ? String(tgt.baselineOrders) : "",
    };
  }
  return {
    id: c.id,
    name: c.name,
    startDate: c.startDate,
    endDate: c.endDate,
    metric: c.metric,
    matchRuleType: parsed.type,
    matchRuleValues: parsed.values,
    matchRulePropertyKey: parsed.propertyKey,
    matchRulePropertyValue: parsed.propertyValue,
    baselinePeriod: "none",
    targets,
  };
};

const WizardModalOpener = ({ open }: { open: boolean }) => {
  useEffect(() => {
    const el = document.getElementById("campaign-wizard");
    if (!el) return;
    if (open) {
      el.setAttribute("open", "");
    } else {
      el.removeAttribute("open");
    }
  }, [open]);
  return null;
};

// ─── Main export ────────────────────────────────────────────────────────────

export function CampaignsTab({
  locations,
  campaigns,
  progressByCampaignId,
  onSubmit,
  isSubmitting,
  matchOptionsFetcher,
  baselineFetcher,
}: CampaignsTabProps) {
  const { t } = useTranslation("campaigns");

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDraft, setWizardDraft] = useState<WizardDraft>(emptyDraft());
  const [wizardLockedMatchRule, setWizardLockedMatchRule] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [matchSearch, setMatchSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeCampaigns = useMemo(
    () =>
      campaigns.filter(
        (c) => c.status === "active" || c.status === "draft",
      ),
    [campaigns],
  );
  const pastCampaigns = useMemo(
    () =>
      campaigns.filter(
        (c) => c.status === "ended" || c.status === "archived",
      ),
    [campaigns],
  );

  // Fetch match options when rule type changes or search changes
  useEffect(() => {
    if (!wizardOpen || wizardStep !== 2) return;
    if (wizardDraft.matchRuleType === "lineItemProperty") return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const fd = new FormData();
      fd.append("intent", "fetch-match-options");
      fd.append("ruleType", wizardDraft.matchRuleType);
      fd.append("query", matchSearch);
      matchOptionsFetcher.submit(fd, { method: "post" });
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardDraft.matchRuleType, matchSearch, wizardOpen, wizardStep]);

  // Auto-populate baseline when period changes
  useEffect(() => {
    if (
      wizardDraft.baselinePeriod === "none" ||
      !wizardDraft.startDate ||
      !wizardDraft.endDate
    )
      return;

    const fd = new FormData();
    fd.append("intent", "fetch-campaign-baseline");
    fd.append("period", wizardDraft.baselinePeriod);
    fd.append("campaignStart", wizardDraft.startDate);
    fd.append("campaignEnd", wizardDraft.endDate);
    baselineFetcher.submit(fd, { method: "post" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardDraft.baselinePeriod, wizardDraft.startDate, wizardDraft.endDate]);

  // Apply baseline data when fetcher returns
  useEffect(() => {
    if (
      baselineFetcher.state === "idle" &&
      baselineFetcher.data?.ok &&
      baselineFetcher.data.baseline &&
      wizardDraft.baselinePeriod !== "none"
    ) {
      const baseline = baselineFetcher.data.baseline;
      const updatedTargets = { ...wizardDraft.targets };
      for (const loc of locations) {
        const data = baseline[loc.id];
        const existing = updatedTargets[loc.id] ?? {
          targetOrders: "",
          baselineOrders: "",
        };
        updatedTargets[loc.id] = {
          ...existing,
          baselineOrders: data ? String(data.orderCount) : "0",
        };
      }
      setWizardDraft((prev) => ({ ...prev, targets: updatedTargets }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baselineFetcher.state, baselineFetcher.data]);

  const matchOptions = matchOptionsFetcher.data?.options ?? [];
  const matchOptionsLoading = matchOptionsFetcher.state !== "idle";

  const openNewWizard = () => {
    setWizardDraft(emptyDraft());
    setWizardLockedMatchRule(false);
    setWizardStep(1);
    setMatchSearch("");
    setWizardOpen(true);
  };

  const openEditWizard = (c: CampaignGoalView) => {
    setWizardDraft(draftFromCampaign(c));
    setWizardLockedMatchRule(c.status === "active" || c.status === "ended");
    setWizardStep(1);
    setMatchSearch("");
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
  };

  const toggleMatchValue = (val: string) => {
    setWizardDraft((prev) => {
      const has = prev.matchRuleValues.includes(val);
      return {
        ...prev,
        matchRuleValues: has
          ? prev.matchRuleValues.filter((v) => v !== val)
          : [...prev.matchRuleValues, val],
      };
    });
  };

  const removeMatchValue = (val: string) => {
    setWizardDraft((prev) => ({
      ...prev,
      matchRuleValues: prev.matchRuleValues.filter((v) => v !== val),
    }));
  };

  const updateTarget = (
    locationId: string,
    field: "targetOrders" | "baselineOrders",
    value: string,
  ) => {
    setWizardDraft((prev) => ({
      ...prev,
      targets: {
        ...prev.targets,
        [locationId]: {
          targetOrders: prev.targets[locationId]?.targetOrders ?? "",
          baselineOrders: prev.targets[locationId]?.baselineOrders ?? "",
          [field]: value,
        },
      },
    }));
  };

  const totalTarget = Object.values(wizardDraft.targets).reduce(
    (s, tgt) => s + (Number(tgt.targetOrders) || 0),
    0,
  );

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
      .filter((tgt) => tgt.targetOrders > 0);

    const matchRule = buildMatchRuleFromForm({
      type: wizardDraft.matchRuleType,
      values: wizardDraft.matchRuleValues,
      propertyKey: wizardDraft.matchRulePropertyKey,
      propertyValue: wizardDraft.matchRulePropertyValue,
    });

    const fd = new FormData();
    fd.append(
      "intent",
      wizardDraft.id ? "update-campaign" : "create-campaign",
    );
    if (wizardDraft.id) fd.append("id", wizardDraft.id);
    fd.append("name", wizardDraft.name);
    fd.append("startDate", wizardDraft.startDate);
    fd.append("endDate", wizardDraft.endDate);
    fd.append("metric", wizardDraft.metric);
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

  const stepHeading = wizardDraft.id
    ? t("wizard.editTitle")
    : t("wizard.newTitle");

  return (
    <div className={styles.campaignsTab}>
      <div className={styles.tabHeader}>
        <h2 className={sharedStyles.sectionTitle}>{t("pageHeading")}</h2>
        <s-button variant="primary" onClick={openNewWizard}>
          {t("actions.newCampaign")}
        </s-button>
      </div>

      {activeCampaigns.length === 0 ? (
        <div className={styles.emptyState}>
          <p>{t("emptyState")}</p>
          <s-button variant="primary" onClick={openNewWizard}>
            {t("actions.newCampaign")}
          </s-button>
        </div>
      ) : (
        <div className={styles.cardList}>
          {activeCampaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              progress={progressByCampaignId[c.id]}
              onArchive={() => archiveCampaign(c.id)}
              onEdit={() => openEditWizard(c)}
            />
          ))}
        </div>
      )}

      {pastCampaigns.length > 0 ? (
        <div className={styles.pastSection}>
          <h3 className={sharedStyles.subSectionTitle}>
            {t("pastCampaigns")}
          </h3>
          <div className={styles.pastList}>
            {pastCampaigns.map((c) => {
              const progress = progressByCampaignId[c.id];
              const total = c.targets.reduce(
                (s, tgt) => s + tgt.targetOrders,
                0,
              );
              const matched = progress?.totalMatched ?? 0;
              const ach =
                total > 0
                  ? ((matched / total) * 100).toFixed(0)
                  : "—";
              return (
                <div key={c.id} className={styles.pastRow}>
                  <span className={styles.pastName}>{c.name}</span>
                  <span className={styles.pastDate}>
                    {c.startDate} → {c.endDate}
                  </span>
                  <span className={styles.pastResult}>
                    {matched} / {total} ({ach}%)
                  </span>
                  <s-button
                    variant="secondary"
                    onClick={() => openEditWizard(c)}
                  >
                    {t("actions.view")}
                  </s-button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* ── Wizard modal ──────────────────────────────────────────────────── */}

      <WizardModalOpener open={wizardOpen} />
      {wizardOpen ? (
        <s-modal id="campaign-wizard" heading={stepHeading}>
          <div className={styles.wizardBody}>
            <div className={styles.wizardSteps}>
              {([1, 2, 3, 4] as const).map((n) => (
                <div
                  key={n}
                  className={`${styles.wizardStepDot}${wizardStep === n ? ` ${styles.wizardStepDotActive}` : ""}`}
                  onClick={() => setWizardStep(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setWizardStep(n);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  {n}
                </div>
              ))}
            </div>

            {/* ── Step 1: Basic info ──────────────────────────────────────── */}
            {wizardStep === 1 ? (
              <div className={styles.stepContent}>
                <s-text-field
                  label={t("wizard.nameLabel")}
                  value={wizardDraft.name}
                  placeholder={t("wizard.namePlaceholder")}
                  onChange={(e: Event) =>
                    setWizardDraft({
                      ...wizardDraft,
                      name: (e.currentTarget as HTMLInputElement).value,
                    })
                  }
                ></s-text-field>

                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>
                      {t("wizard.startDateLabel")}
                    </span>
                    <s-date-picker
                      type="single"
                      value={wizardDraft.startDate}
                      onChange={(e: Event) =>
                        setWizardDraft({
                          ...wizardDraft,
                          startDate: (e.currentTarget as HTMLInputElement)
                            .value,
                        })
                      }
                    />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>
                      {t("wizard.endDateLabel")}
                    </span>
                    <s-date-picker
                      type="single"
                      value={wizardDraft.endDate}
                      onChange={(e: Event) =>
                        setWizardDraft({
                          ...wizardDraft,
                          endDate: (e.currentTarget as HTMLInputElement)
                            .value,
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            ) : null}

            {/* ── Step 2: Metric + Match rule ────────────────────────────── */}
            {wizardStep === 2 ? (
              <div className={styles.stepContent}>
                <s-select
                  label={t("wizard.metricLabel")}
                  value={wizardDraft.metric}
                  onChange={(e: Event) =>
                    setWizardDraft({
                      ...wizardDraft,
                      metric: (e.currentTarget as HTMLSelectElement)
                        .value as CampaignMetric,
                    })
                  }
                >
                  {METRIC_OPTIONS.map((m) => (
                    <s-option key={m} value={m}>
                      {t(`wizard.metric_${m}`)}
                    </s-option>
                  ))}
                </s-select>

                {wizardLockedMatchRule ? (
                  <div className={styles.banner}>
                    {t("wizard.matchRuleLocked")}
                  </div>
                ) : null}

                <s-select
                  label={t("wizard.matchRuleTypeLabel")}
                  value={wizardDraft.matchRuleType}
                  disabled={wizardLockedMatchRule || undefined}
                  onChange={(e: Event) => {
                    const val = (e.currentTarget as HTMLSelectElement)
                      .value as MatchRuleType;
                    setWizardDraft({
                      ...wizardDraft,
                      matchRuleType: val,
                      matchRuleValues: [],
                    });
                    setMatchSearch("");
                  }}
                >
                  <s-option value="lineItemTag">
                    {t("wizard.matchRuleLineItemTag")}
                  </s-option>
                  <s-option value="lineItemProductType">
                    {t("wizard.matchRuleLineItemProductType")}
                  </s-option>
                  <s-option value="lineItemProductId">
                    {t("wizard.matchRuleLineItemProductId")}
                  </s-option>
                  <s-option value="lineItemProperty">
                    {t("wizard.matchRuleLineItemProperty")}
                  </s-option>
                  <s-option value="orderTag">
                    {t("wizard.matchRuleOrderTag")}
                  </s-option>
                </s-select>

                {wizardDraft.matchRuleType === "lineItemProperty" ? (
                  <div className={styles.fieldRow}>
                    <s-text-field
                      label={t("wizard.propertyKeyLabel")}
                      value={wizardDraft.matchRulePropertyKey}
                      disabled={wizardLockedMatchRule || undefined}
                      placeholder="_bundle_id"
                      onChange={(e: Event) =>
                        setWizardDraft({
                          ...wizardDraft,
                          matchRulePropertyKey: (
                            e.currentTarget as HTMLInputElement
                          ).value,
                        })
                      }
                    ></s-text-field>
                    <s-text-field
                      label={t("wizard.propertyValueLabel")}
                      value={wizardDraft.matchRulePropertyValue}
                      disabled={wizardLockedMatchRule || undefined}
                      placeholder={t("wizard.propertyValuePlaceholder")}
                      onChange={(e: Event) =>
                        setWizardDraft({
                          ...wizardDraft,
                          matchRulePropertyValue: (
                            e.currentTarget as HTMLInputElement
                          ).value,
                        })
                      }
                    ></s-text-field>
                  </div>
                ) : (
                  <>
                    <div className={styles.matchSearchWrap}>
                      <s-text-field
                        label={t("wizard.matchValuesLabel")}
                        value={matchSearch}
                        disabled={wizardLockedMatchRule || undefined}
                        placeholder={t("wizard.matchSearchPlaceholder")}
                        onChange={(e: Event) =>
                          setMatchSearch(
                            (e.currentTarget as HTMLInputElement).value,
                          )
                        }
                      ></s-text-field>

                      {matchOptionsLoading ? (
                        <p className={styles.fieldHint}>
                          {t("wizard.matchValuesLoading")}
                        </p>
                      ) : matchOptions.length > 0 ? (
                        <div className={styles.matchOptionsDropdown}>
                          {matchOptions.map((opt) => {
                            const selected =
                              wizardDraft.matchRuleValues.includes(opt.value);
                            return (
                              <div
                                key={opt.value}
                                className={`${styles.matchOptionItem}${selected ? ` ${styles.matchOptionSelected}` : ""}`}
                                onClick={() =>
                                  !wizardLockedMatchRule &&
                                  toggleMatchValue(opt.value)
                                }
                                onKeyDown={(e) => {
                                  if (
                                    !wizardLockedMatchRule &&
                                    (e.key === "Enter" || e.key === " ")
                                  ) {
                                    e.preventDefault();
                                    toggleMatchValue(opt.value);
                                  }
                                }}
                                role="button"
                                tabIndex={wizardLockedMatchRule ? -1 : 0}
                              >
                                <s-checkbox
                                  checked={selected || undefined}
                                  onChange={() =>
                                    !wizardLockedMatchRule &&
                                    toggleMatchValue(opt.value)
                                  }
                                />
                                <span>{opt.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    {wizardDraft.matchRuleValues.length > 0 ? (
                      <div className={styles.matchChips}>
                        {wizardDraft.matchRuleValues.map((val) => (
                          <span key={val} className={styles.matchChip}>
                            {val}
                            {!wizardLockedMatchRule ? (
                              <span
                                className={styles.matchChipRemove}
                                onClick={() => removeMatchValue(val)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    removeMatchValue(val);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                              >
                                ×
                              </span>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}

                <p className={styles.fieldHint}>
                  {t("wizard.matchRuleHint")}
                </p>
              </div>
            ) : null}

            {/* ── Step 3: Targets + Baseline ─────────────────────────────── */}
            {wizardStep === 3 ? (
              <div className={styles.stepContent}>
                <div className={styles.baselinePeriodRow}>
                  <s-select
                    label={t("wizard.baselinePeriodLabel")}
                    value={wizardDraft.baselinePeriod}
                    onChange={(e: Event) =>
                      setWizardDraft({
                        ...wizardDraft,
                        baselinePeriod: (
                          e.currentTarget as HTMLSelectElement
                        ).value as WizardDraft["baselinePeriod"],
                      })
                    }
                  >
                    <s-option value="none">
                      {t("wizard.baselineNone")}
                    </s-option>
                    <s-option value="last_month">
                      {t("wizard.baselineLastMonth")}
                    </s-option>
                    <s-option value="last_quarter">
                      {t("wizard.baselineLastQuarter")}
                    </s-option>
                    <s-option value="last_year">
                      {t("wizard.baselineLastYear")}
                    </s-option>
                  </s-select>
                </div>

                {baselineFetcher.state !== "idle" ? (
                  <p className={styles.fieldHint}>
                    {t("wizard.baselineLoading")}
                  </p>
                ) : null}

                <div className={styles.targetsTable}>
                  <div className={styles.targetsHeader}>
                    <span>{t("col.location")}</span>
                    <span>{t("col.baseline")}</span>
                    <span>{t("col.target")}</span>
                  </div>
                  {locations.map((loc) => {
                    const row = wizardDraft.targets[loc.id] ?? {
                      targetOrders: "",
                      baselineOrders: "",
                    };
                    const baselineReadOnly =
                      wizardDraft.baselinePeriod !== "none";
                    return (
                      <div key={loc.id} className={styles.targetsRow}>
                        <span>{loc.name}</span>
                        <input
                          type="number"
                          min="0"
                          className={styles.numberInput}
                          value={row.baselineOrders}
                          disabled={baselineReadOnly}
                          placeholder="—"
                          onChange={(e) =>
                            updateTarget(
                              loc.id,
                              "baselineOrders",
                              e.currentTarget.value,
                            )
                          }
                        />
                        <input
                          type="number"
                          min="0"
                          className={styles.numberInput}
                          value={row.targetOrders}
                          placeholder="0"
                          onChange={(e) =>
                            updateTarget(
                              loc.id,
                              "targetOrders",
                              e.currentTarget.value,
                            )
                          }
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

            {/* ── Step 4: Review ──────────────────────────────────────────── */}
            {wizardStep === 4 ? (
              <div className={styles.stepContent}>
                <div className={styles.reviewBlock}>
                  <h4>{t("wizard.reviewHeading")}</h4>
                  <div className={styles.reviewGrid}>
                    <s-box padding="base">
                      <span className={styles.reviewLabel}>
                        {t("wizard.nameLabel")}
                      </span>
                      <span className={styles.reviewValue}>
                        {wizardDraft.name || "—"}
                      </span>
                    </s-box>
                    <s-box padding="base">
                      <span className={styles.reviewLabel}>
                        {t("wizard.dateRangeLabel")}
                      </span>
                      <span className={styles.reviewValue}>
                        {wizardDraft.startDate} → {wizardDraft.endDate}
                      </span>
                    </s-box>
                    <s-box padding="base">
                      <span className={styles.reviewLabel}>
                        {t("wizard.metricLabel")}
                      </span>
                      <span className={styles.reviewValue}>
                        {t(`wizard.metric_${wizardDraft.metric}`)}
                      </span>
                    </s-box>
                    <s-box padding="base">
                      <span className={styles.reviewLabel}>
                        {t("wizard.matchRuleTypeLabel")}
                      </span>
                      <span className={styles.reviewValue}>
                        {wizardDraft.matchRuleType}
                      </span>
                    </s-box>
                    <s-box padding="base">
                      <span className={styles.reviewLabel}>
                        {t("wizard.matchValuesLabel")}
                      </span>
                      <span className={styles.reviewValue}>
                        {wizardDraft.matchRuleType === "lineItemProperty"
                          ? `${wizardDraft.matchRulePropertyKey}=${wizardDraft.matchRulePropertyValue || "*"}`
                          : wizardDraft.matchRuleValues.join(", ") || "—"}
                      </span>
                    </s-box>
                    <s-box padding="base">
                      <span className={styles.reviewLabel}>
                        {t("wizard.totalTargetLabel")}
                      </span>
                      <span className={styles.reviewValue}>
                        {totalTarget}
                      </span>
                    </s-box>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* ── Wizard footer ──────────────────────────────────────────── */}
          <div className={styles.wizardFooter}>
            <s-button variant="secondary" onClick={closeWizard}>
              {t("actions.cancel")}
            </s-button>
            <div className={styles.wizardNav}>
              {wizardStep > 1 ? (
                <s-button
                  variant="secondary"
                  onClick={() =>
                    setWizardStep((wizardStep - 1) as 1 | 2 | 3)
                  }
                >
                  {t("actions.back")}
                </s-button>
              ) : null}
              {wizardStep < 4 ? (
                <s-button
                  variant="primary"
                  onClick={() =>
                    setWizardStep((wizardStep + 1) as 2 | 3 | 4)
                  }
                  disabled={
                    (wizardStep === 1 && wizardDraft.name.trim().length === 0) ||
                    undefined
                  }
                >
                  {t("actions.next")}
                </s-button>
              ) : (
                <s-button
                  variant="primary"
                  onClick={submitWizard}
                  disabled={
                    isSubmitting || totalTarget === 0 || undefined
                  }
                  loading={isSubmitting || undefined}
                >
                  {isSubmitting
                    ? t("actions.saving")
                    : t("actions.save")}
                </s-button>
              )}
            </div>
          </div>
        </s-modal>
      ) : null}
    </div>
  );
}
