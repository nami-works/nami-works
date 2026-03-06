import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { createHash } from "node:crypto";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import styles from "./app.goals/styles.module.css";

type GoalsConfig = {
  targetProduct: string;
  launchDate: string;
  goals: {
    day1Revenue: string;
    day1Units: string;
    week1Revenue: string;
    week1Units: string;
    month1Revenue: string;
    month1Units: string;
  };
  benchmarks: Array<{
    name: string;
    productId?: string;
    launchDate?: string;
  }>;
  segments: Array<{
    type: "tag" | "location" | "channel";
    value: string;
    period: "daily" | "weekly" | "monthly" | "custom";
    revenueGoal: string;
    unitsGoal: string;
  }>;
};

type GoalsRunData = {
  range: { startDate: string; endDate: string; label: string };
  summary: {
    revenue: number;
    orders: number;
    units: number;
    aov: number;
    currencyCode: string;
  };
  launch: {
    day1: { revenue: number; units: number; orders: number };
    week1: { revenue: number; units: number; orders: number };
    month1: { revenue: number; units: number; orders: number };
  } | null;
  daily: Array<{ date: string; revenue: number; orders: number }>;
  topProducts: Array<{ title: string; revenue: number; units: number }>;
  recentOrders: Array<{
    name: string;
    createdAt: string;
    customer: string;
    total: number;
    currencyCode: string;
  }>;
  segments: Array<{
    label: string;
    revenue: number;
    units: number;
    revenueGoal: number;
    unitsGoal: number;
  }>;
  benchmarks: Array<{
    name: string;
    launchDate: string;
    revenue: number;
    units: number;
    orders: number;
    launchRevenue: number;
    launchUnits: number;
    productId?: string;
  }>;
  exportRows: Array<Record<string, string | number>>;
};

type LoaderData = {
  shop: string;
  config: GoalsConfig | null;
  latestRun: GoalsRunData | null;
};

const DEFAULT_CONFIG: GoalsConfig = {
  targetProduct: "All products",
  launchDate: "",
  goals: {
    day1Revenue: "",
    day1Units: "",
    week1Revenue: "",
    week1Units: "",
    month1Revenue: "",
    month1Units: "",
  },
  benchmarks: [],
  segments: [],
};

const RANGE_OPTIONS = [
  { value: "since_launch", label: "Since launch" },
  { value: "last_7", label: "Last 7 days" },
  { value: "last_30", label: "Last 30 days" },
  { value: "last_90", label: "Last 90 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom range" },
];

