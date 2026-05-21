/**
 * Post-mortem panel route.
 *
 * Operator-facing surface for reviewing auto-dispatched decisions made by
 * the Phase 1 LLM-enabled optimizer. Reads from `RouteOptimizationDecision`
 * (Phase 1.6 Prisma model); captures operator verdicts that feed the
 * rule-promotion-gate.
 *
 * URL: /app/local-delivery/post-mortem (list view)
 *      /app/local-delivery/post-mortem?selected=<id> (drilldown)
 *
 * Companion mockup: inputs/mockups/post-mortem-panel-v1.html
 * State matrices (back-row controls, unsaved-changes modal, verdict-capture)
 * govern the interactive surfaces.
 */

import { useEffect, useState } from "react";
import {
  Link,
  redirect,
  useBlocker,
  useFetcher,
  useLoaderData,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import type {
  Candidate,
  CandidateOrderInput,
  Coordinate,
  PostMortemFlag,
  QuoteResult,
  RuleResult,
  SpatialReasonerOutput,
} from "../services/route-optimization/types";
import { buildStaticMapUrl } from "../services/route-optimization/static-maps";
import type { LalamoveConfig } from "../services/carrier/lalamove-adapter.server";

import styles from "./app.local-delivery.post-mortem/styles.module.css";

// ── Types ──────────────────────────────────────────────────────────

type PeriodKey = "7d" | "30d" | "quarter";
type ChipFilter = "all" | "unreviewed" | "wrong-call" | "clean";

type ListRow = {
  id: string;
  createdAt: string;
  locationId: string;
  market: string;
  decisionPath: string;
  winningCandidateId: string;
  costSubunits: number;
  costCurrency: string;
  confidence: number;
  rationale: string;
  postMortemFlags: PostMortemFlag[];
  operatorReviewed: boolean;
  operatorVerdict: string | null;
  routeStopCount: number;
};

type DecisionDetail = ListRow & {
  candidates: Candidate[];
  ruleResults: RuleResult[];
  quoteResults: QuoteResult[];
  reasonerOutput: SpatialReasonerOutput | null;
  promptVersion: string;
  arbiterVersion: string;
  operatorComment: string | null;
  pickupCoordinates: Coordinate | null;
  ordersData: CandidateOrderInput[];
};

type Neighbors = { prevId: string | null; nextId: string | null; position: number; total: number };

type LoaderData = {
  /** Rows in scope for the current period + location (chip-filter not yet applied). */
  allRowsInPeriod: ListRow[];
  /** Rows after applying the chip filter — what the list view renders and the paginator walks. */
  filteredRows: ListRow[];
  counts: { all: number; unreviewed: number; wrongCall: number; clean: number };
  detail: DecisionDetail | null;
  filters: { period: PeriodKey; chip: ChipFilter; selectedId: string | null };
  mapUrl: string | null;
  neighbors: Neighbors | null;
  /** True when "all caught up" toast should render in the list view. */
  showAllCaughtUpToast: boolean;
};

// ── Loader ─────────────────────────────────────────────────────────

function startOfPeriod(period: PeriodKey): Date {
  const now = new Date();
  if (period === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return new Date(now.getTime() - 92 * 24 * 60 * 60 * 1000);
}

function applyChipFilter(rows: ListRow[], chip: ChipFilter): ListRow[] {
  switch (chip) {
    case "all":
      return rows;
    case "unreviewed":
      return rows.filter((r) => !r.operatorReviewed);
    case "wrong-call":
      return rows.filter((r) => r.operatorVerdict === "wrong-call");
    case "clean":
      return rows.filter(
        (r) => r.postMortemFlags.length === 0 && r.decisionPath === "auto-dispatch-eligible",
      );
    default:
      return rows;
  }
}

export async function loader({ request }: LoaderFunctionArgs): Promise<LoaderData> {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const period = (url.searchParams.get("period") ?? "7d") as PeriodKey;
  const chip = (url.searchParams.get("chip") ?? "all") as ChipFilter;
  const selectedId = url.searchParams.get("selected");
  const justApprovedFlag = url.searchParams.get("justApproved") === "1";

  const since = startOfPeriod(period);
  const prismaAny = prisma as unknown as {
    routeOptimizationDecision: {
      findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
      findUnique: (args: Record<string, unknown>) => Promise<unknown | null>;
    };
    lalamoveLocationConfig: {
      findUnique: (args: Record<string, unknown>) => Promise<unknown | null>;
    };
  };

  const rawRows = (await prismaAny.routeOptimizationDecision.findMany({
    where: { shop, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 80,
  })) as Array<{
    id: string;
    createdAt: Date;
    locationId: string;
    market: string;
    decisionPath: string;
    winningCandidateId: string;
    costSubunits: number;
    costCurrency: string;
    confidence: number;
    rationale: string;
    postMortemFlagsJson: PostMortemFlag[];
    operatorReviewed: boolean;
    operatorVerdict: string | null;
    candidatesJson: Candidate[];
  }>;

  const allRowsInPeriod: ListRow[] = rawRows.map((r) => {
    const cand = r.candidatesJson.find((c) => c.candidateId === r.winningCandidateId);
    const stopCount = cand
      ? cand.clustering.reduce((sum, slot) => sum + slot.orderIds.length, 0)
      : 0;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      locationId: r.locationId,
      market: r.market,
      decisionPath: r.decisionPath,
      winningCandidateId: r.winningCandidateId,
      costSubunits: r.costSubunits,
      costCurrency: r.costCurrency,
      confidence: r.confidence,
      rationale: r.rationale,
      postMortemFlags: r.postMortemFlagsJson,
      operatorReviewed: r.operatorReviewed,
      operatorVerdict: r.operatorVerdict,
      routeStopCount: stopCount,
    };
  });

  const counts = {
    all: allRowsInPeriod.length,
    unreviewed: allRowsInPeriod.filter((r) => !r.operatorReviewed).length,
    wrongCall: allRowsInPeriod.filter((r) => r.operatorVerdict === "wrong-call").length,
    clean: allRowsInPeriod.filter(
      (r) => r.postMortemFlags.length === 0 && r.decisionPath === "auto-dispatch-eligible",
    ).length,
  };

  const filteredRows = applyChipFilter(allRowsInPeriod, chip);

  // Detail + map URL + neighbors only when ?selected= is present.
  let detail: DecisionDetail | null = null;
  let mapUrl: string | null = null;
  let neighbors: Neighbors | null = null;

  if (selectedId) {
    const raw = (await prismaAny.routeOptimizationDecision.findUnique({
      where: { id: selectedId },
    })) as null | {
      id: string;
      shop: string;
      createdAt: Date;
      locationId: string;
      market: string;
      decisionPath: string;
      winningCandidateId: string;
      costSubunits: number;
      costCurrency: string;
      confidence: number;
      rationale: string;
      postMortemFlagsJson: PostMortemFlag[];
      operatorReviewed: boolean;
      operatorVerdict: string | null;
      operatorComment: string | null;
      candidatesJson: Candidate[];
      ruleResultsJson: RuleResult[];
      quoteResultsJson: QuoteResult[];
      reasonerOutputJson: SpatialReasonerOutput | null;
      promptVersion: string;
      arbiterVersion: string;
      ordersDataJson: CandidateOrderInput[];
    };

    if (raw && raw.shop === shop) {
      const cand = raw.candidatesJson.find((c) => c.candidateId === raw.winningCandidateId);
      const stopCount = cand
        ? cand.clustering.reduce((sum, slot) => sum + slot.orderIds.length, 0)
        : 0;

      // Look up pickup coordinates from LalamoveLocationConfig for map rendering.
      let pickupCoordinates: Coordinate | null = null;
      const configRow = (await prismaAny.lalamoveLocationConfig.findUnique({
        where: { shop_locationId: { shop, locationId: raw.locationId } },
      })) as null | { data: LalamoveConfig };
      if (configRow?.data && typeof configRow.data === "object") {
        const cfg = configRow.data as LalamoveConfig & { pickupLat?: number; pickupLng?: number };
        if (typeof cfg.pickupLat === "number" && typeof cfg.pickupLng === "number") {
          pickupCoordinates = { latitude: cfg.pickupLat, longitude: cfg.pickupLng };
        }
      }

      detail = {
        id: raw.id,
        createdAt: raw.createdAt.toISOString(),
        locationId: raw.locationId,
        market: raw.market,
        decisionPath: raw.decisionPath,
        winningCandidateId: raw.winningCandidateId,
        costSubunits: raw.costSubunits,
        costCurrency: raw.costCurrency,
        confidence: raw.confidence,
        rationale: raw.rationale,
        postMortemFlags: raw.postMortemFlagsJson,
        operatorReviewed: raw.operatorReviewed,
        operatorVerdict: raw.operatorVerdict,
        routeStopCount: stopCount,
        candidates: raw.candidatesJson,
        ruleResults: raw.ruleResultsJson,
        quoteResults: raw.quoteResultsJson,
        reasonerOutput: raw.reasonerOutputJson,
        promptVersion: raw.promptVersion,
        arbiterVersion: raw.arbiterVersion,
        operatorComment: raw.operatorComment,
        pickupCoordinates,
        ordersData: raw.ordersDataJson,
      };

      // Map URL (server-side build; <img src=> will fetch from the browser).
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (apiKey && pickupCoordinates && cand) {
        mapUrl = buildStaticMapUrl({
          pickupCoordinates,
          candidate: cand,
          orders: raw.ordersDataJson,
          apiKey,
        });
      }

      // Neighbors within the current filtered list.
      const idx = filteredRows.findIndex((r) => r.id === raw.id);
      if (idx >= 0) {
        neighbors = {
          prevId: idx > 0 ? filteredRows[idx - 1]!.id : null,
          nextId: idx < filteredRows.length - 1 ? filteredRows[idx + 1]!.id : null,
          position: idx + 1,
          total: filteredRows.length,
        };
      } else {
        // Selected decision isn't in the current filter (e.g. user filtered to
        // "Unreviewed" then approved this one). Still show its detail but with
        // no paginator neighbors.
        neighbors = { prevId: null, nextId: null, position: 0, total: filteredRows.length };
      }
    }
  }

  // Show the "all caught up" toast when the user lands on the list view
  // immediately after approving the last in their filter.
  const showAllCaughtUpToast = justApprovedFlag && filteredRows.length === 0;

  return {
    allRowsInPeriod,
    filteredRows,
    counts,
    detail,
    filters: { period, chip, selectedId },
    mapUrl,
    neighbors,
    showAllCaughtUpToast,
  };
}

// ── Action ─────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent !== "save-verdict") {
    return { ok: false, error: `unknown intent: ${intent ?? "<missing>"}` };
  }
  const decisionId = String(form.get("decisionId") ?? "");
  const verdict = String(form.get("verdict") ?? "");
  const comment = String(form.get("comment") ?? "");
  const nextHref = String(form.get("nextHref") ?? "");
  const via = String(form.get("via") ?? "form"); // "fast-pass" | "form" | "save-changes"

  if (!decisionId) return { ok: false, error: "decisionId required" };
  if (!["correct", "wrong-call", "edge-case"].includes(verdict)) {
    return { ok: false, error: `invalid verdict: ${verdict}` };
  }
  if ((verdict === "wrong-call" || verdict === "edge-case") && !comment.trim()) {
    return { ok: false, error: `reason required for ${verdict}` };
  }

  const prismaAny = prisma as unknown as {
    routeOptimizationDecision: {
      findUnique: (args: Record<string, unknown>) => Promise<unknown | null>;
      update: (args: Record<string, unknown>) => Promise<unknown>;
    };
  };

  const existing = (await prismaAny.routeOptimizationDecision.findUnique({
    where: { id: decisionId },
    select: { shop: true },
  })) as null | { shop: string };
  if (!existing) return { ok: false, error: "decision not found" };
  if (existing.shop !== shop) return { ok: false, error: "decision belongs to a different shop" };

  await prismaAny.routeOptimizationDecision.update({
    where: { id: decisionId },
    data: {
      operatorReviewed: true,
      operatorVerdict: verdict,
      operatorComment: comment.trim() || null,
    },
  });
  console.info(
    `[post-mortem] verdict saved shop=${shop} decisionId=${decisionId} verdict=${verdict} via=${via} commentLen=${comment.length}`,
  );

  // Auto-next: client-computed nextHref. Falls back to the list with a
  // justApproved flag for the success toast when no neighbor exists.
  if (nextHref) {
    return redirect(nextHref);
  }
  return { ok: true, decisionId, verdict };
}

