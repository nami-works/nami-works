# TOV migration — Phase 0 decisions

> Companion to [`Desktop/cpg-labs/docs/handover-tone-of-voice-to-nami-works.md`](../../cpg-labs/docs/handover-tone-of-voice-to-nami-works.md). The handover answers "what to port"; this doc answers "how it lands in nami-works given what's already here." Written 2026-05-17 before Phase 1 code.

---

## Q0 — Reconcile with the existing nami-works TOV system

nami-works already ships a parallel one-source TOV pipeline (`InstagramPost` → `voice-card.ts` → `VoiceCard` → `brand_tone_current` MCP tool, deployed 2026-05-12, commit `1341cff`). It targets the same tenant the cpg-labs system targets (gebeauty), so once we migrate, both live in the same Postgres and one has to win.

**Confirmed 2026-05-17: no live customers depend on the existing nami-works `VoiceCard` system.** That removes the constraint that drove an earlier hybrid recommendation. Without consumers to protect, the design call is pure-merit.

**Decision: clean replacement of the existing flow with the cpg-labs schema (Path A simplified).**

What goes:
- `VoiceCard` model in `prisma/connector/schema.prisma`. Migrate-drop.
- `apps/connector/src/services/instagram/voice-card.ts` (extractor). Delete.
- `apps/connector/src/tools/instagram/voice-card-current.ts` (raw-card MCP tool). Delete.
- gebeauty's current `VoiceCard` row. Drop with the column.

What stays:
- `InstagramAccount` + `InstagramPost` — these are the Instagram sampling adapter. cpg-labs's `meta.server.ts` will replace the *inference* side but the *ingest* side already works and is tenant-scoped correctly. The Meta adapter from cpg-labs writes `BrandToneSource` rows sourced from `InstagramPost` rather than from the Graph API directly — the existing ingest is now upstream of the new pipeline.
- `apps/connector/src/tools/brand/tone-current.ts` (`brand_tone_current` MCP tool). Its presentation layer (BRAND VOICE GUIDE rendering + stratified exemplar pull) is the best part of the existing flow. Keep the renderer; rewire its data source to read `BrandToneHypothesis` rows where `status = "accepted"` + the new `TenantBrand` manual fields. Stop reading `VoiceCard`. The output shape stays compatible for any future caller, but provenance flips from "auto-extracted card" to "merchant-reviewed traits."

What comes in from cpg-labs:
- 4 tables: `BrandToneSource`, `BrandToneHypothesis`, `BrandIntegrationConfig`, plus a new `TenantBrand` (for the manual brand-bible fields cpg-labs keeps in `BrandAssets`).
- 4 sampling adapters: `shopify.server.ts`, `meta.server.ts`, `monday.server.ts`, `manual.server.ts`.
- `inference.server.ts` + the `inferToneTraits` prompt (verbatim).
- `service.server.ts` (aggregation/review layer).
- `encryption.server.ts` (re-keyed for nami-works SSM).

**Schema simplification this unlocks:** no need for a separate "compile" pass that produces a `VoiceCard`-shaped artifact. `brand_tone_current` assembles its guidance block on read from accepted hypotheses + brand fields + IG exemplars. One pipeline, one source of truth, no derived-artifact staleness.

---

## Q1 — Tenant identity model

**Decision: Reuse `IntegrationTenant` as-is. One tenant per company. `shopifyShop` is a nullable column on the tenant.**

The handover proposes a fresh `Tenant` model. We don't have one — we have `IntegrationTenant` (slug-keyed, bearer-hash, SSM-prefix, brand enum, `shopifyShop` optional). It's the auth and isolation boundary for every existing tool. Adding a parallel `Tenant` model would split tenancy across two tables — refusing.

Mapping at cutover: `BrandToneSource.shop` (myshopify domain) → look up `IntegrationTenant` by `shopifyShop` column, then store its `id` as `tenantId`. The gebeauty tenant already has `shopifyShop` set; verify the actual value on day 1 of Phase 1.

Edge case the handover raised — "one company with N Shopify installs as children" — defer. Today no tenant has more than one Shopify install. When we hit that, the right shape is probably a `TenantShopifyInstall` sibling table, not a tenant-tree. Out of scope for this migration.

---

## Q2 — Authorization granularity

**Decision: Tenant-scoped, single-scope. No per-feature tokens.**

`IntegrationTenant.bearerTokenHash` is already one-token-per-tenant. Every MCP tool checks `status === "active"`. Splitting TOV into its own scope would mean adding a token-scopes table and updating every entry point — wholly disproportionate to a threat model that today already exposes Shopify writes (`tag_order`, `replace_product_tags`) under the same single token.

State-changing TOV operations (`accept_hypothesis`, `refresh_tone`, `delete_manual_reference`) are gated by `apps/connector/src/lib/confirm.ts` two-step confirm, same as Shopify writes. That's the right place to draw the safety line.

If the security stance shifts later, it's a one-table migration in `IntegrationTenant` schema with the existing tools still working via wildcard scope. Don't anticipate.

---

## Q3 — Language column

**Decision: Add `contentLanguage String?` to `IntegrationTenant` (e.g. `"pt-BR"`, `"en-US"`). Default null. Inference engine reads it; null falls back to auto-detect from corpus.**

`contentLanguage` is a tenant-level fact, not a tone-feature fact — many subsystems care (Omie operator responses, Instagram caption drafting, blog drafts, MCP tool error messages). Putting it on the auth table is the right altitude.

