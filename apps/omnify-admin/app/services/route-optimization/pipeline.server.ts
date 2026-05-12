/**
 * Top-level orchestrator for the Phase 1 route-optimization pipeline.
 *
 * Wires the five stages — candidate-generator → rule-engine → quote-engine
 * → spatial-reasoner → decision-arbiter — into a single entry point that
 * `handleOptimize` (in api.control.$intent.tsx) calls when the
 * `routeOptimizationPhase1Enabled` per-location flag is set AND the global
 * env var `ROUTE_OPTIMIZATION_PHASE_1_ENABLED` is "true".
 *
 * Persists one `RouteOptimizationDecision` row per call for replay +
 * post-mortem (Phase 3) consumption. Returns enough information for the
 * caller to apply route tags and respond to the CLI.
 *
 * Defensive: if any unrecoverable error happens (e.g. database write
 * failure, geofence load failure), this function throws — `handleOptimize`
 * should catch and fall back to the legacy path.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import prisma from "../../db.server";
import type { LalamoveCredentials } from "../lalamove.server";
import { generateCandidates } from "./candidate-generator.server";
import { evaluateCandidates } from "./rule-engine.server";
import { quoteCandidates, type Quoter } from "./quote-engine.server";
import { buildLalamoveQuoter } from "./quoter-lalamove.server";
import {
  reasonAboutCandidates,
  type Reasoner,
} from "./spatial-reasoner.server";
import { buildAnthropicReasoner } from "./reasoner-anthropic.server";
import { loadV1Prompt } from "./prompts/loader";
import { arbitrate, ARBITER_VERSION } from "./decision-arbiter.server";
import { buildStaticMapUrl, fetchPngAsBase64 } from "./static-maps";
import type {
  ArbiterDecision,
  Candidate,
  CandidateOrderInput,
  Coordinate,
  GeofenceRegistry,
  MarketKey,
  QuoteResult,
  RuleResult,
  SpatialReasonerOutput,
} from "./types";

// ── Geofence registry loader (singleton) ───────────────────────────────────

let cachedRegistry: GeofenceRegistry | null = null;

function loadGeofenceRegistry(): GeofenceRegistry {
  if (cachedRegistry) return cachedRegistry;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const path = join(__dirname, "geofences", "brazil.json");
  const raw = readFileSync(path, "utf8");
  cachedRegistry = JSON.parse(raw) as GeofenceRegistry;
  return cachedRegistry;
}

// ── Input ──────────────────────────────────────────────────────────────────

export type PipelineInput = {
  shop: string;
  locationId: string;
  locationName: string;
  market: MarketKey;
  /** Tenant key for sparse-volume lookup (e.g. "ge-beauty"). */
  tenantKey: string;
  pickupCoordinates: Coordinate;
  orders: CandidateOrderInput[];
  serviceType: string;
  /** Market string accepted by Lalamove (e.g. "BR" — not the MarketKey above). */
  lalamoveMarket: string;
  lalamoveCredentials: LalamoveCredentials;
  /** Optional: when present + ANTHROPIC_API_KEY also set, the LLM is called. */
  staticMapsApiKey?: string;
  anthropicApiKey?: string;
  /**
   * Override the quoter (used in tests). Production calls
   * `buildLalamoveQuoter` internally.
   */
  quoterOverride?: Quoter;
  /** Override the reasoner (used in tests). */
  reasonerOverride?: Reasoner;
};

// ── Output ─────────────────────────────────────────────────────────────────

