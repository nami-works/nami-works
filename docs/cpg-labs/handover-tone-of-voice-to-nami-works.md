# Handover — Move Tone-of-Voice from CPG Labs (Shopify admin) to NAMI Works — 2026-05-16

> **Audience:** the next session working in the `nami-works` repo (Desktop/nami-works/, github.com/nami-works/nami-works). This document is written FROM the cpg-labs side; everything described as "today / current state" lives in cpg-labs and is what you're going to consume, replace, or replicate.

## Why move it

CPG Labs just shipped Wave 3 of the Tone-of-Voice (TOV) system inside the embedded Shopify admin app (PR #77, branch `feat/storytelling-wave3-impl`, deployed 2026-05-12 as image `a98e066`). The system samples copy from 4 sources (Shopify blog, Meta IG/FB, Monday.com, manual file/URL uploads), runs a Claude inference pass over the raw text, and surfaces trait hypotheses for the merchant to accept/reject. The accepted traits then steer downstream content generation (blog drafts, alt text, future flows).

**The structural problem:** because everything lives behind the Shopify embedded session, only Shopify merchants who installed Omnify can *build* a brand voice. That conflates "I use Shopify" with "I can model my brand voice" — two unrelated things. A brand exists before it has a Shopify store; a brand can serve channels Shopify never sees (D2C site, retail, wholesale, paid social, customer service). Restricting TOV creation to Shopify admins kills the addressable market of the TOV product on day one.

**The inversion:** TOV becomes a first-class NAMI Works product (multi-tenant, MCP-native, web UI accessible to anyone), and the Shopify admin app becomes a *consumer* of it. The UI we just shipped at `/app/settings/brand/tone-sources` keeps its visual language, but its data layer talks to nami-works via API/MCP instead of cpg-labs Postgres. Shopify identity auto-selects the tenant; non-Shopify users sign into nami-works directly.

This also fixes a real cross-system gap the user flagged: even with a perfect TOV inside the Shopify app, today there's no way for external systems (ChatGPT, ad platforms, briefing tools, the merchant's own Notion) to consume it. Moving TOV to nami-works + exposing it as MCP solves both problems with one architecture.

## Current state in CPG Labs (what you're inheriting)

### Data model — `cpg-labs/prisma/schema.prisma`

```prisma
model BrandToneSource {
  id              String   @id @default(cuid())
  shop            String           // <-- becomes tenantId in nami-works
  sourceType      String           // shopify_blog | meta_ig | meta_fb | monday | manual_upload | manual_url
  sourceId        String           // stable external id (article gid, item id, upload id...)
  sourceUrl       String?
  capturedAt      DateTime @default(now())
  rawText         String           // up to 50k chars per row, truncated server-side
  contentLanguage String?
  metaJson        Json?            // source-specific metadata (boardId, postPermalink, filename, etc.)
  batchId         String
  @@unique([shop, sourceType, sourceId])
}

model BrandToneHypothesis {
  id         String    @id @default(cuid())
  shop       String
  batchId    String
  category   String    // voice | vocabulary | do | dont | register | structure
  statement  String
  evidence   Json      // [{ sourceType, sourceId, snippet }, ...]
  confidence Float
  status     String    @default("pending_review")  // pending_review | accepted | rejected
  createdAt  DateTime  @default(now())
  reviewedAt DateTime?
}

model BrandIntegrationConfig {
  id              String   @id @default(cuid())
  shop            String
  integrationType String   // monday | meta
  configCipher    String   // AES-256-GCM ciphertext of full config (apiKey, boardIds, filters[], etc.)
  keyVersion      Int      @default(1)
  enabled         Boolean  @default(true)
  @@unique([shop, integrationType])
}
```

Plus the manual override string lives on the `Shop` table as `toneOfVoice` (and `preferredLanguage`, `contentLanguage`). The brand bible export endpoint stitches all of this together as JSON / Markdown.

### Services — `cpg-labs/app/services/tone-sources/`

