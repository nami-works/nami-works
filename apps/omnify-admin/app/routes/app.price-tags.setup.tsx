import { useState, useCallback, useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  fetchMetaobjectTypes,
  fetchMetaobjectEntries,
} from "../services/price-tags/metaobject.server";
import { findProductMetafieldForMetaobjectType } from "../services/price-tags/metafield.server";

interface TierRow {
  discountType: "percent" | "dollar";
  startingAt: string;
  metaobjectHandles: string[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const appConfig = await prisma.priceTagConfig.findUnique({ where: { shop } });
  const tierRules = await prisma.priceTagTierRule.findMany({
    where: { shop },
    orderBy: { sortOrder: "asc" },
  });

  const metaobjectTypes = await fetchMetaobjectTypes(admin);

  let metaobjectEntries: Array<{
    handle: string;
    gid: string;
    displayName: string;
  }> = [];

  if (appConfig?.metaobjectType) {
    metaobjectEntries = await fetchMetaobjectEntries(
      admin,
      appConfig.metaobjectType,
    );
  }

  return {
    appConfig: appConfig ?? {
      discountMode: "highest",
      dollarThreshold: null,
      metaobjectType: "",
      metafieldNamespace: "",
      metafieldKey: "",
    },
    tierRules: tierRules.map((r) => ({
      discountType: r.discountType,
      startingAt: r.startingAt,
      metaobjectHandles: JSON.parse(r.metaobjectHandles) as string[],
      sortOrder: r.sortOrder,
    })),
    metaobjectTypes,
    metaobjectEntries,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("_action") as string;

  if (intent === "fetchEntries") {
    const metaobjectType = formData.get("metaobjectType") as string;
    if (!metaobjectType) return { entries: [] };

    const entries = await fetchMetaobjectEntries(admin, metaobjectType);
    return { entries, intent: "fetchEntries" };
  }

  if (intent === "runSync") {
    console.info(`[price-tags:setup] runSync START shop=${shop}`);
    try {
      const metaobjectType = formData.get("metaobjectType") as string;
      const discountMode = formData.get("discountMode") as string;
      const dollarThreshold = formData.get("dollarThreshold") as string;
      const tiersJson = formData.get("tiers") as string | null;

      // Auto-detect the product metafield definition that references this metaobject type
      const mfDef = await findProductMetafieldForMetaobjectType(admin, metaobjectType);
      const metafieldNamespace = mfDef?.namespace ?? "";
      const metafieldKey = mfDef?.key ?? "";

      if (!mfDef) {
        console.warn(`[price-tags] No product metafield definition found for metaobject type=${metaobjectType}`);
      }

      // Save config
      await prisma.priceTagConfig.upsert({
        where: { shop },
        create: {
          shop,
          discountMode,
          dollarThreshold: dollarThreshold ? parseFloat(dollarThreshold) : null,
          metaobjectType,
          metafieldNamespace,
          metafieldKey,
        },
        update: {
          discountMode,
          dollarThreshold: dollarThreshold ? parseFloat(dollarThreshold) : null,
          metaobjectType,
          metafieldNamespace,
          metafieldKey,
        },
      });

      // Save tiers if provided
      if (tiersJson) {
        const tiers: TierRow[] = JSON.parse(tiersJson);

        let handleGidMap = new Map<string, string>();
        if (metaobjectType) {
          const entries = await fetchMetaobjectEntries(admin, metaobjectType);
          for (const entry of entries) {
            handleGidMap.set(entry.handle, entry.gid);
          }
        }

        await prisma.priceTagTierRule.deleteMany({ where: { shop } });

        for (let i = 0; i < tiers.length; i++) {
          const tier = tiers[i];
          const gids = tier.metaobjectHandles.map(
            (h) => handleGidMap.get(h) ?? "",
          );

          await prisma.priceTagTierRule.create({
            data: {
              shop,
              discountType: tier.discountType,
              startingAt: parseFloat(tier.startingAt),
              metaobjectHandles: JSON.stringify(tier.metaobjectHandles),
              metaobjectGids: JSON.stringify(gids),
              sortOrder: i,
            },
          });
        }
      }

      const { runFullSync } = await import("../services/price-tags/sync.server");
      const result = await runFullSync(admin, shop);
      console.info(`[price-tags:setup] runSync OK shop=${shop} tagged=${(result as any).tagged ?? "?"} skipped=${(result as any).skipped ?? "?"}`);
      return { ok: true, intent: "runSync", ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync error";
      const stack = err instanceof Error ? err.stack ?? "" : "";
      console.error(`[price-tags:setup] runSync FAILED shop=${shop}`, err);
      return { ok: false, intent: "runSync", error: message, stack };
    }
  }

  return { ok: false };
};

const TOTAL_STEPS = 5;

const stepBarStyles: Record<string, React.CSSProperties> = {
  bar: { display: "flex", gap: 8, marginBottom: 24 },
  step: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    background: "#e1e1e1",
    transition: "background 0.2s",
  },
  active: { background: "#2c6ecb" },
  done: { background: "#2c6ecb" },
};

const wizardStyles: Record<string, React.CSSProperties> = {
  nav: { display: "flex", justifyContent: "space-between", marginTop: 24 },
  stepLabel: {
    fontSize: 13,
    color: "#6d7175",
    fontWeight: 500,
    marginBottom: 4,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
  },
};

export default function PriceTags() {
  const { appConfig, tierRules, metaobjectTypes, metaobjectEntries } =
    useLoaderData<typeof loader>();
  const { t } = useTranslation("priceTags");
  const entriesFetcher = useFetcher<typeof action>();
  const syncFetcher = useFetcher<typeof action>();
  const modalRef = useRef<any>(null);

  const [step, setStep] = useState(0);
  const [hasMetaobject, setHasMetaobject] = useState<boolean | null>(
    appConfig.metaobjectType ? true : null,
  );

  const [discountMode, setDiscountMode] = useState(appConfig.discountMode);
  const [dollarThreshold, setDollarThreshold] = useState(
    appConfig.dollarThreshold?.toString() ?? "",
  );
  const [metaobjectType, setMetaobjectType] = useState(
    appConfig.metaobjectType || (metaobjectTypes.length === 1 ? metaobjectTypes[0].type : ""),
  );
  const [entries, setEntries] = useState(metaobjectEntries);

  const [tiers, setTiers] = useState<TierRow[]>(
    tierRules.map((r) => ({
      discountType: r.discountType as "percent" | "dollar",
      startingAt: r.startingAt.toString(),
      metaobjectHandles: r.metaobjectHandles,
    })),
  );

  const [seqMin, setSeqMin] = useState("");
  const [seqStep, setSeqStep] = useState("");
  const [seqMax, setSeqMax] = useState("");

  // Auto-select if only one metaobject type exists and none is selected
  useEffect(() => {
    if (!metaobjectType && metaobjectTypes.length === 1) {
      const autoType = metaobjectTypes[0].type;
      setMetaobjectType(autoType);
      entriesFetcher.submit(
        { _action: "fetchEntries", metaobjectType: autoType },
        { method: "POST" },
      );
    }
  }, [metaobjectType, metaobjectTypes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (entriesFetcher.data && "entries" in entriesFetcher.data) {
      setEntries(entriesFetcher.data.entries as typeof metaobjectEntries);
    }
  }, [entriesFetcher.data]);

  const handleMetaobjectTypeChange = useCallback(
    (newType: string) => {
      setMetaobjectType(newType);
      if (newType) {
        entriesFetcher.submit(
          { _action: "fetchEntries", metaobjectType: newType },
          { method: "POST" },
        );
      } else {
        setEntries([]);
      }
    },
    [entriesFetcher],
  );

  const isSyncing =
    syncFetcher.state === "submitting" || syncFetcher.state === "loading";
  const syncData = syncFetcher.data as
    | { ok: true; intent: "runSync"; processed: number; updated: number; cleared: number; created: number }
    | { ok: false; intent: "runSync"; error: string; stack?: string }
    | undefined;
  const syncDone = syncData?.intent === "runSync";
  const syncSuccess = syncDone && syncData.ok;
  const syncFailed = syncDone && !syncData.ok;

  const handleRunSync = useCallback(() => {
    syncFetcher.submit({
      _action: "runSync",
      metaobjectType,
      discountMode,
      dollarThreshold,
      tiers: JSON.stringify(tiers),
    }, { method: "POST" });
  }, [syncFetcher, metaobjectType, discountMode, dollarThreshold, tiers]);

  const handleCreateSequentialTiers = useCallback(() => {
    const min = parseFloat(seqMin);
    const stepVal = parseFloat(seqStep);
    const max = seqMax ? parseFloat(seqMax) : null;

    if (isNaN(min) || isNaN(stepVal) || stepVal <= 0) return;

    const newTiers: TierRow[] = [];
    let current = min;
    const limit = max ?? min + stepVal * 10;

    while (current <= limit) {
      newTiers.push({
        discountType: discountMode === "dollar" ? "dollar" : "percent",
        startingAt: current.toString(),
        metaobjectHandles: [],
      });
      current = parseFloat((current + stepVal).toFixed(2));
    }

    setTiers(newTiers);
    modalRef.current?.hideOverlay();
  }, [seqMin, seqStep, seqMax, discountMode]);

  const handleAddManualTier = useCallback(() => {
    setTiers((prev) => [
      ...prev,
      { discountType: "percent", startingAt: "", metaobjectHandles: [] },
    ]);
  }, []);

  const handleRemoveTier = useCallback((index: number) => {
    setTiers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateTier = useCallback(
    (index: number, field: keyof TierRow, value: any) => {
      setTiers((prev) =>
        prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)),
      );
    },
    [],
  );

  // Step validation
  const canAdvance = [
    hasMetaobject !== null,                    // Step 0: answered yes/no
    !!metaobjectType,                          // Step 1: metaobject selected
    !!discountMode,                            // Step 2: discount mode selected
    tiers.length > 0 && tiers.every((t) => t.startingAt !== ""), // Step 3: at least 1 valid tier
    true,                                      // Step 4: sync (always accessible)
  ];

  const stepLabels = [
    t("wizard.step0"),
    t("wizard.step1"),
    t("wizard.step2"),
    t("wizard.step3"),
    t("wizard.step4"),
  ];

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <>

      {/* Progress bar */}
      <div style={stepBarStyles.bar}>
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            style={{
              ...stepBarStyles.step,
              ...(i < step ? stepBarStyles.done : {}),
              ...(i === step ? stepBarStyles.active : {}),
            }}
          />
        ))}
      </div>

      {/* Step label */}
      <div style={wizardStyles.stepLabel}>
        {t("wizard.stepOf", { current: step + 1, total: TOTAL_STEPS })} — {stepLabels[step]}
      </div>

      {/* Step 0: Do you have a metaobject? */}
      {step === 0 && (
        <s-section heading={stepLabels[0]}>
          <s-paragraph>{t("wizard.step0Description")}</s-paragraph>

          <s-stack direction="inline" gap="base">
            {hasMetaobject === true ? (
              <s-button key="yes-active" variant="primary" onClick={() => setHasMetaobject(true)}>
                {t("wizard.yes")}
              </s-button>
            ) : (
              <s-button key="yes-inactive" variant="secondary" onClick={() => setHasMetaobject(true)}>
                {t("wizard.yes")}
              </s-button>
            )}
            {hasMetaobject === false ? (
              <s-button key="no-active" variant="primary" onClick={() => setHasMetaobject(false)}>
                {t("wizard.no")}
              </s-button>
            ) : (
              <s-button key="no-inactive" variant="secondary" onClick={() => setHasMetaobject(false)}>
                {t("wizard.no")}
              </s-button>
            )}
          </s-stack>

          {hasMetaobject === false && (
            <s-banner tone="info">{t("wizard.noMetaobjectHint")}</s-banner>
          )}
        </s-section>
      )}

      {/* Step 1: Select metaobject type */}
      {step === 1 && (
        <s-section heading={stepLabels[1]}>
          <s-paragraph>{t("wizard.step1Description")}</s-paragraph>
          <s-select
            label={t("labels.metaobjectType")}
            value={metaobjectType}
            onChange={(e: any) =>
              handleMetaobjectTypeChange(e.currentTarget.value)
            }
          >
            <s-option value="">{t("labels.selectMetaobjectType")}</s-option>
            {metaobjectTypes.map((mo) => (
              <s-option key={mo.type} value={mo.type}>
                {mo.name} ({mo.type})
              </s-option>
            ))}
          </s-select>
        </s-section>
      )}

      {/* Step 2: Discount mode */}
      {step === 2 && (
        <s-section heading={stepLabels[2]}>
          <s-paragraph>{t("wizard.step2Description")}</s-paragraph>
          <s-select
            label={t("labels.discountModeSelect")}
            value={discountMode}
            onChange={(e: any) => setDiscountMode(e.currentTarget.value)}
          >
            <s-option value="highest">{t("discountModes.highest")}</s-option>
            <s-option value="percent">{t("discountModes.percent")}</s-option>
            <s-option value="dollar">{t("discountModes.dollar")}</s-option>
            <s-option value="percent_with_dollar_threshold">
              {t("discountModes.percentWithThreshold")}
            </s-option>
          </s-select>

          {discountMode === "percent_with_dollar_threshold" && (
            <s-number-field
              label={t("labels.dollarThreshold")}
              value={dollarThreshold}
              onChange={(e: any) => setDollarThreshold(e.currentTarget.value)}
            />
          )}

          <s-banner tone="warning">{t("discountModeTip")}</s-banner>
        </s-section>
      )}

      {/* Step 3: Define tiers */}
      {step === 3 && (
        <s-section heading={stepLabels[3]}>
          <s-paragraph>{t("wizard.step3Description")}</s-paragraph>

          {tiers.length === 0 && (
            <s-stack direction="inline" gap="base">
              <s-button variant="secondary" onClick={handleAddManualTier}>
                {t("addTiersManually")}
              </s-button>
              <s-button command="--show" commandFor="seq-tier-modal">
                {t("defineSequentialTiers")}
              </s-button>
            </s-stack>
          )}

          {tiers.map((tier, index) => (
            <s-box
              key={index}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background="subdued"
            >
              <s-stack direction="inline" gap="base">
                <s-select
                  label={t("labels.tierType")}
                  value={tier.discountType}
                  onChange={(e: any) =>
                    updateTier(index, "discountType", e.currentTarget.value)
                  }
                >
                  <s-option value="percent">%</s-option>
                  <s-option value="dollar">$</s-option>
                </s-select>

                <s-number-field
                  label={t("labels.startingAt")}
                  value={tier.startingAt}
                  onChange={(e: any) =>
                    updateTier(index, "startingAt", e.currentTarget.value)
                  }
                />

                <s-choice-list
                  label={t("labels.applyTag")}
                  name={`tier-tags-${index}`}
                  values={tier.metaobjectHandles}
                  onChange={(e: any) => {
                    const values = e.currentTarget.values ?? [];
                    updateTier(index, "metaobjectHandles", values);
                  }}
                >
                  {entries.map((entry) => (
                    <s-choice key={entry.handle} value={entry.handle}>
                      {entry.displayName || entry.handle}
                    </s-choice>
                  ))}
                </s-choice-list>

                <s-button
                  variant="tertiary"
                  tone="critical"
                  onClick={() => handleRemoveTier(index)}
                >
                  {t("removeTier")}
                </s-button>
              </s-stack>
            </s-box>
          ))}

          {tiers.length > 0 && (
            <s-button variant="secondary" onClick={handleAddManualTier}>
              {t("addTier")}
            </s-button>
          )}
        </s-section>
      )}

      {/* Step 4: Run sync */}
      {step === 4 && (
        <s-section heading={stepLabels[4]}>
          <s-paragraph>{t("wizard.step4Description")}</s-paragraph>

          {/* Summary of choices */}
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="small-200">
              <div><strong>{t("labels.metaobjectType")}:</strong> {metaobjectType || "—"}</div>
              <div><strong>{t("labels.discountModeSelect")}:</strong> {t(`discountModes.${discountMode === "percent_with_dollar_threshold" ? "percentWithThreshold" : discountMode}`)}</div>
              <div><strong>{t("sections.tiers")}:</strong> {tiers.length} {tiers.length === 1 ? t("wizard.tier") : t("wizard.tiers")}</div>
            </s-stack>
          </s-box>

          {isSyncing || !metaobjectType ? (
            <s-button variant="primary" disabled {...(isSyncing ? { loading: true } : {})}>
              {isSyncing ? t("syncInProgress") : t("runFullSync")}
            </s-button>
          ) : (
            <s-button variant="primary" onClick={handleRunSync}>
              {t("runFullSync")}
            </s-button>
          )}

          {syncSuccess && (
            <s-banner tone="success">
              {t("syncResult", {
                processed: (syncData as any).processed,
                updated: (syncData as any).updated,
                cleared: (syncData as any).cleared,
                created: (syncData as any).created,
              })}
            </s-banner>
          )}

          {syncFailed && (
            <s-banner tone="critical">
              {t("syncError", { error: (syncData as any).error })}
              {(syncData as any).stack && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12 }}>{t("syncErrorDetails")}</summary>
                  <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", marginTop: 4 }}>
                    {(syncData as any).stack}
                  </pre>
                </details>
              )}
            </s-banner>
          )}
        </s-section>
      )}

      {/* Navigation buttons */}
      <div style={wizardStyles.nav}>
        <div>
          {step > 0 && (
            <s-button variant="secondary" onClick={goBack}>
              {t("wizard.back")}
            </s-button>
          )}
        </div>
        <div>
          {step < TOTAL_STEPS - 1 && (
            canAdvance[step] ? (
              <s-button key="next-enabled" variant="primary" onClick={goNext}>
                {t("wizard.next")}
              </s-button>
            ) : (
              <s-button key="next-disabled" variant="primary" disabled>
                {t("wizard.next")}
              </s-button>
            )
          )}
        </div>
      </div>

      {/* Sequential Tiers Modal */}
      <s-modal id="seq-tier-modal" ref={modalRef} heading={t("sequentialModal.heading")}>
        <s-section>
          <s-number-field
            label={t("sequentialModal.minTier")}
            value={seqMin}
            onChange={(e: any) => setSeqMin(e.currentTarget.value)}
          />
          <s-number-field
            label={t("sequentialModal.step")}
            value={seqStep}
            onChange={(e: any) => setSeqStep(e.currentTarget.value)}
          />
          <s-number-field
            label={t("sequentialModal.maxTier")}
            value={seqMax}
            onChange={(e: any) => setSeqMax(e.currentTarget.value)}
          />
        </s-section>

        <s-stack slot="footer" direction="inline" gap="base">
          <s-button
            variant="secondary"
            onClick={() => modalRef.current?.hideOverlay()}
          >
            {t("common:button.cancel")}
          </s-button>
          <s-button onClick={handleCreateSequentialTiers}>
            {t("sequentialModal.createTiers")}
          </s-button>
        </s-stack>
      </s-modal>
    </>
  );
}