export default function GoalsPage() {
  const { config: loaderConfig, latestRun } = useLoaderData<LoaderData>();
  const saveFetcher = useFetcher<typeof action>();
  const runFetcher = useFetcher<typeof action>();
  const benchmarkFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [config, setConfig] = useState<GoalsConfig>(
    loaderConfig ?? DEFAULT_CONFIG,
  );
  const [rangeType, setRangeType] = useState("last_30");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [runData, setRunData] = useState<GoalsRunData | null>(latestRun);
  const [benchmarkProducts, setBenchmarkProducts] = useState<
    Array<{ id: string; title: string }>
  >([]);
  const [pendingBenchmarks, setPendingBenchmarks] = useState<
    Array<{ id: string; title: string }>
  >([]);
  const [showBenchmarkSuccess, setShowBenchmarkSuccess] = useState(false);
  const [showBenchmarkEdit, setShowBenchmarkEdit] = useState(false);
  const [editingBenchmarkIndex, setEditingBenchmarkIndex] = useState<number | null>(
    null,
  );
  const [editingBenchmarkDate, setEditingBenchmarkDate] = useState("");
  const [editingBenchmarkProduct, setEditingBenchmarkProduct] = useState<{
    id: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (loaderConfig) {
      setConfig(loaderConfig);
    }
  }, [loaderConfig]);

  useEffect(() => {
    if (runFetcher.data?.run) {
      setRunData(runFetcher.data.run as GoalsRunData);
    }
  }, [runFetcher.data]);

  const isConfigSaved = Boolean(loaderConfig || saveFetcher.data?.config);
  const saveConfig = () => {
    const formData = new FormData();
    formData.append("intent", "save-config");
    formData.append("configJson", JSON.stringify(config));
    saveFetcher.submit(formData, { method: "post" });
  };

  const runReport = () => {
    const formData = new FormData();
    formData.append("intent", "run-report");
    formData.append("rangeType", rangeType);
    formData.append("customStart", customStart);
    formData.append("customEnd", customEnd);
    runFetcher.submit(formData, { method: "post" });
  };

  const updateGoalField = (field: keyof GoalsConfig["goals"], value: string) => {
    setConfig((current) => ({
      ...current,
      goals: {
        ...current.goals,
        [field]: value,
      },
    }));
  };

  const addBenchmark = () => {
    if (!benchmarkProducts.length || benchmarkFetcher.state === "submitting") {
      return;
    }
    const productIds = benchmarkProducts.map((product) => product.id);
    const productTitles = benchmarkProducts.map((product) => product.title);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1',location:'app.goals.tsx:addBenchmark',message:'Submitting benchmark launch request',data:{count:benchmarkProducts.length,productIds},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const formData = new FormData();
    formData.append("intent", "resolve-benchmark-launch");
    formData.append("productIds", JSON.stringify(productIds));
    formData.append("productTitles", JSON.stringify(productTitles));
    benchmarkFetcher.submit(formData, { method: "post" });
    setPendingBenchmarks(benchmarkProducts);
  };

  const openTargetProductPicker = async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });
    const picked = selection?.selection?.[0];
    if (picked?.title) {
      setConfig((current) => ({
        ...current,
        targetProduct: picked.title,
      }));
    }
  };

  const openBenchmarkProductPicker = async () => {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: true,
    });
    const picked = selection?.selection ?? [];
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H6',location:'app.goals.tsx:openBenchmarkProductPicker',message:'Benchmark picker selection',data:{count:picked.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const mapped = picked
      .filter((product) => product?.id && product?.title)
      .map((product) => ({ id: product.id, title: product.title }));
    if (mapped.length > 0) {
      setBenchmarkProducts(mapped);
    }
  };

  const showBenchmarkSuccessModal = () => {
    setShowBenchmarkSuccess(true);
  };

  const closeBenchmarkSuccessModal = () => {
    setShowBenchmarkSuccess(false);
  };

  const hideBenchmarkModal = () => {
    const modal = document.getElementById("benchmark-modal") as {
      hide?: () => void;
    } | null;
    modal?.hide?.();
  };

  const reopenBenchmarkModal = () => {
    const modal = document.getElementById("benchmark-modal") as {
      show?: () => void;
    } | null;
    modal?.show?.();
  };

  const openBenchmarkEditModal = (index: number) => {
    const benchmark = config.benchmarks[index];
    if (!benchmark?.productId) return;
    setEditingBenchmarkIndex(index);
    setEditingBenchmarkDate(benchmark.launchDate ?? "");
    setEditingBenchmarkProduct({
      id: benchmark.productId,
      title: benchmark.name,
    });
    setShowBenchmarkEdit(true);
  };

  const closeBenchmarkEditModal = () => {
    setShowBenchmarkEdit(false);
  };

  const submitBenchmarkOverride = () => {
    if (!editingBenchmarkProduct || !editingBenchmarkDate) return;
    const formData = new FormData();
    formData.append("intent", "override-benchmark-launch");
    formData.append("productId", editingBenchmarkProduct.id);
    formData.append("productTitle", editingBenchmarkProduct.title);
    formData.append("launchDate", editingBenchmarkDate);
    benchmarkFetcher.submit(formData, { method: "post" });
  };

  const removeBenchmark = (index: number) => {
    setConfig((current) => ({
      ...current,
      benchmarks: current.benchmarks.filter((_, idx) => idx !== index),
    }));
  };

  const exportCsvUrl = useMemo(() => {
    if (!runData?.exportRows?.length) return null;
    const headers = Object.keys(runData.exportRows[0] ?? {});
    const lines = [
      headers.join(","),
      ...runData.exportRows.map((row) =>
        headers
          .map((key) => JSON.stringify(row[key] ?? ""))
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    return URL.createObjectURL(blob);
  }, [runData]);

  const summary = runData?.summary ?? null;
  const currencyCode = summary?.currencyCode ?? "BRL";

  useEffect(() => {
    if (!pendingBenchmarks.length || !benchmarkFetcher.data) return;
    const response = benchmarkFetcher.data as {
      ok?: boolean;
      results?: Array<{
        productId: string;
        productTitle: string;
        launchDate: string;
      }>;
      error?: string;
    };
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H2',location:'app.goals.tsx:benchmarkFetcher',message:'Benchmark fetcher response',data:{ok:response.ok,launchDate:response.launchDate || '',error:response.error || ''},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (response.ok) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H7',location:'app.goals.tsx:benchmarkFetcher',message:'Adding benchmark to config',data:{count:response.results?.length ?? 0},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const results = response.results ?? [];
      if (response.results) {
        setConfig((current) => ({
          ...current,
          benchmarks: [
            ...current.benchmarks,
            ...results.map((result) => ({
              name: result.productTitle,
              productId: result.productId,
              launchDate: result.launchDate ?? "",
            })),
          ],
        }));
        setBenchmarkProducts([]);
        showBenchmarkSuccessModal();
      } else if (editingBenchmarkIndex !== null) {
        const overrideResult = response as {
          launchDate?: string;
          launchRevenue?: number;
          launchUnits?: number;
          productId?: string;
        };
        setConfig((current) => ({
          ...current,
          benchmarks: current.benchmarks.map((benchmark, index) =>
            index === editingBenchmarkIndex
              ? { ...benchmark, launchDate: overrideResult.launchDate ?? "" }
              : benchmark,
          ),
        }));
        if (runData) {
          setRunData((current) => {
            if (!current) return current;
            const nextBenchmarks = current.benchmarks.map((benchmark) =>
              benchmark.name === editingBenchmarkProduct?.title
                ? {
                    ...benchmark,
                    launchRevenue: overrideResult.launchRevenue ?? benchmark.launchRevenue,
                    launchUnits: overrideResult.launchUnits ?? benchmark.launchUnits,
                  }
                : benchmark,
            );
            return { ...current, benchmarks: nextBenchmarks };
          });
        }
        closeBenchmarkEditModal();
      }
    }
    setPendingBenchmarks([]);
  }, [benchmarkFetcher.data, pendingBenchmarks, editingBenchmarkIndex, runData]);

  useEffect(() => {
    const modal = document.getElementById("benchmark-success-modal") as {
      show?: () => void;
      hide?: () => void;
    } | null;
    if (showBenchmarkSuccess) {
      hideBenchmarkModal();
      modal?.show?.();
    } else {
      modal?.hide?.();
    }
  }, [showBenchmarkSuccess]);

  useEffect(() => {
    const modal = document.getElementById("benchmark-edit-modal") as {
      show?: () => void;
      hide?: () => void;
    } | null;
    if (showBenchmarkEdit) {
      modal?.show?.();
    } else {
      modal?.hide?.();
    }
  }, [showBenchmarkEdit]);

  useEffect(() => {
    const latestBenchmark = config.benchmarks[config.benchmarks.length - 1];
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H8',location:'app.goals.tsx:configBenchmarks',message:'Benchmarks state updated',data:{count:config.benchmarks.length,latestName:latestBenchmark?.name || '',latestProductId:latestBenchmark?.productId || ''},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [config.benchmarks]);

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H9',location:'app.goals.tsx:benchmarkDraft',message:'Benchmark products updated',data:{count:benchmarkProducts.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [benchmarkProducts]);

  return (
    <s-page heading="Goals">
      {saveFetcher.data?.error ? (
        <s-banner tone="critical" heading="Unable to save configuration">
          {saveFetcher.data.error}
        </s-banner>
      ) : null}
      {runFetcher.data?.error ? (
        <s-banner tone="critical" heading="Unable to load data">
          {runFetcher.data.error}
        </s-banner>
      ) : null}
      {benchmarkFetcher.data?.error ? (
        <s-banner tone="critical" heading="Unable to add benchmark">
          {benchmarkFetcher.data.error}
        </s-banner>
      ) : null}

      <s-section heading="Product launch setup">
        <div className={styles.formGrid}>
          <s-text-field
            label="Target product"
            value={config.targetProduct}
            type="search"
            placeholder="Start typing a product name..."
            onFocus={openTargetProductPicker}
            onChange={(event: Event) =>
              setConfig((current) => ({
                ...current,
                targetProduct: (event.currentTarget as HTMLInputElement).value,
              }))
            }
          />
          <div className={styles.dateField}>
            <s-text type="strong">Launch date</s-text>
            <s-button
              variant="secondary"
              commandFor="launch-date-popover"
              command="--toggle"
            >
              Select launch date
            </s-button>
            <s-popover id="launch-date-popover">
              <s-date-picker
                type="single"
                value={config.launchDate}
                onChange={(event: Event) =>
                  setConfig((current) => ({
                    ...current,
                    launchDate: (event.currentTarget as HTMLInputElement).value,
                  }))
                }
              />
            </s-popover>
          </div>
        </div>
        <div className={styles.benchmarksBlock}>
          <s-text type="strong">Benchmarks</s-text>
          {config.benchmarks.length === 0 ? (
            <s-text color="subdued" className={styles.benchmarksEmpty}>
              No benchmarks added.
            </s-text>
          ) : (
            <table className={styles.benchmarksTable}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Launch date</th>
                  <th>Launch revenue (30d)</th>
                  <th>Launch units sold (30d)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {config.benchmarks.map((benchmark, index) => {
                  const benchmarkMetrics = runData?.benchmarks?.[index];
                  const launchDate = benchmark.launchDate || "--";
                  const popoverId = `benchmark-actions-${index}`;
                  return (
                    <tr key={`benchmark-${index}`}>
                      <td className={styles.benchmarksProductCell}>
                        {benchmark.name || "--"}
                      </td>
                      <td>{launchDate}</td>
                      <td>
                        {benchmarkMetrics
                          ? formatCurrency(benchmarkMetrics.launchRevenue, currencyCode)
                          : "--"}
                      </td>
                      <td>{benchmarkMetrics ? benchmarkMetrics.launchUnits : "--"}</td>
                      <td className={styles.benchmarksActionCell}>
                        <s-button
                          variant="secondary"
                          icon="menu-horizontal"
                          accessibilityLabel="More actions"
                          commandFor={popoverId}
                          command="--toggle"
                        ></s-button>
                        <s-popover id={popoverId} className={styles.actionPopover}>
                          <s-menu accessibilityLabel="Benchmark actions">
                            <s-button
                              variant="secondary"
                              commandFor={popoverId}
                              command="--hide"
                              onClick={() => openBenchmarkEditModal(index)}
                            >
                              Edit launch date
                            </s-button>
                            <s-button
                              variant="critical"
                              commandFor={popoverId}
                              command="--hide"
                              onClick={() => removeBenchmark(index)}
                            >
                              Remove
                            </s-button>
                          </s-menu>
                        </s-popover>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className={styles.benchmarkActions}>
          <s-button
            variant="secondary"
            commandFor="benchmark-modal"
            command="--show"
          >
            Add benchmark
          </s-button>
        </div>
        <s-text type="strong" className={styles.goalsHeader}>
          Goals
        </s-text>
        <div className={styles.goalRows}>
          <div className={styles.goalRow}>
            <s-text type="strong">Launch day</s-text>
            <div className={styles.goalRowFields}>
              <s-text-field
                label="Revenue"
                value={config.goals.day1Revenue}
                onChange={(event: Event) =>
                  updateGoalField(
                    "day1Revenue",
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
              />
              <s-text-field
                label="Units sold"
                value={config.goals.day1Units}
                onChange={(event: Event) =>
                  updateGoalField(
                    "day1Units",
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
              />
            </div>
          </div>
          <div className={styles.goalRow}>
            <s-text type="strong">Launch week</s-text>
            <div className={styles.goalRowFields}>
              <s-text-field
                label="Revenue"
                value={config.goals.week1Revenue}
                onChange={(event: Event) =>
                  updateGoalField(
                    "week1Revenue",
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
              />
              <s-text-field
                label="Units sold"
                value={config.goals.week1Units}
                onChange={(event: Event) =>
                  updateGoalField(
                    "week1Units",
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
              />
            </div>
          </div>
          <div className={styles.goalRow}>
            <s-text type="strong">Launch month</s-text>
            <div className={styles.goalRowFields}>
              <s-text-field
                label="Revenue"
                value={config.goals.month1Revenue}
                onChange={(event: Event) =>
                  updateGoalField(
                    "month1Revenue",
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
              />
              <s-text-field
                label="Units sold"
                value={config.goals.month1Units}
                onChange={(event: Event) =>
                  updateGoalField(
                    "month1Units",
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
              />
            </div>
          </div>
        </div>
        <div className={styles.actionsRow}>
          <s-button
            variant="primary"
            onClick={saveConfig}
            disabled={saveFetcher.state === "submitting"}
          >
            Setup launch
          </s-button>
        </div>
      </s-section>
      <s-modal
        id="benchmark-modal"
        heading={`Benchmark #${config.benchmarks.length + 1}`}
      >
        <div className={styles.modalBody}>
          <s-text-field
            label="Product"
            value={benchmarkProducts.map((product) => product.title).join(", ")}
            type="search"
            placeholder="Select a product"
            readonly
            onClick={openBenchmarkProductPicker}
            onFocus={openBenchmarkProductPicker}
          />
          <s-button
            variant="secondary"
            commandFor="add-product-modal"
            command="--show"
          >
            Add product
          </s-button>
          <div className={styles.modalActions}>
            <s-button
              variant="secondary"
              commandFor="benchmark-modal"
              command="--hide"
            >
              Close
            </s-button>
            <s-button
              variant="primary"
              disabled={
                benchmarkProducts.length === 0 ||
                benchmarkFetcher.state === "submitting"
              }
              onClick={addBenchmark}
            >
              Add benchmark(s)
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="add-product-modal" heading="Add product">
        <div className={styles.modalBody}>
          <s-text type="strong">Selected products</s-text>
          {benchmarkProducts.length === 0 ? (
            <s-text color="subdued">No products selected.</s-text>
          ) : (
            <div className={styles.productList}>
              {benchmarkProducts.map((product) => (
                <s-text key={product.id}>{product.title}</s-text>
              ))}
            </div>
          )}
          <div className={styles.modalActions}>
            <s-button
              variant="secondary"
              onClick={openBenchmarkProductPicker}
            >
              Select products
            </s-button>
            <s-button
              variant="primary"
              commandFor="add-product-modal"
              command="--hide"
            >
              Add
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="benchmark-success-modal" heading="Benchmark(s) added">
        <div className={styles.modalBody}>
          <s-text>Benchmark(s) added</s-text>
          <div className={styles.modalActions}>
            <s-button
              variant="secondary"
              commandFor="benchmark-success-modal"
              command="--hide"
              onClick={() => {
                closeBenchmarkSuccessModal();
                reopenBenchmarkModal();
              }}
            >
              Add more benchmarks
            </s-button>
            <s-button
              variant="primary"
              commandFor="benchmark-success-modal"
              command="--hide"
              onClick={closeBenchmarkSuccessModal}
            >
              Close
            </s-button>
          </div>
        </div>
      </s-modal>
      <s-modal id="benchmark-edit-modal" heading="Edit launch date">
        <div className={styles.modalBody}>
          <s-button
            variant="secondary"
            commandFor="benchmark-edit-date-popover"
            command="--toggle"
          >
            Override launch date
          </s-button>
          <s-popover id="benchmark-edit-date-popover">
            <s-date-picker
              type="single"
              value={editingBenchmarkDate}
              onChange={(event: Event) =>
                setEditingBenchmarkDate(
                  (event.currentTarget as HTMLInputElement).value,
                )
              }
            />
          </s-popover>
          <div className={styles.modalActions}>
            <s-button
              variant="secondary"
              commandFor="benchmark-edit-modal"
              command="--hide"
              onClick={closeBenchmarkEditModal}
            >
              Cancel
            </s-button>
            <s-button
              variant="primary"
              disabled={!editingBenchmarkDate}
              onClick={submitBenchmarkOverride}
            >
              Save
            </s-button>
          </div>
        </div>
      </s-modal>

      <s-section heading="[More content here]" slot="aside"></s-section>

      <s-section heading="Data range">
        <div className={styles.formGrid}>
          <s-select
            label="Date range"
            value={rangeType}
            onChange={(event: Event) =>
              setRangeType(
                (event.currentTarget as HTMLSelectElement).value,
              )
            }
          >
            {RANGE_OPTIONS.map((option) => (
              <s-option key={option.value} value={option.value}>
                {option.label}
              </s-option>
            ))}
          </s-select>
          {rangeType === "custom" ? (
            <>
              <div className={styles.dateField}>
                <s-text type="strong">Start date</s-text>
                <s-button
                  variant="secondary"
                  commandFor="custom-start-date-popover"
                  command="--toggle"
                >
                  Select start date
                </s-button>
                <s-popover id="custom-start-date-popover">
                  <s-date-picker
                    type="single"
                    value={customStart}
                    onChange={(event: Event) =>
                      setCustomStart(
                        (event.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </s-popover>
              </div>
              <div className={styles.dateField}>
                <s-text type="strong">End date</s-text>
                <s-button
                  variant="secondary"
                  commandFor="custom-end-date-popover"
                  command="--toggle"
                >
                  Select end date
                </s-button>
                <s-popover id="custom-end-date-popover">
                  <s-date-picker
                    type="single"
                    value={customEnd}
                    onChange={(event: Event) =>
                      setCustomEnd(
                        (event.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </s-popover>
              </div>
            </>
          ) : null}
        </div>
        <div className={styles.actionsRow}>
          <s-button
            variant="primary"
            onClick={runReport}
            disabled={!isConfigSaved || runFetcher.state === "submitting"}
          >
            Update data
          </s-button>
        </div>
      </s-section>

      <s-section heading="Summary">
        {!runData ? (
          <s-text color="subdued">
            Run a data load to see KPI summary, charts, and tables.
          </s-text>
        ) : (
          <div className={styles.summaryGrid}>
            <div className={styles.metricCard}>
              <s-text type="strong">Revenue</s-text>
              <s-text>{formatCurrency(summary!.revenue, currencyCode)}</s-text>
              <s-text color="subdued">{runData.range.label}</s-text>
            </div>
            <div className={styles.metricCard}>
              <s-text type="strong">Orders</s-text>
              <s-text>{summary!.orders}</s-text>
              <s-text color="subdued">{runData.range.label}</s-text>
            </div>
            <div className={styles.metricCard}>
              <s-text type="strong">Units</s-text>
              <s-text>{summary!.units}</s-text>
              <s-text color="subdued">{runData.range.label}</s-text>
            </div>
            <div className={styles.metricCard}>
              <s-text type="strong">AOV</s-text>
              <s-text>{formatCurrency(summary!.aov, currencyCode)}</s-text>
              <s-text color="subdued">{runData.range.label}</s-text>
            </div>
          </div>
        )}
      </s-section>

      <s-section heading="Launch progress">
        {!runData?.launch ? (
          <s-text color="subdued">Launch date not configured.</s-text>
        ) : (
          <div className={styles.summaryGrid}>
            <div className={styles.metricCard}>
              <s-text type="strong">Day 1 revenue</s-text>
              <s-text>
                {formatCurrency(runData.launch.day1.revenue, currencyCode)}
              </s-text>
              <s-text color="subdued">
                Goal: {config.goals.day1Revenue || "--"}
              </s-text>
            </div>
            <div className={styles.metricCard}>
              <s-text type="strong">Week 1 revenue</s-text>
              <s-text>
                {formatCurrency(runData.launch.week1.revenue, currencyCode)}
              </s-text>
              <s-text color="subdued">
                Goal: {config.goals.week1Revenue || "--"}
              </s-text>
            </div>
            <div className={styles.metricCard}>
              <s-text type="strong">Month 1 revenue</s-text>
              <s-text>
                {formatCurrency(runData.launch.month1.revenue, currencyCode)}
              </s-text>
              <s-text color="subdued">
                Goal: {config.goals.month1Revenue || "--"}
              </s-text>
            </div>
          </div>
        )}
      </s-section>

      <s-section heading="Top products">
        {!runData?.topProducts?.length ? (
          <s-text color="subdued">No product data available.</s-text>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span>Product</span>
              <span>Revenue</span>
              <span>Units</span>
            </div>
            {runData.topProducts.map((product) => (
              <div key={product.title} className={styles.tableRow}>
                <span title={product.title} className={styles.truncate}>
                  {product.title}
                </span>
                <span>{formatCurrency(product.revenue, currencyCode)}</span>
                <span>{product.units}</span>
              </div>
            ))}
          </div>
        )}
      </s-section>

      <s-section heading="Benchmark comparison">
        {!runData?.benchmarks?.length ? (
          <s-text color="subdued">No benchmark data available.</s-text>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span>Product</span>
              <span>Revenue</span>
              <span>Units</span>
              <span>Orders</span>
            </div>
            {runData.benchmarks.map((benchmark) => (
              <div key={benchmark.name} className={styles.tableRow}>
                <span title={benchmark.name} className={styles.truncate}>
                  {benchmark.name}
                </span>
                <span>{formatCurrency(benchmark.revenue, currencyCode)}</span>
                <span>{benchmark.units}</span>
                <span>{benchmark.orders}</span>
              </div>
            ))}
          </div>
        )}
      </s-section>

      <s-section heading="Segment goals">
        {!runData?.segments?.length ? (
          <s-text color="subdued">No segment data available.</s-text>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span>Segment</span>
              <span>Revenue</span>
              <span>Units</span>
              <span>Goals</span>
            </div>
            {runData.segments.map((segment) => (
              <div key={segment.label} className={styles.tableRow}>
                <span>{segment.label}</span>
                <span>{formatCurrency(segment.revenue, currencyCode)}</span>
                <span>{segment.units}</span>
                <span>
                  {segment.revenueGoal
                    ? `${formatCurrency(
                        segment.revenueGoal,
                        currencyCode,
                      )} / ${segment.unitsGoal || "--"}`
                    : "--"}
                </span>
              </div>
            ))}
          </div>
        )}
      </s-section>

      <s-section heading="Recent orders">
        {!runData?.recentOrders?.length ? (
          <s-text color="subdued">No recent orders found.</s-text>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span>Order</span>
              <span>Date</span>
              <span>Customer</span>
              <span>Total</span>
            </div>
            {runData.recentOrders.map((order) => (
              <div key={order.name} className={styles.tableRow}>
                <span>{order.name}</span>
                <span>{order.createdAt}</span>
                <span className={styles.truncate} title={order.customer}>
                  {order.customer}
                </span>
                <span>{formatCurrency(order.total, order.currencyCode)}</span>
              </div>
            ))}
          </div>
        )}
        {exportCsvUrl ? (
          <div className={styles.actionsRow}>
            <a className={styles.exportLink} href={exportCsvUrl} download>
              Export data (CSV)
            </a>
          </div>
        ) : null}
      </s-section>
    </s-page>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const configRecord = await prisma.goalsConfig.findUnique({
    where: { shop },
  });
  const latestRun = await prisma.goalsRun.findFirst({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
  return {
    shop,
    config: (configRecord?.data as GoalsConfig | null) ?? null,
    latestRun: (latestRun?.data as GoalsRunData | null) ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "resolve-benchmark-launch") {
    const productIdsPayload = formData.get("productIds");
    const productTitlesPayload = formData.get("productTitles");
    const productId = formData.get("productId");
    const productTitle = formData.get("productTitle");
    const productIds =
      typeof productIdsPayload === "string"
        ? (JSON.parse(productIdsPayload) as string[])
        : typeof productId === "string" && productId
          ? [productId]
          : [];
    const productTitles =
      typeof productTitlesPayload === "string"
        ? (JSON.parse(productTitlesPayload) as string[])
        : typeof productTitle === "string" && productTitle
          ? [productTitle]
          : [];
    if (!productIds.length) {
      return { ok: false, error: "Benchmark product is missing." };
    }
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'app.goals.tsx:resolve-benchmark-launch',message:'Resolve benchmark launch start',data:{count:productIds.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    let cachedLaunch: { firstSoldAt: Date | null } | null = null;
    let cacheAvailable = true;
    try {
      const results: Array<{
        productId: string;
        productTitle: string;
        launchDate: string;
      }> = [];

      for (const [index, id] of productIds.entries()) {
        const title = productTitles[index] ?? "";
        let cached = null as { firstSoldAt: Date | null } | null;
        try {
          cached = await prisma.benchmarkLaunch.findUnique({
            where: { shop_productId: { shop, productId: id } },
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "unknown error";
          cacheAvailable =
            !errorMessage.includes("BenchmarkLaunch") &&
            !errorMessage.includes("does not exist");
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'app.goals.tsx:resolve-benchmark-launch',message:'Benchmark cache lookup failed',data:{cacheAvailable,error:errorMessage},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          if (cacheAvailable) {
            return {
              ok: false,
              error: "Unable to read benchmark cache. Please try again.",
            };
          }
        }

        if (cached) {
          results.push({
            productId: id,
            productTitle: title,
            launchDate: cached.firstSoldAt ? formatDateOnly(cached.firstSoldAt) : "",
          });
          continue;
        }

        const response = await admin.graphql(
          `#graphql
          query BenchmarkProduct($id: ID!) {
            product(id: $id) {
              id
              title
              createdAt
            }
          }`,
          { variables: { id } },
        );
        const json = await response.json();
        if (json.errors || !json.data?.product) {
          return { ok: false, error: "Unable to load benchmark product." };
        }
        const product = json.data.product as {
          id: string;
          title: string;
          createdAt?: string;
        };
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H4',location:'app.goals.tsx:resolve-benchmark-launch',message:'Loaded product metadata',data:{productId:product.id,createdAt:product.createdAt || ""},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        const firstSoldAt = await findFirstSoldAtForProduct(
          admin,
          product.id,
          product.createdAt ?? null,
        );
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H4',location:'app.goals.tsx:resolve-benchmark-launch',message:'Computed first sold at',data:{firstSoldAt:firstSoldAt ? formatDateOnly(firstSoldAt) : ""},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        let savedDate = firstSoldAt;
        if (cacheAvailable) {
          const saved = await prisma.benchmarkLaunch.upsert({
            where: { shop_productId: { shop, productId: id } },
            update: {
              firstSoldAt,
              productTitle: title || product.title,
              computedAt: new Date(),
            },
            create: {
              shop,
              productId: id,
              productTitle: title || product.title,
              firstSoldAt,
              computedAt: new Date(),
            },
          });
          savedDate = saved.firstSoldAt;
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H5',location:'app.goals.tsx:resolve-benchmark-launch',message:'Persisted benchmark launch',data:{savedId:saved.id,hasDate:Boolean(saved.firstSoldAt)},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H5',location:'app.goals.tsx:resolve-benchmark-launch',message:'Skipped cache persistence (table missing)',data:{hasDate:Boolean(firstSoldAt)},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }

        results.push({
          productId: id,
          productTitle: title || product.title,
          launchDate: savedDate ? formatDateOnly(savedDate) : "",
        });
      }

      return { ok: true, results };
    } catch (error) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a8ed7416-6dce-4419-b2b3-cd6fbfab9bed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H5',location:'app.goals.tsx:resolve-benchmark-launch',message:'Resolve benchmark launch failed',data:{error: error instanceof Error ? error.message : "unknown"},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error.",
      };
    }
  }

  if (intent === "save-config") {
    const configJson = formData.get("configJson");
    if (typeof configJson !== "string") {
      return { ok: false, error: "Configuration payload missing." };
    }
    let parsedConfig: GoalsConfig;
    try {
      parsedConfig = JSON.parse(configJson) as GoalsConfig;
    } catch {
      return { ok: false, error: "Configuration payload invalid." };
    }
    const savedConfig = await prisma.goalsConfig.upsert({
      where: { shop },
      update: { data: parsedConfig },
      create: { shop, data: parsedConfig },
    });
    return { ok: true, config: savedConfig.data };
  }

  if (intent === "override-benchmark-launch") {
    const productId = formData.get("productId");
    const productTitle = formData.get("productTitle");
    const launchDate = formData.get("launchDate");
    if (typeof productId !== "string" || !productId) {
      return { ok: false, error: "Benchmark product is missing." };
    }
    if (typeof launchDate !== "string" || !launchDate) {
      return { ok: false, error: "Launch date is required." };
    }
    const startDate = new Date(launchDate);
    if (Number.isNaN(startDate.getTime())) {
      return { ok: false, error: "Launch date is invalid." };
    }
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);
    const formattedStart = formatDateOnly(startDate);
    const formattedEnd = formatDateOnly(endDate);
    try {
      const orders = await fetchOrders(admin, formattedStart, formattedEnd);
      const { launchRevenue, launchUnits } = buildBenchmarkOverrideMetrics(
        orders,
        productId,
      );
      let cacheAvailable = true;
      try {
        await prisma.benchmarkLaunch.upsert({
          where: { shop_productId: { shop, productId } },
          update: {
            firstSoldAt: startDate,
            productTitle:
              typeof productTitle === "string" && productTitle.trim().length > 0
                ? productTitle.trim()
                : undefined,
            computedAt: new Date(),
          },
          create: {
            shop,
            productId,
            productTitle:
              typeof productTitle === "string" && productTitle.trim().length > 0
                ? productTitle.trim()
                : undefined,
            firstSoldAt: startDate,
            computedAt: new Date(),
          },
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "unknown error";
        cacheAvailable =
          !errorMessage.includes("BenchmarkLaunch") &&
          !errorMessage.includes("does not exist");
        if (cacheAvailable) {
          return {
            ok: false,
            error: "Unable to update benchmark cache. Please try again.",
          };
        }
      }
      return {
        ok: true,
        productId,
        launchDate: formattedStart,
        launchRevenue,
        launchUnits,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error.",
      };
    }
  }

  if (intent === "run-report") {
    const configRecord = await prisma.goalsConfig.findUnique({
      where: { shop },
    });
    if (!configRecord?.data) {
      return { ok: false, error: "Please save a configuration first." };
    }
    const config = configRecord.data as GoalsConfig;
    const rangeType = String(formData.get("rangeType") ?? "last_30");
    const customStart = String(formData.get("customStart") ?? "");
    const customEnd = String(formData.get("customEnd") ?? "");

    const range = getDateRange(rangeType, config.launchDate, customStart, customEnd);
    if (!range) {
      return { ok: false, error: "Invalid date range." };
    }

    const rangeKey = `${range.startDate}:${range.endDate}:${range.label}`;
    const configHash = createHash("sha256")
      .update(JSON.stringify(config))
      .digest("hex");
    const cachedRun = await prisma.goalsRun.findFirst({
      where: { shop, rangeKey, configHash },
      orderBy: { createdAt: "desc" },
    });
    if (cachedRun?.data) {
      return { ok: true, run: cachedRun.data };
    }

    try {
      const orders = await fetchOrders(admin, range.startDate, range.endDate);
      const runData = buildRunData(orders, config, range);
      const savedRun = await prisma.goalsRun.create({
        data: {
          shop,
          rangeKey,
          configHash,
          data: runData,
        },
      });
      return { ok: true, run: savedRun.data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error.",
      };
    }
  }

  return { ok: false, error: "Unsupported request." };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

type OrderLineItem = {
  title: string;
  productId: string | null;
  quantity: number;
  unitPrice: number;
  currencyCode: string;
};

type NormalizedOrder = {
  name: string;
  createdAt: Date;
  customerName: string;
  customerEmail: string;
  tags: string[];
  locationName: string | null;
  channel: string | null;
  totalAmount: number;
  currencyCode: string;
  lineItems: OrderLineItem[];
};

const fetchOrders = async (admin: any, startDate: string, endDate: string) => {
  const orders: NormalizedOrder[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  const query = `created_at:>=${startDate} created_at:<=${endDate}`;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
      query OrdersForGoals($first: Int!, $after: String, $query: String) {
        orders(first: $first, after: $after, query: $query) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            name
            createdAt
            processedAt
            tags
            sourceName
            customer {
              displayName
              email
            }
            currentTotalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            fulfillmentOrders(first: 5) {
              nodes {
                assignedLocation {
                  name
                }
              }
            }
            lineItems(first: 100) {
              nodes {
                title
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                product {
                  id
                }
              }
            }
          }
        }
      }`,
      { variables: { first: 100, after, query } },
    );
    const json = await response.json();
    if (json.errors) {
      throw new Error("Shopify returned errors while loading orders.");
    }
    const payload = json.data.orders;
    payload.nodes.forEach((order: any) => {
      const totalMoney = order.currentTotalPriceSet?.shopMoney;
      const currencyCode = totalMoney?.currencyCode ?? "USD";
      const lineItems: OrderLineItem[] = order.lineItems.nodes.map(
        (item: any) => ({
          title: item.title,
          productId: item.product?.id ?? null,
          quantity: Number(item.quantity ?? 0),
          unitPrice: Number(item.originalUnitPriceSet?.shopMoney?.amount ?? 0),
          currencyCode: item.originalUnitPriceSet?.shopMoney?.currencyCode ?? currencyCode,
        }),
      );
      const locationName =
        order.fulfillmentOrders.nodes[0]?.assignedLocation?.name ?? null;
      orders.push({
        name: order.name,
        createdAt: new Date(order.processedAt ?? order.createdAt),
        customerName: order.customer?.displayName ?? "Guest",
        customerEmail: order.customer?.email ?? "",
        tags: order.tags ?? [],
        locationName,
        channel: order.sourceName ?? null,
        totalAmount: Number(totalMoney?.amount ?? 0),
        currencyCode,
        lineItems,
      });
    });
    hasNextPage = payload.pageInfo.hasNextPage;
    after = payload.pageInfo.endCursor;
  }
  return orders;
};

const findFirstSoldAtForProduct = async (
  admin: any,
  productId: string,
  productCreatedAt: string | null,
) => {
  let hasNextPage = true;
  let after: string | null = null;
  let pageCount = 0;
  const createdAtDate = productCreatedAt ? formatDateOnly(productCreatedAt) : "";
  const query = createdAtDate ? `created_at:>=${createdAtDate}` : undefined;

  while (hasNextPage && pageCount < 20) {
    const response = await admin.graphql(
      `#graphql
      query OrdersForBenchmark($first: Int!, $after: String, $query: String) {
        orders(
          first: $first
          after: $after
          query: $query
          sortKey: CREATED_AT
          reverse: false
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            createdAt
            processedAt
            lineItems(first: 100) {
              nodes {
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
                product {
                  id
                }
              }
            }
          }
        }
      }`,
      { variables: { first: 50, after, query } },
    );
    const json = await response.json();
    if (json.errors) {
      throw new Error("Shopify returned errors while loading benchmark orders.");
    }
    const payload = json.data.orders;
    for (const order of payload.nodes) {
      let matchedRevenue = 0;
      order.lineItems.nodes.forEach((item: any) => {
        if (item.product?.id === productId) {
          const amount = Number(item.originalUnitPriceSet?.shopMoney?.amount ?? 0);
          matchedRevenue += amount * Number(item.quantity ?? 0);
        }
      });
      if (matchedRevenue > 0) {
        return new Date(order.processedAt ?? order.createdAt);
      }
    }
    hasNextPage = payload.pageInfo.hasNextPage;
    after = payload.pageInfo.endCursor;
    pageCount += 1;
  }
  return null;
};

const buildBenchmarkOverrideMetrics = (
  orders: NormalizedOrder[],
  productId: string,
) => {
  let launchRevenue = 0;
  let launchUnits = 0;
  orders.forEach((order) => {
    order.lineItems.forEach((item) => {
      if (item.productId === productId) {
        launchRevenue += item.unitPrice * item.quantity;
        launchUnits += item.quantity;
      }
    });
  });
  return { launchRevenue, launchUnits };
};

const buildRunData = (
  orders: NormalizedOrder[],
  config: GoalsConfig,
  range: { startDate: string; endDate: string; label: string },
): GoalsRunData => {
  const targetProduct = config.targetProduct.trim();
  const filterByProduct =
    targetProduct.length > 0 && targetProduct !== "All products";
  const currencyCode = orders[0]?.currencyCode ?? "BRL";

  const dailyMap = new Map<string, { revenue: number; orders: number }>();
  let totalRevenue = 0;
  let totalUnits = 0;
  let totalOrders = 0;

  const revenueByProduct = new Map<string, { revenue: number; units: number }>();

  const validOrders: NormalizedOrder[] = [];

  orders.forEach((order) => {
    const matchingItems = filterByProduct
      ? order.lineItems.filter((item) =>
          item.title.toLowerCase().includes(targetProduct.toLowerCase()),
        )
      : order.lineItems;
    const revenue = filterByProduct
      ? matchingItems.reduce(
          (sum, item) => sum + item.unitPrice * item.quantity,
          0,
        )
      : order.totalAmount;
    const units = matchingItems.reduce((sum, item) => sum + item.quantity, 0);

    if (filterByProduct && matchingItems.length === 0) {
      return;
    }

    validOrders.push(order);
    totalRevenue += revenue;
    totalUnits += units;
    totalOrders += 1;

    const dateKey = order.createdAt.toISOString().slice(0, 10);
    const existing = dailyMap.get(dateKey) ?? { revenue: 0, orders: 0 };
    dailyMap.set(dateKey, {
      revenue: existing.revenue + revenue,
      orders: existing.orders + 1,
    });

    order.lineItems.forEach((item) => {
      const existingProduct = revenueByProduct.get(item.title) ?? {
        revenue: 0,
        units: 0,
      };
      revenueByProduct.set(item.title, {
        revenue: existingProduct.revenue + item.unitPrice * item.quantity,
        units: existingProduct.units + item.quantity,
      });
    });
  });

  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const topProducts = Array.from(revenueByProduct.entries())
    .map(([title, data]) => ({ title, revenue: data.revenue, units: data.units }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const recentOrders = [...validOrders]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20)
    .map((order) => ({
      name: order.name,
      createdAt: order.createdAt.toISOString().slice(0, 10),
      customer: order.customerName || order.customerEmail || "Guest",
      total: order.totalAmount,
      currencyCode: order.currencyCode,
    }));

  const segments = config.segments.map((segment) => {
    const segmentOrders = validOrders.filter((order) => {
      if (segment.type === "tag") {
        return order.tags.some((tag) => tag.toLowerCase() === segment.value.toLowerCase());
      }
      if (segment.type === "location") {
        return order.locationName?.toLowerCase() === segment.value.toLowerCase();
      }
      return order.channel?.toLowerCase() === segment.value.toLowerCase();
    });
    let revenue = 0;
    let units = 0;
    segmentOrders.forEach((order) => {
      const matchingItems = filterByProduct
        ? order.lineItems.filter((item) =>
            item.title.toLowerCase().includes(targetProduct.toLowerCase()),
          )
        : order.lineItems;
      const orderRevenue = filterByProduct
        ? matchingItems.reduce(
            (sum, item) => sum + item.unitPrice * item.quantity,
            0,
          )
        : order.totalAmount;
      const orderUnits = matchingItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      if (filterByProduct && matchingItems.length === 0) return;
      revenue += orderRevenue;
      units += orderUnits;
    });
    return {
      label: `${segment.type}: ${segment.value}`,
      revenue,
      units,
      revenueGoal: toNumber(segment.revenueGoal),
      unitsGoal: toNumber(segment.unitsGoal),
    };
  });

  const benchmarks = config.benchmarks.map((benchmark) => {
    const name = benchmark.name.trim();
    const productId = benchmark.productId ?? "";
    const hasIdentifier = Boolean(productId || name);
    if (!hasIdentifier) {
      return {
        name: "",
        launchDate: benchmark.launchDate ?? "",
        revenue: 0,
        units: 0,
        orders: 0,
        launchRevenue: 0,
        launchUnits: 0,
      };
    }
    const matchesBenchmarkItem = (item: OrderLineItem) => {
      if (productId) {
        return item.productId === productId;
      }
      return item.title.toLowerCase().includes(name.toLowerCase());
    };
    const benchmarkOrders = orders.filter((order) =>
      order.lineItems.some(matchesBenchmarkItem),
    );
    let revenue = 0;
    let units = 0;
    benchmarkOrders.forEach((order) => {
      order.lineItems.forEach((item) => {
        if (matchesBenchmarkItem(item)) {
          revenue += item.unitPrice * item.quantity;
          units += item.quantity;
        }
      });
    });
    const launchMetrics = getBenchmarkLaunchMetrics(
      orders,
      name,
      productId,
      benchmark.launchDate ?? "",
    );
    return {
      name: benchmark.name,
      productId: benchmark.productId,
      launchDate: benchmark.launchDate ?? "",
      revenue,
      units,
      orders: benchmarkOrders.length,
      launchRevenue: launchMetrics.launchRevenue,
      launchUnits: launchMetrics.launchUnits,
    };
  });

  const launch = getLaunchMetrics(orders, config.launchDate, targetProduct);

  const daily = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, revenue: data.revenue, orders: data.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const exportRows = validOrders.map((order) => ({
    order: order.name,
    date: order.createdAt.toISOString(),
    customer: order.customerName,
    total: order.totalAmount,
    currency: order.currencyCode,
    tags: order.tags.join("|"),
    location: order.locationName ?? "",
  }));

  return {
    range,
    summary: {
      revenue: totalRevenue,
      orders: totalOrders,
      units: totalUnits,
      aov,
      currencyCode,
    },
    launch,
    daily,
    topProducts,
    recentOrders,
    segments,
    benchmarks,
    exportRows,
  };
};

const getLaunchMetrics = (
  orders: NormalizedOrder[],
  launchDate: string,
  targetProduct: string,
) => {
  if (!launchDate) return null;
  const start = new Date(launchDate);
  if (Number.isNaN(start.getTime())) return null;
  const filterByProduct =
    targetProduct.length > 0 && targetProduct !== "All products";

  const buildMetric = (days: number) => {
    const end = new Date(start);
    end.setDate(end.getDate() + days);
    const filtered = orders.filter(
      (order) => order.createdAt >= start && order.createdAt < end,
    );
    let revenue = 0;
    let units = 0;
    let ordersCount = 0;
    filtered.forEach((order) => {
      const matchingItems = filterByProduct
        ? order.lineItems.filter((item) =>
            item.title.toLowerCase().includes(targetProduct.toLowerCase()),
          )
        : order.lineItems;
      const orderRevenue = filterByProduct
        ? matchingItems.reduce(
            (sum, item) => sum + item.unitPrice * item.quantity,
            0,
          )
        : order.totalAmount;
      const orderUnits = matchingItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      if (filterByProduct && matchingItems.length === 0) return;
      revenue += orderRevenue;
      units += orderUnits;
      ordersCount += 1;
    });
    return { revenue, units, orders: ordersCount };
  };

  return {
    day1: buildMetric(1),
    week1: buildMetric(7),
    month1: buildMetric(30),
  };
};

const getBenchmarkLaunchMetrics = (
  orders: NormalizedOrder[],
  benchmarkName: string,
  benchmarkProductId: string,
  launchDate: string,
) => {
  if (!launchDate) return { launchRevenue: 0, launchUnits: 0 };
  const start = new Date(launchDate);
  if (Number.isNaN(start.getTime())) return { launchRevenue: 0, launchUnits: 0 };
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  const benchmarkNameLower = benchmarkName.toLowerCase();
  let launchRevenue = 0;
  let launchUnits = 0;
  orders.forEach((order) => {
    if (order.createdAt < start || order.createdAt >= end) return;
    order.lineItems.forEach((item) => {
      const matchesBenchmark = benchmarkProductId
        ? item.productId === benchmarkProductId
        : item.title.toLowerCase().includes(benchmarkNameLower);
      if (matchesBenchmark) {
        launchRevenue += item.unitPrice * item.quantity;
        launchUnits += item.quantity;
      }
    });
  });
  return { launchRevenue, launchUnits };
};

const toNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getDateRange = (
  rangeType: string,
  launchDate: string,
  customStart: string,
  customEnd: string,
): { startDate: string; endDate: string; label: string } | null => {
  const today = new Date();
  const formatDate = (date: Date) => date.toISOString().slice(0, 10);
  const label = RANGE_OPTIONS.find((option) => option.value === rangeType)?.label ??
    "Custom";

  if (rangeType === "since_launch") {
    if (!launchDate) return null;
    const start = new Date(launchDate);
    if (Number.isNaN(start.getTime())) return null;
    return {
      startDate: formatDate(start),
      endDate: formatDate(today),
      label,
    };
  }

  if (rangeType === "last_7") {
    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    return { startDate: formatDate(start), endDate: formatDate(today), label };
  }

  if (rangeType === "last_30") {
    const start = new Date(today);
    start.setDate(start.getDate() - 30);
    return { startDate: formatDate(start), endDate: formatDate(today), label };
  }

  if (rangeType === "last_90") {
    const start = new Date(today);
    start.setDate(start.getDate() - 90);
    return { startDate: formatDate(start), endDate: formatDate(today), label };
  }

  if (rangeType === "this_month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startDate: formatDate(start), endDate: formatDate(today), label };
  }

  if (rangeType === "last_month") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { startDate: formatDate(start), endDate: formatDate(end), label };
  }

  if (rangeType === "custom") {
    if (!customStart || !customEnd) return null;
    return { startDate: customStart, endDate: customEnd, label: "Custom range" };
  }

  return null;
};

const formatDateOnly = (value: Date | string) => {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
};

const formatCurrency = (amount: number, currencyCode: string) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(amount);
};