| File | What it does |
|---|---|
| `service.server.ts` | The aggregation/listing layer — `listSourceSummaries`, `listPendingHypotheses`, `listRecentBatches`, `acceptHypothesis`, `rejectHypothesis`, `makeBatchId`. Tenant-aware on `shop`. |
| `shopify.server.ts` | Pulls articles from the merchant's Shopify Admin GraphQL (5 blogs × 25 most recent articles), normalizes to `BrandToneSource`. |
| `meta.server.ts` | Pulls Instagram + Facebook posts via Meta Graph API. Stores encrypted token + IG Business ID / FB Page ID in `BrandIntegrationConfig`. |
| `monday.server.ts` | Pulls Monday.com board items via GraphQL. Stores encrypted API key + board IDs + filter rules in `BrandIntegrationConfig`. Phase-A/B/C/D filter flow just shipped in Wave 3 — `fetchMondaySchema` introspects column types and exposes status values for the rule builder. |
| `manual.server.ts` | File upload (PDF/DOCX/TXT/MD, ≤30MB, S3-backed binary + text extraction via Claude vision for PDFs) + URL fetch (HTML → readable text). |
| `inference.server.ts` | The Claude pass that turns raw `BrandToneSource` rows into `BrandToneHypothesis` rows. Categorizes traits, attaches evidence snippets, scores confidence. |
| `s3.server.ts` | Tenant-scoped S3 client for manual uploads. |
| `types.ts` | `ToneSourceType`, `ToneHypothesisCategory`, etc. |

### Encryption — `cpg-labs/app/services/security/encryption.server.ts`

AES-256-GCM with `keyVersion` rotation support. The active key is `TONE_INTEGRATION_KEY_V<N>` in env. Same pattern as Lalamove credential storage. **Migrate the key material into nami-works SSM (`/nami-works/tenants/<tenant>/tone-key-v<N>`) at cutover, not just the table rows.**

### UI — `cpg-labs/app/routes/app.settings_.brand_.tone-sources.tsx` + sibling CSS module

The page that orchestrates everything: accordion source rows (Shopify auto / Meta tabbed onboarding / Monday tabbed flow with column introspection / Manual references with Polaris file picker + dropzone + URL row), pending-hypothesis review list, past batches table, brand-bible export button. ~2300 lines, Polaris web components throughout. This stays in cpg-labs after migration — but its loader/action become thin proxies to the nami-works API.

### Cron — `cpg-labs/app/routes/api.cron.weekly-tone-and-diff.tsx`

Weekly job (Mon 03:00 UTC, Lightsail crontab line `weekly-tone-and-diff`) that re-samples every connected source + runs inference + queues new hypotheses. This logic moves to nami-works; the Shopify admin keeps a "Refresh now" button that hits the nami-works API.

### Public-facing today

- Brand bible JSON / Markdown export on the Brand settings page (manual download only — not programmatic).
- No external API. No bearer-auth endpoint for TOV.

## Target state in NAMI Works (what to build)

### 1. Multi-tenant data model

Use the existing `Tenant` model in nami-works as the parent. Rename `shop → tenantId` across the four tables above and move them into the nami-works Postgres. Add a `TenantBrand` (or similar) row that holds the equivalent of the current `Shop.toneOfVoice` / `preferredLanguage` / `contentLanguage` columns.

Backfill: every existing CPG Labs shop becomes a nami-works tenant with `source: "shopify"` and a link back to the `shop` myshopify domain. New non-Shopify tenants come in through the nami-works signup flow.

### 2. HTTP API (the "control plane" for both Shopify admin and external clients)

Mirror cpg-labs' existing `/api/control/*` bearer-auth pattern (see `docs/handover-local-delivery-control-api.md` for the convention). Endpoints (all bearer-auth, tenant derived from token):