For the gebeauty tenant, backfill `contentLanguage = "pt-BR"` in the same migration that creates the column. For future tenants, set at onboarding (already a step in `docs/tenant-onboarding.md`).

Don't model `preferredLanguage` separately from `contentLanguage` (cpg-labs has both). One column. If we later need "operator UI language ≠ generated content language", split then.

---

## Q4 — Write tools via MCP

**Decision: Expose all TOV operations (reads + writes) as MCP tools. State-changing tools use the `confirm.ts` two-step pattern.**

Read-only tools:
- `brand_tone_current` (already shipped — extend to also surface unresolved hypotheses count)
- `tone_brand_bible` (`format: "json" | "md"`)
- `tone_list_pending_hypotheses` (`min_confidence`, `limit`)
- `tone_list_sources`
- `tone_list_batches`

Write tools (confirm-gated):
- `tone_accept_hypothesis(id)` / `tone_reject_hypothesis(id)`
- `tone_refresh(sources: [...])` — triggers a sample + inference batch

The leaked-token threat model: an attacker who acquires the bearer can already tag orders, issue store credit, run analytics queries. Accepting/rejecting traits is strictly lower blast radius than that. The two-step confirm is the gate.

---

## Q5 — Sunset path for cpg-labs tables

**Decision: Phase 3 is a one-shot cutover. No 2-week read-only fallback. Drop cpg-labs `BrandToneSource` / `BrandToneHypothesis` / `BrandIntegrationConfig` / `BrandAssets` immediately after verification.**

The handover suggested a 2-week bake with cpg-labs tables as a read-only fallback. That requires either:
- (a) keeping cpg-labs's write path live and syncing nami-works → cpg-labs in reverse (a whole second migration in the opposite direction), or
- (b) freezing cpg-labs writes but keeping reads, which means downstream cpg-labs services would silently diverge from nami-works once any merchant accepts a new trait.

Neither is worth the safety it promises. Cheaper: invest the same effort in a thorough Phase 2 read-verification (the loader on the Shopify admin tone-sources page reads from nami-works for ≥1 week before Phase 3 flips writes), so when we cut over, we already trust the data path.

The cpg-labs Postgres rows stay as a `pg_dump` snapshot for rollback, not as live tables.

---

## Q6 — Manual-references S3 bucket

**Decision: Migrate binaries to `nami-works-tone-uploads` (new bucket) in the same one-shot Phase 3 script. No proxy window.**

Create the bucket in Phase 1 alongside the schema. Phase 2 manual-reference uploads go directly to the new bucket. Phase 3 migration script:
1. For every `BrandToneSource` row with `sourceType IN ("manual_upload",)`, read the S3 key from `metaJson`.
2. Stream-copy `cpg-labs-tone-uploads/<key>` → `nami-works-tone-uploads/<tenantSlug>/<key>`.
3. Rewrite `metaJson.s3Key` in the new row.
4. Verify checksums.

The transition-window-via-proxy alternative degrades into a permanent dependency in practice. One-shot.

IAM: nami-works ECS task role needs `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::nami-works-tone-uploads/*`. Add to Terraform in Phase 1.

---

## Migration scope adjustments given the decisions above

The handover's 5-phase plan still holds, with these adjustments:

- **Phase 1** adds: (a) `contentLanguage` column on `IntegrationTenant` (Q3); (b) `nami-works-tone-uploads` S3 bucket + IAM (Q6); (c) the 4 new tables — `BrandToneSource`, `BrandToneHypothesis`, `BrandIntegrationConfig`, `TenantBrand` — keyed on `tenantId`; (d) drop the `VoiceCard` model + delete `voice-card.ts` + delete `voice-card-current.ts` tool (Q0).
- **Phase 1** loses: any separate "design `Tenant` model" work (Q1 — reuse existing).
- **Phase 2** changes scope: there is no Shopify admin page in this repo to wire up. Phase 2 instead becomes "rewire `brand_tone_current` to read from `BrandToneHypothesis` instead of `VoiceCard`, while keeping its presentation contract." The cpg-labs Shopify admin loader rewire happens in *that* repo, not here, as a follow-up after Phase 3.
- **Phase 3** loses: the 2-week fallback infrastructure (Q5).
- **Phase 4** loses: the `tone_recompile_voice_card` tool — no longer needed without a derived-artifact pipeline.

---

## Open follow-ups (not blocking Phase 1)

1. **Inference prompt port discipline.** The handover says "The prompt is the product — port verbatim." Confirmed. Copy `inferToneTraits` from `cpg-labs/app/services/claude/client.server.ts` lines 404-502 byte-for-byte; do not "improve" on migration.
2. **Where the nami-works web UI for non-Shopify users lives (Phase 5).** No web frontend exists in this repo today; `apps/connector/src/` is server-only. Either a sibling `web/` package or a separate repo. Defer until Phase 4 is done.
3. **`InstagramPost` ↔ `BrandToneSource` relationship.** The existing IG ingest writes to `InstagramPost`. The cpg-labs Meta adapter writes to `BrandToneSource`. Cleanest answer: the IG-side `meta.server.ts` reads from `InstagramPost` (already ingested by nami-works) and projects into `BrandToneSource` rows at sample time, instead of re-hitting the Graph API. One source of truth per upstream, no double-fetch. Decide in Phase 1 when porting `meta.server.ts`.
