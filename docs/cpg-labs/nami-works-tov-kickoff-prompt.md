# Kickoff prompt — NAMI Works tone-of-voice migration

> Paste the section below into a fresh Claude Code session running from `Desktop/nami-works/` (the nami-works repo). It carries the full chain-of-thought, the design decisions made in the cpg-labs session, the file inventory, and the first concrete actions.

---

You're picking up a multi-repo product move. This prompt has three parts: **(1)** the chain-of-thought that produced the decision, so you can argue with it before committing; **(2)** the migration plan that came out of that thinking; **(3)** your first concrete actions.

## Part 1 — The chain-of-thought

We just shipped Wave 3 of the tone-of-voice (TOV) system inside the **cpg-labs** Shopify admin app (`Desktop/cpg-labs/`). The system now samples brand copy from 4 sources — Shopify blog posts, Instagram + Facebook posts (Meta Graph API), Monday.com board items with filter rules, and manual file/URL uploads — runs a Claude inference pass over the raw text, and surfaces trait hypotheses (categories: voice, vocabulary, do, dont, register, structure) that the merchant accepts or rejects. Accepted traits steer downstream content generation (blog drafts, alt text, future agents).

The merchant-facing UI lives at `/app/settings/brand/tone-sources` — a Polaris-embedded page with accordion source rows, a hypothesis review list, a brand-bible JSON/Markdown export, and a past-batches table. Shipped 2026-05-12 as image `a98e066`.

**Step 1 of the thinking — what's the gap?** Even with a perfect TOV inside the Shopify app, the TOV is locked inside the Shopify admin. ChatGPT can't read it, the merchant's Notion brief workflow can't read it, ad platforms (Meta Ads, Google Ads) can't read it, customer-service tools can't read it. The brand-bible export exists but it's a manual download — not programmatic. So the immediate question was: how do we let other systems consume the TOV?

**Step 2 — could we just expose it as MCP?** Yes — the cleanest pattern is to add a thin bearer-auth endpoint (`GET /api/control/tone-of-voice`) on the cpg-labs admin, then expose it as MCP tools inside the existing `mcp.nami.works` server. Same pattern as the `/api/control/*` ↔ `cpg_control.py` split that already exists for Local Delivery. Admin owns the data + auth + business logic; MCP is just a transport adapter.

**Step 3 — but this still ties TOV to having a Shopify install.** That's the structural problem. Building the TOV system *inside* the Shopify admin conflates "I use Shopify" with "I can model my brand voice" — two unrelated things. A brand exists before it has a Shopify store; a brand serves channels Shopify never sees (D2C site, retail, wholesale, paid social, customer service). Restricting TOV creation to Shopify merchants kills the addressable market on day one.

**Step 4 — the inversion.** TOV should be a first-class **NAMI Works** product. Multi-tenant. MCP-native from the start. With a web UI that non-Shopify brands can use. The cpg-labs Shopify admin app becomes a *consumer* of the nami-works TOV API — the embedded UI we just shipped keeps its visual language, but its loader/action handlers proxy to nami-works instead of reading from the cpg-labs Postgres directly. Shopify identity auto-selects the tenant; non-Shopify users sign into nami-works directly.

**Step 5 — code reuse.** The cpg-labs code is highly portable. Pure TypeScript, no React, no Shopify-session coupling except in one file (`shopify.server.ts`) which is structurally typed against a minimal `AdminClient = { graphql: (...) => Promise<Response> }` shape — easy to construct from a stored Shopify Admin API token. The strategy is **copy the files into nami-works, don't try to share via package** — because the end state is that cpg-labs *deletes* its TOV code after cutover. The migration *is* the reuse. No private npm registry, no version dance, no two-way drift.

**Step 6 — what stays in cpg-labs.** The downstream consumers stay: blog draft generator, brief editor, alt-text generator, the edit-correction learning flow. These swap their direct `import { listAcceptedTraits }` for an HTTP call to nami-works. The Shopify admin's `/app/settings/brand/tone-sources` route stays as a thin proxy view so merchants don't have to leave the admin to manage their TOV.

If this chain-of-thought feels off — *especially* the "Shopify-only locks out non-Shopify brands" framing or the "copy, don't share" strategy — push back before you start. The whole thing rests on those two calls.

## Part 2 — The plan that came out of it

5 phases. The cutover phase is the only one with real blast radius; the rest are parallel-build / read-before-write.