```
GET    /api/tone/sources                              # ToneSource summaries by type
GET    /api/tone/hypotheses?status=pending_review     # active hypotheses
POST   /api/tone/hypotheses/:id/accept
POST   /api/tone/hypotheses/:id/reject
GET    /api/tone/batches?limit=10
POST   /api/tone/batches/refresh                      # = current "Refresh tone now"
GET    /api/tone/brand-bible.json
GET    /api/tone/brand-bible.md

GET    /api/tone/integrations/monday                  # config (sans apiKey)
POST   /api/tone/integrations/monday
DELETE /api/tone/integrations/monday
POST   /api/tone/integrations/monday/schema           # fetchMondaySchema
POST   /api/tone/integrations/monday/filters
GET    /api/tone/integrations/meta
POST   /api/tone/integrations/meta
DELETE /api/tone/integrations/meta

POST   /api/tone/manual-references                    # multipart upload OR { url }
GET    /api/tone/manual-references
DELETE /api/tone/manual-references/:id
```

The Shopify admin's loader/action handlers become thin HTTP clients against these endpoints. Auth: when the embedded admin calls in, it presents a tenant-scoped service token (provisioned per-shop at Omnify install time, stored in SSM `/omnify/tenants/<shop>/nami-token`). External callers (the merchant's own scripts) get their own token rotated through the nami-works dashboard.

### 3. MCP server tools (the win)

Expose the same data as MCP tools inside the existing `mcp.nami.works` server (which already serves Shopify + Omie tools per `reference_nami_works_repo.md`):

- `get_tone_of_voice(tenant)` → accepted traits + manual tone string + language. The canonical "what does this brand sound like" call.
- `get_brand_bible(tenant, format="md"|"json")` → full export.
- `list_pending_hypotheses(tenant, min_confidence=0.5)` → for a CLI/agent reviewer.
- `accept_hypothesis(tenant, id)` / `reject_hypothesis(tenant, id)`.
- `refresh_tone(tenant)` → trigger the sample + inference pipeline.

Tool implementations are thin: each one wraps the HTTP API above using the tenant's service token. This means the API is the source of truth; MCP is just an adapter shape Claude conversations can call. The Python client pattern at `nami-works/sandbox/gebeauty/scripts/cpg_control.py` is the model — same idea, MCP tool surface instead of CLI subcommand.

### 4. Web UI (for non-Shopify users)

Standalone React/Next/Astro page at `nami-works/web/` (whatever framework the nami-works app uses) that replicates the cpg-labs `tone-sources` UI without the Shopify-admin chrome. Same 4 sources, same accept/reject hypothesis flow, same brand-bible export. The Shopify admin's version stays Polaris-embedded; this version uses whatever the nami-works design system is.

Both UIs hit the same API. They are sibling views, not master/copy.

### 5. Inference engine

Move `inference.server.ts` and the Claude prompt template into nami-works. Run it on the same shape of `BrandToneSource` rows. Same model, same confidence threshold, same evidence-snippet contract. Add a `tenant.languagePreference` input so non-English brands aren't forced to English hypotheses.

### 6. Sampling adapters

Move `shopify.server.ts`, `meta.server.ts`, `monday.server.ts`, `manual.server.ts` to nami-works' `services/tone-sources/`. The Shopify adapter changes: instead of using the embedded session, it accepts the Shopify Admin API token from the tenant config (already how nami-works' existing Shopify MCP tools authenticate). Meta + Monday adapters don't change — they were always token-based, not session-based.

## Migration plan

**Phase 0 — design alignment (this handover).** Read this doc + the actual cpg-labs source listed above. Decide tenant model, naming conventions, where the web UI lives in the nami-works repo.

**Phase 1 — schema + API live in parallel.** Build the tables + endpoints in nami-works. No data migration yet. The Shopify admin still uses cpg-labs Postgres. Smoke-test the API with a test tenant (the GE Beauty tenant is the obvious one — already in nami-works as `sandbox/gebeauty/`).

**Phase 2 — Shopify admin reads from nami-works (write still cpg-labs).** Loader on `app.settings_.brand_.tone-sources.tsx` hits nami-works for `sources` + `hypotheses` + `batches`. Action handlers still write to cpg-labs Postgres. This proves the read path end-to-end without risking the write path.

**Phase 3 — Cutover.** One-shot data migration script: copy every cpg-labs `BrandToneSource` / `BrandToneHypothesis` / `BrandIntegrationConfig` row into nami-works (rewriting `shop → tenantId`). Re-encrypt `configCipher` under the nami-works key. Flip the Shopify admin's action handlers to write to nami-works too. Keep cpg-labs tables as a read-only fallback for 2 weeks, then drop the migration.