// ── UI helpers ─────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCost(subunits: number, currency: string): string {
  if (subunits === 0) return "—";
  return `${currency} ${(subunits / 100).toFixed(2)}`;
}

function locationLabel(locationId: string): string {
  const tail = locationId.split("/").pop() ?? locationId;
  return `Loc ${tail.slice(-4)}`;
}

function chipsForRow(row: ListRow): { label: string; tone: "green" | "amber" | "red" | "blue" | "grey" }[] {
  const out: { label: string; tone: "green" | "amber" | "red" | "blue" | "grey" }[] = [];
  if (row.operatorReviewed) {
    const tone =
      row.operatorVerdict === "correct"
        ? "green"
        : row.operatorVerdict === "wrong-call"
          ? "red"
          : "amber";
    out.push({ label: `reviewed · ${row.operatorVerdict ?? "?"}`, tone });
  } else {
    out.push({ label: "unreviewed", tone: "blue" });
  }
  if (row.decisionPath === "auto-dispatch-eligible") {
    out.push({ label: "auto-dispatched", tone: "green" });
  } else if (row.decisionPath === "auto-dispatched-with-post-mortem-flag") {
    out.push({ label: "post-mortem flag", tone: "amber" });
  } else if (row.decisionPath === "auto-postponed-with-post-mortem-flag") {
    out.push({ label: "postponed", tone: "amber" });
  } else if (row.decisionPath === "exclude-from-optimize") {
    out.push({ label: "excluded", tone: "red" });
  }
  if (row.confidence < 0.7) {
    out.push({ label: `confidence ${row.confidence.toFixed(2)}`, tone: "grey" });
  }
  return out;
}

