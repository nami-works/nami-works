# Timbre MVP — Living Status

> Single source of truth for the open-beta MVP launch. Updated as tracks ship. Last updated: **2026-05-22**.

---

## TL;DR

We are building **Timbre by NAMI Works** — a multi-tenant web app at `timbre.nami.works` that lets any brand (not just Shopify merchants) curate and own their brand voice. The voice becomes addressable from any AI tool via HTTP + MCP. 5-week build, open beta on launch day.

**Right now:** Phase 1 backend just hardened (PR #16 ready). Twelve tracks scoped. Awaiting your go to merge T1 and start T2.

---

## What Timbre is

A brand connects sources where its copy lives (Klaviyo, WordPress, Shopify blog, Instagram, Monday.com, file uploads, etc.). We sample the copy, run Claude inference over the corpus, and surface trait hypotheses for the merchant to accept or reject. Accepted traits become the canonical brand-voice spec — accessible to ChatGPT, Claude, Notion, ad platforms, or any script via a bearer-token-protected API and MCP tool.

**Why it matters:** today voice work is locked inside the Shopify admin. After Timbre, voice is a piece of brand IP the merchant owns, portable across every AI tool they touch.

**Product principles (locked):**
- Jobs-led IA. The merchant thinks "where does my email live?", not "do I have a Klaviyo connector?".
- The merchant owns the data. Export to MD/JSON, walk away anytime.
- No em dashes. Warm-expert tone for our own UI copy.
- Two-step confirm on every write that mutates merchant data.

---

## What we've shipped so far

| # | Artifact | Where |
|---|---|---|
| 1 | **Phase 0 decisions doc** (Q0-Q6: tenant model, auth, language, write tools, sunset, S3) | [docs/tov-migration-decisions.md](tov-migration-decisions.md) |
| 2 | **Phase 1 backend** (schema + 4 source adapters + service + inference + 1 read endpoint + MCP tool rewires + S3 infra) | PR #16 (`feat/tov-phase-1`) |
| 3 | **T1 hardening on PR #16** (limit clamp, boot-time encryption assert, pg_dump directive, +35 tests) | PR #16, latest commit |
| 4 | **Source-channel research** — top 15 candidates ranked, Klaviyo/WordPress/Mailchimp picked for Phase 2 | [docs/tov-source-channel-research.md](tov-source-channel-research.md) |
| 5 | **UI mockup v1** — 12 states (A-L) covering auth, workspace (jobs-led IA), 5 platform drawers (Meta, Monday, Klaviyo, WordPress, Mailchimp), job-led picker (State K), Talks & video (State L) | `inputs/mockups/tov-web-ui-v1.html` on branch `mockup/tov-web-ui-v1` |
| 6 | **Senior-engineer plan** approved (default scope, 5 weeks, T1-T12) | This doc, below |

---

## The plan (12 tracks)

| # | Track | Branch | ETA | Status |
|---|---|---|---|---|
| **T1** | Phase 1 hardening | `feat/tov-phase-1` (PR #16) | 3d | ✅ **Done** |
| **T2** | Schema + provisioning (User, Session, BillingStatus, tenantId guard) | `feat/timbre-provisioning` | 3d | ⏳ Next |
| **T3** | Phase 2 write MCP tools (accept / reject / refresh) | `feat/tov-write-tools` | 4d | Queued |
| **T4** | Web shell — Next.js + Auth.js + Lightsail + DNS for `timbre.nami.works` | `feat/timbre-web-shell` | 5d | Queued |
| **T5** | Sign-in / sign-up (Google OAuth + tenant provisioning) | `feat/timbre-auth` | 3d | Queued |
| **T6** | Workspace + sources card (jobs IA) | `feat/timbre-workspace` | 5d | Queued |
| **T7** | Connect drawers (State K + per-platform) | `feat/timbre-connect-drawers` | 6d | Queued |
| **T8** | Hypothesis review depth (mockup-first → translate) | `feat/timbre-review` | 5d | Queued |
| **T9** | Brand bible + exports (MD + JSON) | `feat/timbre-bible` | 3d | Queued |
| **T10** | Settings + billing stub UI (mockup-first) | `feat/timbre-settings` | 4d | Queued |
| **T11** | Klaviyo + WordPress source adapters | `feat/timbre-adapters-phase2` | 7d | Queued |
| **T12** | E2E smoke + launch | `chore/timbre-launch` | 3d | Queued |

```
Week 1: ████ T1                     (done)
        ░░░░░░░░ T4 web shell           
        ░░░░ T2          ░░░░ T3        

Week 2: ████████ T4 ships              
        ████ T2 + T3 ship              
        ████ T5 auth (T2 + T4 unlock)  

Week 3: ████ T5 ships                  
        ┃ parallel wave              
        ████ T6 workspace + sources
        ████ T7 connect drawers
        ░░░░ T8 review (mockup → React)
        ████ T9 brand bible
        ████ T11 Klaviyo + WordPress

Week 4: ████ T6, T7, T9 ship
        ████ T8 translation
        ████ T11 continues
        ░░░░ T10 settings mockup

Week 5: ████ T8, T10, T11 ship
        ████ T12 smoke + launch prep
        🚀 LAUNCH timbre.nami.works
```

---

## Decisions locked (silent + escalated)

| Topic | Decision | Source |
|---|---|---|
| Web stack | Next.js 15 + Auth.js | Your call |
| Hosting | Reuse the existing Lightsail box, bump plan to 2GB preemptively | Your call |
| Anthropic billing | Shared NAMI key during beta, per-tenant rate limit (3 batches/24h, 30/30d) | Your call |
| Subdomain | `timbre.nami.works` | Your call |
| Email confirmation | Skip MVP (v1.1 backlog) | My call |
| Password reset | Skip MVP (v1.1 backlog) | My call |
| Klaviyo OAuth app name | `Timbre by NAMI Works` | My call |
| React component library | Own primitives, Tailwind utility, no Polaris | My call |
| Email provider | AWS SES (already in account) | My call |
| Database for the web app | Same connector RDS (User + Session tables added in T2) | My call |
| Cron orchestration | Reuse existing Lightsail crontab | My call |

---

## Risks I'm watching

1. **Multi-tenant data isolation** — every Prisma query needs a `tenantId` filter. Mitigation: T2 adds a `$extends` guardrail that fails fast if `tenantId` is missing on tenant-scoped tables. Plus paranoid QA pass on T6/T7/T11.
2. **Lightsail capacity** — adding Next.js to a 1GB box that already runs omnify-admin. Mitigation: bump plan to 2GB in Week 1 day 1.
3. **Klaviyo OAuth app approval** — partner-program review can take days. Mitigation: register the app in Week 1, before T11 starts in Week 3.
4. **Shared Anthropic key abuse** — one tenant goes wild, our spend balloons. Mitigation: per-tenant rate limit in the inference engine + daily CloudWatch alarm on aggregate Anthropic spend.
5. **DNS + cert propagation** — Let's Encrypt is fast but DNS takes hours. Mitigation: register the record + cert in Week 1.

---

## Smoke test (Week 6 launch gate)

End-to-end, in a fresh browser:

1. Sign up at `timbre.nami.works` as a new test brand
2. Empty workspace shows 7 jobs (Blog, Email+SMS, Social, Talks+Video, CS, PM, Reference)
3. Click Connect on Email+SMS → State-K picker → Klaviyo card
4. OAuth into Klaviyo (gebeauty account) → success block with visible counts
5. Click "Sample 60 messages now" → progress → hypotheses appear (~30s)
6. Review hypotheses: accept 3, reject 2, accept-with-edits 1
7. Brand bible section → download Markdown
8. Open Claude.ai with the new tenant's bearer → ask "what's the brand voice for…" → MCP returns same content
9. **Cross-tenant check (cannot fail):** sign in as your real account in a separate browser → confirm you see only gebeauty data, no leak from the smoke tenant

Launch holds if step 9 fails.

---

## ⏸️ The question I need you to validate now

**T1 is done and tested. PR #16 is ready to merge.** Two paths:

| Option | What happens |
|---|---|
| **A. Merge T1 now, start T2** | I squash-merge PR #16 to main today, delete `feat/tov-phase-1`, and immediately fork `feat/timbre-provisioning` from the merged main. T2 starts within minutes. T3 and T4 fork off in parallel once T2 hits the schema. This is the default Gantt above. |
| **B. Hold the merge, start T2 stacked on the unmerged branch** | T2 forks off `feat/tov-phase-1` instead of `main`. PR #17 stacks on PR #16 — when #16 merges, #17 rebases onto main automatically. Useful if you want one more review pass on T1 before it lands, but the dependency chain gets brittle if more tracks start before #16 merges. |

**Default recommendation: A.** T1 has been independently reviewed (via `/review`), all gates pass, the migration is irreversible-but-snapshot-protected. Merging now is the simplest path; holding mostly just creates rebase debt downstream.

What's your call?