**Phase 4 — MCP exposure.** Add the tools listed above to `mcp.nami.works`. Test from a fresh Claude conversation: "What's the tone of voice for GE Beauty?" should call `get_tone_of_voice("gebeauty")` and return real traits.

**Phase 5 — Web UI for non-Shopify users.** Build the standalone web view, open signup to non-Shopify brands.

## Open questions for the nami-works session to decide

1. **Tenant identity model.** Today cpg-labs keys everything on `shop` (myshopify domain). nami-works has its own `Tenant` table — what's the shape of the mapping? One tenant per Shopify install, or one tenant per company with N Shopify installs as children?
2. **Authorization granularity.** Should the Shopify admin's service token be tenant-scoped (read-write everything for that tenant), or per-feature? The existing `/api/control/*` model on cpg-labs is single-scope-per-token. Recommend keeping it simple unless there's a concrete reason to fan out.
3. **Where the Brazilian/multilingual rules live.** Today `contentLanguage` is a tenant-level column. The inference engine respects it. Confirm nami-works' `Tenant` model has (or gets) the equivalent field before the cutover.
4. **Whether to expose write tools via MCP.** Read-only (`get_*`, `list_*`) is uncontroversial. `accept_hypothesis` / `refresh_tone` are state-changing — fine to expose, but worth confirming that's the intended threat model (a leaked token can accept/reject your traits).
5. **Sunset path for the cpg-labs `BrandToneSource` / `BrandToneHypothesis` / `BrandIntegrationConfig` tables.** After Phase 3 cutover + 2-week bake, drop them or leave as a passive archive? Recommend drop — every passive table is future tech debt.
6. **Manual-references S3 bucket.** Today cpg-labs has a `cpg-labs-tone-uploads` bucket. Move binaries to a nami-works bucket (`nami-works-tone-uploads`) at Phase 3, or proxy reads via cpg-labs for a transition window?

## Code inventory — file-by-file port plan

This is the canonical list. Every file relevant to the TOV system, the action you should take, and the exact seam to refactor if any. Reading these in order is the fastest way to internalize the system.

Coupling legend:
- **🟢 As-is** — pure TypeScript, no Shopify / cpg-labs runtime coupling. Copy the file verbatim into nami-works; only the import path of `prisma` needs to change.
- **🟡 Refactor seam** — one or two import lines or function arguments need swapping. Specific seam called out per file.
- **🔴 Rebuild** — Polaris / React Router / Shopify-admin-chrome bound. Use as design reference only; rewrite in the nami-works idiom.

### A. Pure engine — `app/services/tone-sources/*.ts`

All 8 files use `import prisma from "../../db.server"`. The shape of the queries against `BrandToneSource` / `BrandToneHypothesis` / `BrandIntegrationConfig` is what nami-works needs to mirror. The first global change: every `shop: string` argument becomes `tenantId: string` (or whatever nami-works calls it), and every Prisma `where: { shop }` becomes `where: { tenantId }`. Mechanical, ~50 call sites total across these files.