const CHIP_CLASS_MAP: Record<"green" | "amber" | "red" | "blue" | "grey", string> = {
  green: styles.chipGreen!,
  amber: styles.chipAmber!,
  red: styles.chipRed!,
  blue: styles.chipBlue!,
  grey: styles.chipGrey!,
};

const FILTER_LABELS: Record<ChipFilter, string> = {
  all: "All",
  unreviewed: "Unreviewed",
  "wrong-call": "Wrong calls",
  clean: "Clean",
};

// ── Page component ─────────────────────────────────────────────────

export default function PostMortemPanel() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const [params] = useSearchParams();

  function rowHref(id: string): string {
    const next = new URLSearchParams(params);
    next.set("selected", id);
    next.delete("justApproved");
    return `?${next.toString()}`;
  }
  function listHref(extra?: Record<string, string | null>): string {
    const next = new URLSearchParams(params);
    next.delete("selected");
    next.delete("justApproved");
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
    }
    const qs = next.toString();
    return qs ? `?${qs}` : ".";
  }
  function chipHref(chip: ChipFilter): string {
    const next = new URLSearchParams(params);
    next.set("chip", chip);
    next.delete("selected");
    next.delete("justApproved");
    return `?${next.toString()}`;
  }
  function periodHref(period: PeriodKey): string {
    const next = new URLSearchParams(params);
    next.set("period", period);
    next.delete("selected");
    next.delete("justApproved");
    return `?${next.toString()}`;
  }

  return (
    <s-page heading="Post-mortem panel">
      <s-section>
        <p className={styles.lede}>
          Review auto-dispatched routes from the LLM-enabled optimizer. Mark wrong calls so the
          system learns the rule. Verdicts feed the rule-promotion-gate; recurring patterns escalate
          to registry updates.
        </p>
      </s-section>

      {data.detail ? (
        <DrilldownView data={data} listHref={listHref} rowHref={rowHref} />
      ) : (
        <ListView
          data={data}
          chipHref={chipHref}
          periodHref={periodHref}
          rowHref={rowHref}
        />
      )}
    </s-page>
  );
}

