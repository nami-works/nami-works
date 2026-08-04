# Skill confrontation — mine vs Anthropic native

**Purpose.** Before migrating any skill to the brand-agnostic pattern, first decide whether Anthropic's native plugin skills already do the job better. Only keep a custom skill where it earns its place. This is Step 0 of the migration checklist.

**Date:** 2026-07-31. **Reviewer:** Cowork session (multi-brand skill makeover).

## The Anthropic native surface (what we're confronting against)

Knowledge-work plugins (each bundles several skills):
- **marketing** — brand-review, campaign-plan, competitive-brief, content-creation, draft-content, email-sequence, performance-report, seo-audit
- **design** — accessibility-review, design-critique, design-handoff, design-system, research-synthesis, user-research, ux-copy
- **data** — analyze, build-dashboard, create-viz, data-visualization, explore-data, sql-queries, statistical-analysis, validate-data, write-query, data-context-extractor
- **operations** — capacity-plan, change-request, compliance-tracking, process-doc, process-optimization, risk-assessment, runbook, status-report, vendor-review
- **legal** — brief, compliance-check, legal-response, legal-risk-assessment, meeting-briefing, review-contract, signature-request, triage-nda, vendor-check
- **finance** — audit-support, close-management, financial-statements, journal-entry, reconciliation, sox-testing, variance-analysis
- **productivity** — memory-management, start, task-management, update
- **figma** — design↔code, generate-library/diagram, use_figma MCP wrappers
- **adobe-for-creativity** — batch photo/video edit, social variations, resize, retouch
- **canva** — edit-design, bulk-create, resize-for-social-media, implement-feedback, design-feedback, brand-check

Standalone: consolidate-memory, docx, pdf, pptx, xlsx, morning, schedule, skill-creator, setup-cowork.

## The dominant pattern (the key finding)

Almost none of the native skills *replace* one of ours. The shape is consistent: **our skills are brand-coupled DIRECTORS that orchestrate a whole job end-to-end; Anthropic's are brand-agnostic EXECUTORS/ANALYSTS that do one generic sub-task well.** So for most overlaps the right verdict is not "keep vs replace" but **KEEP the director and let it DELEGATE the generic limb to the native skill** instead of reimplementing it.

This reinforces the multi-brand refactor: the brand-agnostic *method* can lean on Anthropic's brand-agnostic *executors*, while our manifest supplies the brand facts. Less bespoke code to maintain, native skills improve for free.

The only genuine "adopt theirs as the execution engine" case is **Canva** — it's an official MCP-backed integration and our creative-producer already drives Canva by hand.

## Verdict legend

- **KEEP** — no meaningful native equivalent; wholly bespoke.
- **KEEP + DELEGATE** — keep our director; adopt the named native skill(s) as the execution limb for the generic sub-task.
- **ADOPT ENGINE** — keep our orchestration but move the actual execution onto the native MCP-backed skill.
- **EVALUATE** — real overlap; make the call when this skill is next migrated.

## The matrix (24 skills)