| File | Lines | Coupling | Notes |
|---|---|---|---|
| [`types.ts`](../app/services/tone-sources/types.ts) | 33 | 🟢 As-is | `ToneSourceType` union (`shopify_blog \| meta_ig \| meta_fb \| monday \| manual_upload \| manual_url`), `ToneHypothesisCategory` union. Copy verbatim. Future: drop `shopify_blog` if you decide the Shopify adapter stays in cpg-labs (see seam below). |
| [`service.server.ts`](../app/services/tone-sources/service.server.ts) | 228 | 🟢 As-is | The aggregation layer — `listSourceSummaries`, `listPendingHypotheses`, `listRecentBatches`, `acceptHypothesis`, `rejectHypothesis`, `makeBatchId`. Pure Prisma queries. Rename `shop` → `tenantId`. **This is the file the API endpoints wrap most directly.** |
| [`inference.server.ts`](../app/services/tone-sources/inference.server.ts) | 118 | 🟡 Refactor seam | The Claude pass — pulls `BrandToneSource` rows for a batch, calls `inferToneTraits` (from `app/services/claude/client.server.ts`, see Section B), writes `BrandToneHypothesis` rows. Reads `brandAssets.brandName` + `contentLanguage` to pass into the prompt — your equivalent is `tenant.brandName` / `tenant.contentLanguage`. **Seam:** the `import { inferToneTraits }` from the Claude client — copy that function too (Section B). |
| [`monday.server.ts`](../app/services/tone-sources/monday.server.ts) | 437 | 🟢 As-is | Monday.com adapter. Token-authenticated (not session-coupled). Encrypted credentials via `BrandIntegrationConfig` + `encryption.server.ts` (Section C). Shipped freshest (Wave 3) — schema introspection + filter rules. Copy verbatim except `shop` → `tenantId`. |
| [`meta.server.ts`](../app/services/tone-sources/meta.server.ts) | 308 | 🟢 As-is | Instagram + Facebook adapter via Meta Graph API. Token-authenticated. Also calls `extractTextFromImage` (Section B) to OCR text rendered inside post images. Copy verbatim except `shop` → `tenantId`. |
| [`manual.server.ts`](../app/services/tone-sources/manual.server.ts) | 331 | 🟡 Refactor seam | File upload + URL fetch. Two seams: (1) `extractTextFromPdfBuffer` from the Claude client (Section B — copy alongside); (2) S3 bucket default `"cpg-labs-tone-uploads"` at line 266 — change to `"nami-works-tone-uploads"` or whatever your tenant-scoped bucket is. Otherwise copy as-is. |
| [`s3.server.ts`](../app/services/tone-sources/s3.server.ts) | 122 | 🟡 Refactor seam | Thin AWS S3 client wrapper. Reads `process.env.AWS_REGION`, `process.env.TONE_UPLOADS_S3_BUCKET`. Provision the equivalent env vars in nami-works (or replace with whatever blob-storage abstraction nami-works already uses). The IAM policy on the new bucket needs `PutObject` + `GetObject` + `DeleteObject` for the nami-works runtime role. |
| [`shopify.server.ts`](../app/services/tone-sources/shopify.server.ts) | 156 | 🟡 Refactor seam | The ONLY adapter that touches a Shopify-session-shaped object. Already structurally typed as `AdminClient = { graphql: (query, options?) => Promise<Response> }` at line 3 — no import from `@shopify/shopify-app-react-router`. **Seam:** the caller used to be `authenticate.admin(request)` from the Shopify embedded session; in nami-works you build the equivalent client from the tenant's stored Shopify Admin API token. nami-works already has Shopify MCP tools (`reference_nami_works_repo.md`) — reuse that auth path to construct the `AdminClient` shape. Otherwise the article fetching + truncation + upsert logic is identical. |

### B. Claude client — `app/services/claude/client.server.ts`

This is a 502-line module with 6 exports. Only some are relevant to TOV. The TOV-relevant exports + their callers:

| Export | Used by | Coupling | Notes |
|---|---|---|---|
| `inferToneTraits` (lines 404-502) | `tone-sources/inference.server.ts` | 🟢 As-is | The trait-extraction prompt. Categories are `voice / vocabulary / do / dont / register / structure`. JSON-only output, ≤200 char snippets, confidence floats. **The prompt is the product** — preserve it verbatim, do not "improve" on the migration. |
| `extractTextFromImage` (line 273) | `tone-sources/meta.server.ts` | 🟢 As-is | Claude vision OCR for text-in-image (used to read promo graphics on IG/FB). |
| `extractTextFromPdfBuffer` (line 329) | `tone-sources/manual.server.ts` | 🟢 As-is | Claude vision text extraction for uploaded PDFs (≤32MB base64). |
| `generateAltTextSuggestion`, `interpretDiff` | Storytelling + alt-text (not TOV) | ❌ Leave behind | Stay in cpg-labs. |