export type PipelineSuccess = {
  ok: true;
  decision: ArbiterDecision;
  decisionId: string;
  candidates: Candidate[];
  ruleResults: RuleResult[];
  quoteResults: QuoteResult[];
  reasonerOutput: SpatialReasonerOutput;
  /** Winning candidate's clustering — what handleOptimize applies as tags. */
  winningClustering: { slot: number; orderIds: string[] }[];
  /** Per-stage elapsed milliseconds, useful for SLO + cost monitoring. */
  timings: {
    generateMs: number;
    evaluateMs: number;
    quoteMs: number;
    reasonMs: number;
    arbitrateMs: number;
    persistMs: number;
    totalMs: number;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────────

function pickReasonerCandidate(candidates: Candidate[]): Candidate | undefined {
  // Prefer the optimizer-base for the rendered PNG (it's the broadest single
  // view). If only deferred/empty, no PNG is rendered.
  const base = candidates.find((c) => c.candidateType === "optimizer-base");
  if (base && base.clustering.length > 0) return base;
  return candidates.find((c) => c.clustering.length > 0);
}

// ── Orchestrator ───────────────────────────────────────────────────────────

export async function runRouteOptimizationPipeline(
  input: PipelineInput,
): Promise<PipelineSuccess> {
  const totalStart = Date.now();
  const registry = loadGeofenceRegistry();

  console.info(
    `[route-optimization] pipeline START shop=${input.shop} location=${input.locationId} orders=${input.orders.length} market=${input.market}`,
  );

  // 1. Candidate generation.
  const generateStart = Date.now();
  const candidates = generateCandidates({
    orders: input.orders,
    pickupCoordinates: input.pickupCoordinates,
    locationId: input.locationId,
    tenantKey: input.tenantKey,
    market: input.market,
    geofenceRegistry: registry,
  });
  const generateMs = Date.now() - generateStart;
  console.info(
    `[route-optimization] candidates generated count=${candidates.length} types=${candidates.map((c) => c.candidateType).join(",")} elapsed=${generateMs}ms`,
  );

  // 2. Rule evaluation.
  const evaluateStart = Date.now();
  const ruleResults = evaluateCandidates({
    candidates,
    orders: input.orders,
    pickupCoordinates: input.pickupCoordinates,
    market: input.market,
    locationId: input.locationId,
    tenantKey: input.tenantKey,
    geofenceRegistry: registry,
  });
  const evaluateMs = Date.now() - evaluateStart;
  console.info(`[route-optimization] rules evaluated elapsed=${evaluateMs}ms`);

  // 3. Quoting.
  const quoter =
    input.quoterOverride ??
    buildLalamoveQuoter({ credentials: input.lalamoveCredentials });
  const quoteStart = Date.now();
  const quoteResults = await quoteCandidates({
    candidates,
    orders: input.orders,
    pickupCoordinates: input.pickupCoordinates,
    market: input.lalamoveMarket,
    serviceType: input.serviceType,
    quoter,
  });
  const quoteMs = Date.now() - quoteStart;
  console.info(
    `[route-optimization] quotes received ok=${quoteResults.filter((q) => q.ok).length}/${quoteResults.length} elapsed=${quoteMs}ms`,
  );

  // 4. Spatial reasoning (LLM).
  const reasoner = input.reasonerOverride ?? buildAnthropicReasoner({ apiKey: input.anthropicApiKey });
  const prompt = loadV1Prompt();
  let pngUrl: string | undefined;
  let pngBase64: string | undefined;
  if (input.staticMapsApiKey && (input.anthropicApiKey || input.reasonerOverride)) {
    const target = pickReasonerCandidate(candidates);
    if (target) {
      pngUrl = buildStaticMapUrl({
        pickupCoordinates: input.pickupCoordinates,
        candidate: target,
        orders: input.orders,
        apiKey: input.staticMapsApiKey,
      });
      try {
        pngBase64 = await fetchPngAsBase64(pngUrl);
      } catch (err) {
        console.warn(`[route-optimization] PNG fetch failed; passing URL to reasoner`, err);
      }
    }
  }
  const reasonStart = Date.now();
  const reasonerResult = await reasonAboutCandidates({
    candidates,
    rules: ruleResults,
    quotes: quoteResults,
    orders: input.orders,
    pickupCoordinates: input.pickupCoordinates,
    market: input.market,
    locationName: input.locationName,
    pngUrl,
    pngBase64,
    geofenceRegistry: registry,
    systemPrompt: prompt.systemPrompt,
    promptVersion: prompt.version,
    reasoner,
  });
  const reasonMs = Date.now() - reasonStart;
  console.info(
    `[route-optimization] reasoner finalModel=${reasonerResult.diagnostics.finalModel} attempts=${reasonerResult.diagnostics.attempts.length} synthetic=${reasonerResult.diagnostics.fellBackToSynthetic} elapsed=${reasonMs}ms`,
  );

  // 5. Arbitration.
  const arbitrateStart = Date.now();
  const decision = arbitrate({
    candidates,
    ruleResults,
    quoteResults,
    reasonerOutput: reasonerResult.output,
  });
  const arbitrateMs = Date.now() - arbitrateStart;
  console.info(
    `[route-optimization] decision winner=${decision.winningCandidateId} path=${decision.decisionPath} confidence=${decision.confidence.toFixed(2)} flags=${decision.postMortemFlags.length} elapsed=${arbitrateMs}ms`,
  );

  // 6. Persist.
  const persistStart = Date.now();
  const persisted = await (prisma as unknown as {
    routeOptimizationDecision: {
      create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    };
  }).routeOptimizationDecision.create({
    data: {
      shop: input.shop,
      locationId: input.locationId,
      market: input.market,
      ordersDataJson: input.orders,
      candidatesJson: candidates,
      ruleResultsJson: ruleResults,
      quoteResultsJson: quoteResults,
      reasonerOutputJson: reasonerResult.output,
      winningCandidateId: decision.winningCandidateId,
      decisionPath: decision.decisionPath,
      rationale: decision.rationale,
      costSubunits: decision.costSubunits,
      costCurrency: decision.costCurrency,
      confidence: decision.confidence,
      postMortemFlagsJson: decision.postMortemFlags,
      promptVersion: prompt.version,
      arbiterVersion: ARBITER_VERSION,
    },
  });
  const persistMs = Date.now() - persistStart;
  console.info(
    `[route-optimization] decision persisted id=${persisted.id} elapsed=${persistMs}ms`,
  );

  const winningCandidate = candidates.find((c) => c.candidateId === decision.winningCandidateId);
  const winningClustering = winningCandidate?.clustering ?? [];

  return {
    ok: true,
    decision,
    decisionId: persisted.id,
    candidates,
    ruleResults,
    quoteResults,
    reasonerOutput: reasonerResult.output,
    winningClustering,
    timings: {
      generateMs,
      evaluateMs,
      quoteMs,
      reasonMs,
      arbitrateMs,
      persistMs,
      totalMs: Date.now() - totalStart,
    },
  };
}

// ── Feature-flag helper ───────────────────────────────────────────────────

/**
 * Returns true when the Phase 1 LLM-enabled optimizer should run for this
 * location. Requires BOTH:
 *   1. process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED === "true"
 *   2. The location's LalamoveConfig.data.routeOptimizationPhase1Enabled === true
 */
export function isPhase1EnabledForLocation(
  config: { routeOptimizationPhase1Enabled?: boolean | null },
): boolean {
  if (process.env.ROUTE_OPTIMIZATION_PHASE_1_ENABLED !== "true") return false;
  return Boolean(config.routeOptimizationPhase1Enabled);
}

/**
 * Map a LalamoveConfig `city` field to the MarketKey used by the geofence
 * registry. Returns "other" for unknown cities — caller should skip
 * Phase 1 in that case (the registry has no thresholds to apply).
 */
export function pickMarketKey(city: string | null | undefined): MarketKey {
  const c = (city ?? "").toLowerCase();
  if (c.includes("rio de janeiro") || c.includes("niter")) return "rio-de-janeiro";
  if (c.includes("são paulo") || c.includes("sao paulo")) return "sao-paulo";
  if (c.includes("recife")) return "recife";
  return "other";
}

/**
 * Build a `PipelineInput` from the shared shop/location/orders shape
 * every entry point (control API, UI optimize-fleet, auto-delivery cron)
 * already has on hand. Returns null when the location can't run Phase 1
 * (unknown market or missing Lalamove credentials) — caller falls back
 * to the legacy optimizer.
 *
 * Lalamove credentials are resolved via the standard shop credential
 * helper; pass `credentialsOverride` to skip the lookup (tests / cron
 * batch optimizations).
 */
export async function buildPhase1PipelineInput(args: {
  shop: string;
  locationId: string;
  config: {
    market: string;
    preferredServiceType: string;
    city?: string | null;
    locationName?: string | null;
  };
  pickupLat: number;
  pickupLng: number;
  orders: {
    id?: string;
    name: string;
    lat: number;
    lng: number;
    neighborhood?: string | null;
  }[];
  credentialsResolver: (shop: string) => Promise<{ apiKey: string; apiSecret: string } | null>;
  quoterOverride?: PipelineInput["quoterOverride"];
  reasonerOverride?: PipelineInput["reasonerOverride"];
}): Promise<PipelineInput | null> {
  const market = pickMarketKey(args.config.city);
  if (market === "other") return null;
  const credentials = await args.credentialsResolver(args.shop);
  if (!credentials) return null;

  return {
    shop: args.shop,
    locationId: args.locationId,
    locationName: args.config.locationName ?? "Pickup",
    market,
    tenantKey: args.shop.replace(".myshopify.com", "").replace(/-cosmeticos$/, ""),
    pickupCoordinates: { latitude: args.pickupLat, longitude: args.pickupLng },
    orders: args.orders.map((o) => ({
      name: o.name,
      orderId: o.id,
      coordinates: { latitude: o.lat, longitude: o.lng },
      neighborhood: o.neighborhood ?? undefined,
    })),
    serviceType: args.config.preferredServiceType,
    lalamoveMarket: args.config.market,
    lalamoveCredentials: credentials,
    staticMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    quoterOverride: args.quoterOverride,
    reasonerOverride: args.reasonerOverride,
  };
}