| Phase | What | Risk |
|---|---|---|
| **0** | Read the handover (Part 3 below). Answer 6 open questions. Decide tenant identity model. | None — design work. |
| **1** | Build the schema + API endpoints in nami-works. No data migration yet. Smoke-test with GE Beauty tenant (already in nami-works at `gebeauty/`). | None — parallel infra. cpg-labs untouched. |
| **2** | Shopify admin loader on `tone-sources` reads from nami-works API. Action handlers still write to cpg-labs Postgres. Proves the read path. | Low — read-only path. |
| **3** | **Cutover.** One-shot migration script: copy every cpg-labs `BrandToneSource` / `BrandToneHypothesis` / `BrandIntegrationConfig` / `BrandAssets` / `BrandLearning` row into nami-works (rewriting `shop → tenantId`). Re-encrypt `configCipher` under nami-works key. Flip admin action handlers to write to nami-works too. Cpg-labs tables become read-only fallback for 2 weeks, then drop. | High — schema migration + credential re-encryption + write-path swap. Ship behind a feature flag. |
| **4** | Expose MCP tools on `mcp.nami.works`: `get_tone_of_voice(tenant)`, `get_brand_bible(tenant, format)`, `list_pending_hypotheses`, `accept_hypothesis`, `reject_hypothesis`, `refresh_tone`. Each wraps the HTTP API. | None — read tools first, write tools after threat-model review. |
| **5** | Build the web UI for non-Shopify users in `nami-works/web/`. Open signup. | None — net-new surface. |

## Part 3 — Your first concrete actions

The full handover with file-by-file inventory lives at:

```
c:/Users/Lucas Guimarães/Desktop/cpg-labs/docs/handover-tone-of-voice-to-nami-works.md
```

That doc has 8 sections (A through H) covering every file in cpg-labs that's relevant, categorized as 🟢 copy-as-is, 🟡 refactor one seam, or 🔴 rebuild in nami-works idiom. Read it in full before writing any code — it has a 30-minute reading order at the bottom that's the fastest path to load context.

**Highest-leverage references** (the spine of the system):

| File | Why |
|---|---|
| `Desktop/cpg-labs/prisma/schema.prisma` lines 484-588 | 5 tables: `BrandAssets`, `BrandLearning`, `BrandToneSource`, `BrandToneHypothesis`, `BrandIntegrationConfig`. |
| `Desktop/cpg-labs/app/services/tone-sources/service.server.ts` | The aggregation layer the API wraps. 🟢 As-is. |
| `Desktop/cpg-labs/app/services/tone-sources/inference.server.ts` | The Claude inference pipeline. 🟡 One seam (the Claude client import). |
| `Desktop/cpg-labs/app/services/tone-sources/monday.server.ts` | Most-complex adapter (Wave 3 — schema introspection + filter rules). 🟢 As-is. |
| `Desktop/cpg-labs/app/services/claude/client.server.ts` lines 404-502 | `inferToneTraits` prompt — the product is the prompt; do not "improve" it on migration. |
| `Desktop/cpg-labs/app/services/security/encryption.server.ts` | AES-256-GCM key-versioned credential encryption. 🟡 Critical seam — re-encrypt every `configCipher` under the nami-works key at cutover. |
| `Desktop/cpg-labs/docs/handover-local-delivery-control-api.md` | Bearer-auth pattern this migration should mirror exactly. |

**6 open questions to resolve before Phase 1:**

1. **Tenant identity model.** cpg-labs keys everything on `shop` (myshopify domain). nami-works has its own `Tenant` table. One tenant per Shopify install, or one tenant per company with N Shopify installs as children?
2. **Authorization granularity.** Tenant-scoped service token (read-write everything for that tenant), or per-feature scopes? Existing `/api/control/*` on cpg-labs is single-scope. Recommend keeping simple unless concrete reason to fan out.
3. **Language column.** `contentLanguage` is currently on `BrandAssets`. Where does it live in the nami-works `Tenant` model? Inference engine respects it; confirm before cutover.
4. **Write tools via MCP.** Read-only (`get_*`, `list_*`) is uncontroversial. `accept_hypothesis` / `refresh_tone` are state-changing — fine to expose but worth confirming the threat model (a leaked token can accept/reject traits).
5. **Sunset path for the cpg-labs tables.** Drop after 2-week bake or leave as passive archive? Recommend drop — every passive table is future tech debt.
6. **Manual-references S3 bucket.** Today cpg-labs uses `cpg-labs-tone-uploads`. Move binaries to `nami-works-tone-uploads` at Phase 3, or proxy reads via cpg-labs for a transition window?

**Concrete starting move:** read the handover doc end-to-end. Then answer the 6 questions above (write them into a `docs/tov-migration-decisions.md` in nami-works, one paragraph per question). Then start Phase 1 — schema + a single API endpoint (`GET /api/tone/hypotheses?status=pending_review`) wired to a `Tenant` and tested against the GE Beauty tenant. Don't open multiple phases in parallel; ship Phase 1 end-to-end before touching Phase 2.

**Constraints carried over from cpg-labs:**
- Brand voice rules: no em dashes in customer-facing copy. Benefit-only language for GE Beauty. Bilingual (en + pt-BR) i18n. (Memory file: `feedback_no_em_dash.md`.)
- The Claude prompt for tone inference is product, not implementation — port verbatim.
- Encryption key material does NOT travel between systems. Decrypt-with-old, re-encrypt-with-new at cutover.
- The Shopify admin UI mockups (`inputs/mockups/storytelling-{manual-references,meta-onboarding,monday-filters}-v1.html`) are the locked-in interaction contracts. The nami-works web UI doesn't need pixel parity but should match the interaction patterns (4 source rows, accordion expansion, phase tabs for Meta + Monday onboarding, etc.).

When you have the 6 answers, come back here and we'll align on Phase 1 scope.