**Recommended port shape in nami-works:** create `nami-works/src/services/claude/tone-client.ts` containing only `inferToneTraits` + `extractTextFromImage` + `extractTextFromPdfBuffer` + the small shared helpers (`getClient()`, `TEXT_MODEL` constant). Don't copy the whole 502-line file — half of it is alt-text / diff-interpretation logic that has no business in the TOV product.

Anthropic SDK init reads `process.env.ANTHROPIC_API_KEY` directly (line 10). Set the equivalent in nami-works runtime.

### C. Encryption — `app/services/security/encryption.server.ts`

| File | Lines | Coupling | Notes |
|---|---|---|---|
| [`encryption.server.ts`](../app/services/security/encryption.server.ts) | 117 | 🟡 Refactor seam | AES-256-GCM with `keyVersion` rotation support. **Critical:** the env vars are `APP_ENCRYPTION_KEY`, `APP_ENCRYPTION_KEY_VERSION`, `APP_PREVIOUS_ENCRYPTION_KEYS` (the third is a JSON array `[{ version, key }]` for decryption of pre-rotation rows). At cutover, decrypt every `BrandIntegrationConfig.configCipher` under the cpg-labs key, re-encrypt under the nami-works key, and bump `keyVersion`. Don't try to share the key material — that's a whole-tenant compromise vector. Line 73 has an unrelated `LALAMOVE_PER_SHOP_CREDENTIALS` feature flag — strip that line on copy, it's not TOV. |

### D. Brand-bible export — `app/services/brand-assets/`

The brand-bible export pulls `BrandAssets` (manual fields: brandName, toneOfVoice, about, blogUrl, benchmarks, brandCategory, editorialGuidelines, etc.) + `BrandLearning` (edit-correction memories from the blog draft flow) + accepted `BrandToneHypothesis` rows + the language settings, and stitches them into JSON / Markdown. This is the one consumable artifact today that approximates "the TOV of this brand" — the migration's `GET /api/tone/brand-bible.{json,md}` endpoint replaces this.

| File | Lines | Coupling | Notes |
|---|---|---|---|
| [`brand-assets/service.server.ts`](../app/services/brand-assets/service.server.ts) | 130 | 🟢 As-is (partial) | `getBrandAssets`, `listLearnings`, `removeLearning`, plus `listAcceptedTraitsForContext` (re-exported from tone-sources). Copy verbatim except `shop` → `tenantId`. |
| [`brand-assets/export.server.ts`](../app/services/brand-assets/export.server.ts) | 135 | 🟢 As-is | The JSON / Markdown stitching logic. Pure transformation — no I/O except its `prisma` reads. |
| `prisma/schema.prisma` — `BrandAssets` (lines 484-505) | — | 🟡 Migrate | This table holds the manual-override fields. In nami-works it merges into your `Tenant` row (or a sibling `TenantBrand` row, same shape). `@@map("BrandSettings")` is just a Postgres-table-rename annotation, not relevant to the port. |
| `prisma/schema.prisma` — `BrandLearning` (lines 508-525) | — | 🟡 Migrate | Per-tenant edit-correction memory. Migrates 1:1. |
| `prisma/schema.prisma` — `BlogPostDiff` (lines 527-541) | — | ❌ Leave behind | This is the blog-draft-vs-final-edited-Shopify-article diff queue, downstream of TOV. Stays in cpg-labs. |

### E. UI route — `app/routes/app.settings_.brand_.tone-sources.tsx` + sibling CSS