| Skill | Nearest native | Overlap | Verdict | Note |
|---|---|---|---|---|
| **growth-office** | — | none | KEEP | Orchestration is bespoke (CGO model, 10% floor gate, roster). Pilot #1. |
| **design-engineer** | design:accessibility-review, design:design-handoff, design:design-critique; figma:* | partial | KEEP + DELEGATE | Keep the state-matrix + hide-don't-disable IP (born from a real shipped bug). Delegate a11y audit → design:accessibility-review, dev spec → design:design-handoff. Pilot #2. |
| **creative-producer** | canva:bulk-create, canva:edit-design, canva:resize-for-social-media, canva:brand-check | **strong** | ADOPT ENGINE | We already drive Canva manually. Move the matrix build → canva-bulk-create, text swap → canva-edit-design, sizes → canva-resize, QA → canva-brand-check. Keep our house-layout + 3-point QA gate as the director. Biggest win. |
| **content-director** | marketing:content-creation, draft-content, seo-audit, brand-review | medium | KEEP + DELEGATE | Keep the Shopify-catalog-grounded 9-pass pipeline + locked grammar. Delegate keyword landscape → marketing:seo-audit, generic voice check → marketing:brand-review. |
| **crm-director** | marketing:email-sequence, campaign-plan | medium | KEEP + DELEGATE | Keep RFM segments + Zoko send engine + brand grammar. Use marketing:email-sequence for generic flow scaffolding/A-B benchmarks. |
| **growth-hacker** | marketing:campaign-plan, performance-report, competitive-brief | medium | KEEP + DELEGATE | Keep Module-A-net-margin steering + agency challenge loop. Delegate generic campaign brief / perf report / competitor scan to marketing:*. |
| **growth-analyst** | data:analyze, statistical-analysis, validate-data; finance:variance-analysis | medium | KEEP + DELEGATE | Keep Module A engine + GE economics. Use data:* for generic stats/QA, finance:variance-analysis for variance narratives. |
| **storefront-agent** | marketing:campaign-plan; (Shopify writes are ours) | low | KEEP | Shopify-API promo consistency is bespoke; marketing plugin doesn't touch the store. |
| **digest** | productivity:memory-management, consolidate-memory | medium | EVALUATE | Two-tier provenance + `--into` is more specialized. consolidate-memory overlaps on the curation half — compare closely at migration. |
| **lessons-learned** | productivity:memory-management, consolidate-memory | medium | EVALUATE | Ours targets CLAUDE.md *project rules*; native targets memory files. Possibly merge into a memory-management call. |
| **setup** | setup-cowork | medium | EVALUATE | Different targets (GE MCP connector + Canva/Magnific accounts vs generic Cowork onboarding). Align, don't duplicate. |
| **voice-backlog** | productivity:task-management, update | low | KEEP | The voice-notes → structured backlog interview is a distinct mechanic. |
| **backlog-fit** | productivity:task-management | low | KEEP | "Cheap-to-tackle-given-loaded-context" triage has no native analog. |
| **b2b-proposta** | (pdf/docx for output only) | none | KEEP | Reads GE Excel simulator, brand PDF. Bespoke. |
| **video-director** | adobe-for-creativity (video) | low | KEEP | Magnific + Seedance pipeline, brand grammar. No native equivalent for the pipeline. |
| **illustrator** | adobe-for-creativity (image) | low | KEEP | Magnific doodle pipeline + locked defense-kit style anchor. |
| **iconographer** | figma:*, adobe:* | low | KEEP | GE icon-family matching (viewBox 0 0 51 51) is exact and bespoke. |
| **integrations-engineer** | — | none | KEEP | Shopify/Omie/Lalamove/Google boundary work. Bespoke. |
| **shopify-submission** | — | none | KEEP | Shopify App Store submission engine. Bespoke. |
| **product-developer** | design:*, figma:* | low | KEEP | Design→implementation workflow is broader than any single native skill. |
| **product-manager** | — | none | KEEP | Upstream product discovery is bespoke. |
| **dogfood** | — | none | KEEP | Ops-work → app-enhancement-spec. Bespoke. |
| **session-merge** | — | none | KEEP | Two-session merge negotiation. Bespoke. |
| **handoff** | — | none | KEEP | Session handoff doc. Bespoke. |

### Utilities — already Anthropic's, no custom version exists

docx / pdf / pptx / xlsx are used from the Anthropic set directly. No action. morning / schedule / skill-creator are Anthropic's; keep using them.

## Rollup

- **KEEP (no equivalent):** 13 — growth-office, storefront-agent, voice-backlog, backlog-fit, b2b-proposta, video-director, illustrator, iconographer, integrations-engineer, shopify-submission, product-developer, product-manager, dogfood, session-merge, handoff.
- **KEEP + DELEGATE (adopt native limbs):** 5 — design-engineer, content-director, crm-director, growth-hacker, growth-analyst.
- **ADOPT ENGINE:** 1 — creative-producer (→ Canva plugin).
- **EVALUATE at migration:** 3 — digest, lessons-learned, setup.

**Nothing is fully replaced.** The custom directors all earn their place; the win is offloading generic limbs to native skills so we maintain less and inherit their improvements.