// ── List view ──────────────────────────────────────────────────────

function ListView(props: {
  data: LoaderData;
  chipHref: (c: ChipFilter) => string;
  periodHref: (p: PeriodKey) => string;
  rowHref: (id: string) => string;
}) {
  const { data, chipHref, periodHref, rowHref } = props;
  return (
    <s-section>
      <div className={styles.filters}>
        <div className={styles.filterControl}>
          <span className={styles.filterLabel}>Period</span>
          <s-select
            label="Period"
            labelAccessibilityVisibility="exclusive"
            value={data.filters.period}
            onChange={(e) => {
              const v = (e.currentTarget as unknown as HTMLSelectElement).value as PeriodKey;
              window.location.search = periodHref(v).replace(/^\?/, "");
            }}
          >
            <s-option value="7d">Last 7 days</s-option>
            <s-option value="30d">Last 30 days</s-option>
            <s-option value="quarter">This quarter</s-option>
          </s-select>
        </div>
        <div className={styles.filterChipRow}>
          {(
            [
              ["all", data.counts.all],
              ["unreviewed", data.counts.unreviewed],
              ["wrong-call", data.counts.wrongCall],
              ["clean", data.counts.clean],
            ] as const
          ).map(([key, count]) => {
            const active = data.filters.chip === key;
            const cls = `${styles.filterChip} ${active ? styles.filterChipActive : ""}`;
            return (
              <Link key={key} to={chipHref(key)} className={cls} preventScrollReset>
                {FILTER_LABELS[key]} <span className={styles.filterChipCount}>{count}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {data.showAllCaughtUpToast && (
        <div className={styles.toastBanner}>
          <span>
            <strong>All caught up.</strong> Every decision in this view has been reviewed.
          </span>
        </div>
      )}

      {data.filteredRows.length === 0 ? (
        <div className={styles.empty}>
          {data.counts.all === 0 ? (
            <>
              <h3>No auto-dispatched decisions yet</h3>
              <p>
                Decisions appear here within seconds of being made. Make sure{" "}
                <code>routeOptimizationPhase1Enabled</code> is on for at least one location.
              </p>
            </>
          ) : (
            <>
              <h3>No decisions in this filter</h3>
              <p>
                Switch the filter chip to <strong>All</strong> to revisit reviewed decisions.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className={styles.list}>
          {data.filteredRows.map((row) => {
            const chips = chipsForRow(row);
            return (
              <Link key={row.id} to={rowHref(row.id)} className={styles.row} preventScrollReset>
                <div className={styles.rowMeta}>
                  <div className={styles.rowTop}>
                    <span className={styles.rowTs}>{formatTimestamp(row.createdAt)}</span>
                    <span className={styles.rowLoc}>{locationLabel(row.locationId)}</span>
                    <span className={styles.rowRoute}>
                      {row.winningCandidateId} · {row.routeStopCount} stops
                    </span>
                    <span className={styles.rowCost}>
                      {formatCost(row.costSubunits, row.costCurrency)}
                    </span>
                  </div>
                  <div className={styles.rowCommentary}>{row.rationale}</div>
                </div>
                <div className={styles.rowTags}>
                  {chips.map((c) => (
                    <span key={c.label} className={`${styles.chip} ${CHIP_CLASS_MAP[c.tone]}`}>
                      {c.label}
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </s-section>
  );
}

// ── Drilldown view ────────────────────────────────────────────────

function DrilldownView(props: {
  data: LoaderData;
  listHref: (extra?: Record<string, string | null>) => string;
  rowHref: (id: string) => string;
}) {
  const { data, listHref, rowHref } = props;
  const detail = data.detail!;
  const fetcher = useFetcher();

  // Track verdict + comment locally; compute dirty against saved state.
  const savedVerdict = (detail.operatorVerdict ?? "") as "" | "correct" | "wrong-call" | "edge-case";
  const savedComment = detail.operatorComment ?? "";
  const [verdict, setVerdict] = useState<typeof savedVerdict>(savedVerdict);
  const [comment, setComment] = useState(savedComment);

  // Reset state when the selected decision changes (after auto-next).
  useEffect(() => {
    setVerdict(savedVerdict);
    setComment(savedComment);
  }, [detail.id, savedVerdict, savedComment]);

  const dirty = verdict !== savedVerdict || comment !== savedComment;
  const reasonRequired = verdict === "wrong-call" || verdict === "edge-case";
  const reasonFilled = comment.trim().length > 0;
  const saving = fetcher.state !== "idle";

  // useBlocker intercepts navigation when the form is dirty.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    return dirty && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search;
  });

  // After fetcher completes with a redirect, react-router handles it. We
  // also need to clear local state when the loader returns a new detail
  // (handled by the useEffect above).

  // Build nextHref for auto-next. If a next neighbor exists, drill into it;
  // otherwise return to the list with the all-caught-up flag.
  function buildNextHref(): string {
    if (data.neighbors?.nextId) {
      return rowHref(data.neighbors.nextId);
    }
    return listHref({ justApproved: "1" });
  }

  function fastPassApprove() {
    const form = new FormData();
    form.set("intent", "save-verdict");
    form.set("decisionId", detail.id);
    form.set("verdict", "correct");
    form.set("comment", "");
    form.set("nextHref", buildNextHref());
    form.set("via", "fast-pass");
    fetcher.submit(form, { method: "post" });
  }

  function saveVerdict(viaTag: "form" | "save-changes") {
    if (!verdict) return;
    if (reasonRequired && !reasonFilled) return;
    const form = new FormData();
    form.set("intent", "save-verdict");
    form.set("decisionId", detail.id);
    form.set("verdict", verdict);
    form.set("comment", comment);
    form.set("nextHref", buildNextHref());
    form.set("via", viaTag);
    fetcher.submit(form, { method: "post" });
  }

  // Top-right element state machine.
  // - Unreviewed → "Mark approved" primary button
  // - Reviewed, no dirty → subdued "Reviewed" badge
  // - Reviewed, dirty → "Save changes" primary button
  const topRight: "approve" | "reviewed-badge" | "save-changes" =
    !detail.operatorReviewed
      ? "approve"
      : dirty
        ? "save-changes"
        : "reviewed-badge";

  const headerChips = [
    ...chipsForRow({
      ...detail,
      // Hide the "unreviewed" chip on the header when we're about to show
      // the verdict chip below it — but chipsForRow handles that already.
    }),
  ];
  if (dirty && detail.operatorReviewed) {
    headerChips.push({ label: "unsaved edits", tone: "amber" });
  }

  const winningRule = detail.ruleResults.find((r) => r.candidateId === detail.winningCandidateId);
  const reasonerByCand = new Map(
    (detail.reasonerOutput?.candidates ?? []).map((c) => [c.candidateId, c]),
  );

  return (
    <s-section>
      <div className={styles.body}>
        <div className={styles.main}>
          {data.mapUrl ? (
            <div className={styles.mapFrame}>
              <img
                className={styles.mapImg}
                src={data.mapUrl}
                alt={`Route map for ${detail.winningCandidateId}`}
              />
            </div>
          ) : (
            <div className={styles.mainEmpty}>
              <h3>Map unavailable</h3>
              <p>
                Couldn&apos;t render the route map. The location may be missing pickup
                coordinates, or <code>GOOGLE_MAPS_API_KEY</code> isn&apos;t configured.
              </p>
            </div>
          )}
        </div>

        <div className={styles.aside}>
          <div className={styles.backRow}>
            <Link to={listHref()} className={styles.backToList}>
              Back to all decisions
            </Link>
            <Paginator data={data} rowHref={rowHref} />
            {topRight === "approve" && (
              <button
                type="button"
                className={`${styles.btnApprove} ${styles.withCheck}`}
                onClick={fastPassApprove}
                disabled={saving}
              >
                {saving ? "Approving…" : "Mark approved"}
              </button>
            )}
            {topRight === "reviewed-badge" && (
              <span className={styles.badgeReviewed} aria-label="Already reviewed">
                Reviewed
              </span>
            )}
            {topRight === "save-changes" && (
              <button
                type="button"
                className={styles.btnApprove}
                onClick={() => saveVerdict("save-changes")}
                disabled={saving || (reasonRequired && !reasonFilled)}
                title={reasonRequired && !reasonFilled ? "Reason required" : undefined}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            )}
          </div>

          <div className={styles.decisionHeader}>
            <h3>Decision · {formatTimestamp(detail.createdAt)}</h3>
            <div className={styles.decisionHeaderMeta}>
              <span>
                <strong>{locationLabel(detail.locationId)}</strong>
              </span>
              <span className="sep">·</span>
              <span>{detail.routeStopCount} stops</span>
              <span className="sep">·</span>
              <span>
                {formatCost(detail.costSubunits, detail.costCurrency)} · {detail.winningCandidateId}
              </span>
              <span className="sep">·</span>
              <code>{detail.id}</code>
            </div>
            <div className={styles.decisionHeaderChips}>
              {headerChips.map((c) => (
                <span key={c.label} className={`${styles.chip} ${CHIP_CLASS_MAP[c.tone]}`}>
                  {c.label}
                </span>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>What the AI did</h3>
            <dl className={styles.pair}>
              <dt>Path</dt>
              <dd>{detail.decisionPath}</dd>
              <dt>Winner</dt>
              <dd>{detail.winningCandidateId}</dd>
              <dt>Confidence</dt>
              <dd>
                {detail.confidence.toFixed(2)} (
                {detail.confidence >= 0.85 ? "high" : detail.confidence >= 0.7 ? "medium" : "low"})
              </dd>
              <dt>Cost</dt>
              <dd>{formatCost(detail.costSubunits, detail.costCurrency)}</dd>
              <dt>Prompt</dt>
              <dd>
                {detail.promptVersion} · arbiter {detail.arbiterVersion}
              </dd>
            </dl>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Reasoning</h3>
            <p className={styles.reasoning}>{detail.rationale}</p>
          </div>

          {winningRule && winningRule.ruleViolations.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Rules triggered</h3>
              <ul className={styles.ruleList}>
                {winningRule.ruleViolations.map((v) => (
                  <li key={v.ruleId}>
                    <span className={styles.ruleName}>{v.ruleId}</span>
                    <span className={styles.ruleDesc}>
                      {v.severity} · {v.explanation}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Candidates considered</h3>
            <table className={styles.candTable}>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th className={styles.candCostCol}>Cost</th>
                  <th className={styles.candScoreCol}>Score</th>
                  <th>Verdict</th>
                </tr>
              </thead>
              <tbody>
                {detail.candidates.map((c) => {
                  const quote = detail.quoteResults.find((q) => q.candidateId === c.candidateId);
                  const review = reasonerByCand.get(c.candidateId);
                  const rule = detail.ruleResults.find((r) => r.candidateId === c.candidateId);
                  const isWinner = c.candidateId === detail.winningCandidateId;
                  const tone =
                    rule?.severityVerdict === "hard-violation"
                      ? "red"
                      : rule?.severityVerdict === "soft-violation"
                        ? "amber"
                        : isWinner
                          ? "green"
                          : "grey";
                  const label = isWinner
                    ? "winner"
                    : rule?.severityVerdict === "hard-violation"
                      ? "hard viol."
                      : rule?.severityVerdict === "soft-violation"
                        ? "soft viol."
                        : "ok";
                  return (
                    <tr key={c.candidateId} className={isWinner ? styles.candWinner : ""}>
                      <td>{c.candidateId}</td>
                      <td className={styles.candCostCol}>
                        {quote?.ok
                          ? formatCost(quote.grandTotalSubunits, quote.grandTotalCurrency)
                          : "—"}
                      </td>
                      <td className={styles.candScoreCol}>
                        {review ? review.score.toFixed(2) : "—"}
                      </td>
                      <td>
                        <span className={`${styles.chip} ${CHIP_CLASS_MAP[tone]}`}>{label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <VerdictForm
            detail={detail}
            verdict={verdict}
            comment={comment}
            dirty={dirty}
            saving={saving}
            onVerdictChange={setVerdict}
            onCommentChange={setComment}
            onSubmit={() => saveVerdict("form")}
          />
        </div>
      </div>

      {blocker.state === "blocked" && (
        <UnsavedChangesModal
          onSaveAndContinue={async () => {
            if (!verdict) return;
            if (reasonRequired && !reasonFilled) {
              // Can't save with invalid form — fall through to discard or cancel.
              return;
            }
            const form = new FormData();
            form.set("intent", "save-verdict");
            form.set("decisionId", detail.id);
            form.set("verdict", verdict);
            form.set("comment", comment);
            // Don't auto-next here; let the blocker proceed to the target the
            // user actually clicked.
            fetcher.submit(form, { method: "post" });
            blocker.proceed?.();
          }}
          onDiscard={() => blocker.proceed?.()}
          onCancel={() => blocker.reset?.()}
          pendingSummary={`verdict ${savedVerdict || "(empty)"} → ${verdict || "(empty)"}${comment !== savedComment ? " · comment changed" : ""}`}
        />
      )}
    </s-section>
  );
}

// ── Paginator ──────────────────────────────────────────────────────

function Paginator({ data, rowHref }: { data: LoaderData; rowHref: (id: string) => string }) {
  const n = data.neighbors;
  const filterLabel = FILTER_LABELS[data.filters.chip];
  if (!n) return null;

  const prevDisabled = !n.prevId;
  const nextDisabled = !n.nextId;
  const prevClass = `${styles.paginatorBtn} ${prevDisabled ? styles.paginatorBtnDisabled : ""}`;
  const nextClass = `${styles.paginatorBtn} ${nextDisabled ? styles.paginatorBtnDisabled : ""}`;

  return (
    <div className={styles.paginator} role="navigation" aria-label="Decision pagination">
      {prevDisabled ? (
        <span className={prevClass} aria-disabled="true">
          ‹
        </span>
      ) : (
        <Link
          to={rowHref(n.prevId!)}
          className={prevClass}
          aria-label="Previous decision"
          preventScrollReset
        >
          ‹
        </Link>
      )}
      <span className={styles.paginatorCount} title={`Filter: ${filterLabel}`}>
        <strong>{n.position || "?"}</strong> of {n.total}
      </span>
      {nextDisabled ? (
        <span className={nextClass} aria-disabled="true">
          ›
        </span>
      ) : (
        <Link
          to={rowHref(n.nextId!)}
          className={nextClass}
          aria-label="Next decision"
          preventScrollReset
        >
          ›
        </Link>
      )}
    </div>
  );
}

// ── Verdict form ───────────────────────────────────────────────────

function VerdictForm(props: {
  detail: DecisionDetail;
  verdict: "" | "correct" | "wrong-call" | "edge-case";
  comment: string;
  dirty: boolean;
  saving: boolean;
  onVerdictChange: (v: "" | "correct" | "wrong-call" | "edge-case") => void;
  onCommentChange: (c: string) => void;
  onSubmit: () => void;
}) {
  const { detail, verdict, comment, dirty, saving, onVerdictChange, onCommentChange, onSubmit } = props;
  const reasonRequired = verdict === "wrong-call" || verdict === "edge-case";
  const reasonFilled = comment.trim().length > 0;
  // Save Verdict button visible when:
  //   - Unreviewed + a verdict has been picked, OR
  //   - Reviewed AND dirty (the operator changed something).
  const showSaveBtn = (!detail.operatorReviewed && verdict !== "") || (detail.operatorReviewed && dirty);
  const disableSaveBtn = reasonRequired && !reasonFilled;

  return (
    <div className={styles.verdict}>
      <h3 className={styles.verdictTitle}>Your verdict</h3>
      <div className={styles.verdictOptions}>
        {(
          [
            ["correct", "Correct", "The AI made the right call."],
            ["wrong-call", "Wrong call", "The AI's choice was suboptimal."],
            ["edge-case", "Edge case", "Right but unusual; worth tracking."],
          ] as const
        ).map(([value, label, help]) => {
          const selected = verdict === value;
          const cls = `${styles.verdictOption} ${selected ? styles.verdictOptionSelected : ""}`;
          return (
            <label key={value} className={cls}>
              <input
                type="radio"
                name="verdict"
                value={value}
                checked={selected}
                onChange={() => onVerdictChange(value)}
              />
              <span className={styles.verdictLabel}>{label}</span>
              <span className={styles.verdictHelp}>{help}</span>
            </label>
          );
        })}
      </div>
      <textarea
        className={styles.verdictComment}
        placeholder={reasonRequired ? "Reason (required)" : "Reason (optional)"}
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
      />
      {showSaveBtn && (
        <>
          <div className={styles.verdictActions}>
            <button
              type="button"
              className={styles.btnApprove}
              onClick={onSubmit}
              disabled={disableSaveBtn || saving}
              title={disableSaveBtn ? "Reason required" : undefined}
            >
              {saving ? "Saving…" : "Save verdict"}
            </button>
          </div>
          {disableSaveBtn && (
            <div className={styles.verdictHint}>Reason required for {verdict}.</div>
          )}
        </>
      )}
    </div>
  );
}

// ── Unsaved-changes modal ─────────────────────────────────────────

function UnsavedChangesModal(props: {
  onSaveAndContinue: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  pendingSummary: string;
}) {
  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className={styles.modalCard}>
        <h3 id="modal-title">Save changes before leaving?</h3>
        <div className={styles.modalBody}>
          <p>
            You&apos;ve edited this decision&apos;s verdict but haven&apos;t saved yet. Leaving
            now will discard your edits.
          </p>
          <p>Pending: {props.pendingSummary}.</p>
        </div>
        <div className={styles.modalActions}>
          <div className={styles.modalActionsLeft}>
            <button type="button" className={`${styles.btnSecondary} ${styles.critical}`} onClick={props.onDiscard}>
              Discard changes
            </button>
          </div>
          <div className={styles.modalActionsRight}>
            <button type="button" className={styles.btnSecondary} onClick={props.onCancel}>
              Cancel
            </button>
            <button type="button" className={styles.btnApprove} onClick={props.onSaveAndContinue}>
              Save &amp; continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