| File | Lines | Coupling | Notes |
|---|---|---|---|
| [`app.settings_.brand_.tone-sources.tsx`](../app/routes/app.settings_.brand_.tone-sources.tsx) | ~2300 | 🔴 Rebuild | Polaris web components throughout (`s-page`, `s-section`, `s-button`, `s-modal`, `s-icon`...), React Router v7 `loader`/`action`, Shopify App Bridge (`useAppBridge`). **The visual + interaction design is canonical** — see the three Wave 3 mockups in `inputs/mockups/` for the locked-in state. Rebuild in the nami-works web idiom: same accordion rows, same Meta tabbed onboarding, same Monday 4-phase filter flow, same Manual references dropzone. The action intents (`refreshShopify`, `uploadFile`, `addUrl`, `saveMondayConfig`, `saveMondayFilters`, `fetchMondaySchema`, `clearMondayConfig`, `saveMetaConfig`, `clearMetaConfig`, `refreshMonday`, `refreshMeta`, `acceptHypothesis`, `rejectHypothesis`, `deleteManualReference`, `reExtractFromS3`) become the HTTP endpoints in §"Target state". |
| [`app.settings_.brand_.tone-sources/styles.module.css`](../app/routes/app.settings_.brand_.tone-sources/styles.module.css) | ~900 | 🔴 Rebuild | CSS module for the Polaris-embedded version. Reference for spacing, dropzone, phase-tabs, source-row accordion, upload strip, column list, filter rule row — the visual contract. Re-derive in nami-works' design system. |
| [`app/components/brand-icons.tsx`](../app/components/brand-icons.tsx) | ~80 | 🔴 Rebuild | `ShopifyLogo`, `MetaLogo`, `MondayLogo`, `ManualUploadIcon`. Uses `<s-icon>` and `<img>` with `basePath`-relative asset URLs. Re-derive — assets in `public/` (shopify-logo.png, meta-wordmark.svg, monday-logo.svg) copy verbatim if you want pixel parity. |
| [`app/i18n/locales/en/brand-settings.json`](../app/i18n/locales/en/brand-settings.json) + [`pt-BR/brand-settings.json`](../app/i18n/locales/pt-BR/brand-settings.json) | ~180 each | 🟡 Refactor seam | All UI copy for the tone-sources page (4 source rows, Monday phased flow, Meta tabbed flow, Manual references, hypothesis pills, batch table). Both files include the new Wave 3 keys (`mondayPhases.*`, `metaPhases.*`, `monday.fetchSchema`, `monday.previewRuleCount_*`, etc.). Copy both files into the nami-works i18n directory; if nami-works uses a different i18n framework adjust the file shape but keep the keys + strings. |

### F. Cron — `app/routes/api.cron.weekly-tone-and-diff.tsx`

| File | Lines | Coupling | Notes |
|---|---|---|---|
| [`api.cron.weekly-tone-and-diff.tsx`](../app/routes/api.cron.weekly-tone-and-diff.tsx) | 173 | 🟡 Refactor seam | Weekly job (Mon 03:00 UTC). Iterates every shop, re-samples every connected source (Shopify blog + Meta + Monday), runs `runInferenceForBatch`, queues new hypotheses. **Seam:** the React-Router `action` wrapper + bearer-token auth header are cpg-labs specific. The body logic is straight loops over the same service modules. Reimplement as a nami-works scheduled job (whatever your scheduler is — cron, Temporal, EventBridge), and on cutover remove the Lightsail crontab line for `weekly-tone-and-diff` (see CLAUDE.md → Deployment → Crons). |

### G. Database migrations

| Migration | What it does | Action |
|---|---|---|
| `prisma/migrations/<date>_add_brand_tone_source/migration.sql` | Creates `BrandToneSource` | 🟡 Re-author in nami-works' migration system, swap `shop` → `tenantId`. |
| `prisma/migrations/<date>_add_brand_tone_hypothesis/migration.sql` | Creates `BrandToneHypothesis` | 🟡 Same. |
| `prisma/migrations/<date>_add_brand_integration_config/migration.sql` | Creates `BrandIntegrationConfig` | 🟡 Same. |
| `prisma/migrations/<date>_add_brand_assets/migration.sql` + `add_brand_learning` | Creates `BrandAssets` + `BrandLearning` | 🟡 Same, only if you decide nami-works owns the manual brand-bible fields too (recommended — keeps "what does this brand sound like" in one place). |

Run `git log --diff-filter=A -- prisma/migrations/` on cpg-labs to find the exact migration files; their `up.sql` is your blueprint.

### H. Mockups (visual reference)

These are the locked-in visual contracts for the Shopify admin UI. The nami-works web UI doesn't have to clone them pixel-for-pixel but should match the interaction patterns:

- [`inputs/mockups/storytelling-manual-references-v1.html`](../inputs/mockups/storytelling-manual-references-v1.html) — Manual references dropzone + URL row + upload strip + error banner.
- [`inputs/mockups/storytelling-meta-onboarding-v1.html`](../inputs/mockups/storytelling-meta-onboarding-v1.html) — Meta 3-phase tabbed flow (A: what we sample / B: generate token / C: paste & connect).
- [`inputs/mockups/storytelling-monday-filters-v1.html`](../inputs/mockups/storytelling-monday-filters-v1.html) — Monday 4-phase tabbed flow (A: connect / B: choose columns / C: filter rules / D: preview & save).
- [`inputs/mockups/storytelling-tone-sources-v1.html`](../inputs/mockups/storytelling-tone-sources-v1.html) — overall tone-sources page layout (4 source rows, hypothesis review list, batch history).

### What stays in cpg-labs after cutover

These files are NOT part of the TOV migration. They consume the TOV but live in cpg-labs forever:

- `app/routes/app.storytelling.tsx` — the blog-draft generator UI.
- `app/routes/app.storytelling_.brief.tsx` — the brief editor (accordion-themed builder for blog briefs).
- `app/services/content-gen/*.ts` — the blog-draft generation pipeline (consumes accepted TOV traits as context).
- `app/services/brand-assets/learning.server.ts` (if it exists) — the diff-correction → learning flow downstream of blog draft review.
- The alt-text generator + its routes.

After Phase 3 cutover, these files keep working — they swap `import { listAcceptedTraitsForContext } from "../tone-sources/inference.server"` for `import { fetchToneTraits } from "../nami-works-client"` (a thin HTTP wrapper you'll add to cpg-labs).

## Recommended reading order

If you have 30 minutes before starting:

1. [`docs/handover-local-delivery-control-api.md`](handover-local-delivery-control-api.md) — the bearer-auth + Python-client pattern this should mirror. **5 min.**
2. [`prisma/schema.prisma`](../prisma/schema.prisma) lines 484-588 — the 5 tables (`BrandAssets`, `BrandLearning`, `BrandToneSource`, `BrandToneHypothesis`, `BrandIntegrationConfig`). **2 min.**
3. [`app/services/tone-sources/types.ts`](../app/services/tone-sources/types.ts) — the type vocabulary. **1 min.**
4. [`app/services/tone-sources/service.server.ts`](../app/services/tone-sources/service.server.ts) — the read path. **5 min.**
5. [`app/services/tone-sources/inference.server.ts`](../app/services/tone-sources/inference.server.ts) — the write path (Claude pass). **5 min.**
6. [`app/services/claude/client.server.ts`](../app/services/claude/client.server.ts) lines 404-502 — `inferToneTraits` prompt. **5 min.**
7. [`app/services/tone-sources/monday.server.ts`](../app/services/tone-sources/monday.server.ts) — most complex adapter, freshest reference. Skim. **5 min.**
8. [`inputs/mockups/storytelling-monday-filters-v1.html`](../inputs/mockups/storytelling-monday-filters-v1.html) — locked-in UI for the most complex adapter. **2 min.**

## What's NOT in scope for this handover

- The downstream content-generation flows (blog drafts, alt-text, future agents). Those *consume* the TOV but live entirely in cpg-labs. They'll switch from reading the cpg-labs `BrandToneHypothesis` table directly to calling `nami-works/api/tone/brand-bible.json` after Phase 3 — but that's a follow-up, not part of the TOV migration itself.
- The Shopify storytelling page (`app/routes/app.storytelling.tsx`) and its brief editor (`app/routes/app.storytelling_.brief.tsx`). Those stay 100% cpg-labs.
- The alt-text generator. Stays cpg-labs.
- Cron rewrites. The weekly-tone-and-diff cron moves to nami-works; the other crons (`lalamove-watchdog`, `retail-goals-sync`, `shop-ingest-reconcile`) stay on cpg-labs Lightsail crontab.

---

**Next action for the nami-works session:** answer the 6 open questions above, then start Phase 1.
