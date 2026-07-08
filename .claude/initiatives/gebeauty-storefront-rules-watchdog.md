---
id: gebeauty-storefront-rules-watchdog
name: GE Beauty storefront-vs-rules watchdog (discounts + badges)
owner: cto
status: in-progress
priority: normal
created: 2026-07-08
target: null
current_phase: 3-storefront-render-parity
next_blocker: ad-hoc audit shipped + green; S1 render-parity + alert routing (phases 3-5) not built yet
next_owner: /observability-engineer
stakeholders:
  - GE Beauty (tenant #1)
  - Lucas (receives the alerts)
working_agreement: ~/.claude/projects/c--Users-Lucas-Guimar-es-Desktop-nami-works/memory/feedback_cto_contract.md
---

## Why
Today's audit (2026-07-08) found the live store silently drifting from its own pricing/merchandising rules: a bundle missing a component, three kits with `de` decoupled from component value, ~14 kits whose off-badge either didn't exist or was DRAFT (linked but never rendered), and an orphaned duplicate badge. Every one was invisible until manually hunted. These are exactly the failures a watchdog should catch in minutes, not on a customer complaint. The end state is a scheduled check that alerts Lucas whenever the storefront violates a codified rule; ad-hoc (manual run) is acceptable until the invariant set stabilizes.

## Invariants the watchdog enforces
Derived from today's audit. Each is a read-only check against the Shopify Admin API (and, for parity checks, rendered storefront HTML).

**Bundles (kits/duplas, productType `kit`)**
- B1 — No `bundleComponents` node with `componentVariantsCount.count == 0` (component defined but points to a deleted variant → silently drops at checkout). *Fix is app-side (Bundles app owns components); see [[reference_gebeauty_bundles_app_owned]].*
- B2 — No active kit whose `price` exceeds its resolved component sum (a "penalty bundle" that costs more than buying the items loose).
- B3 — When a kit has a `compareAtPrice`, it equals `sum(component.price * qty)` (no phantom/inflated or understated `de`), and `price <= compareAtPrice`.

**Badges (`custom.etiquetas`)**
- G1 — Every product with a `compareAtPrice` carries exactly one off-badge, matching the rule (`de < 100 → N% off` ; `de >= 100 → R$N off`) with the correct value. See [[reference_gebeauty_etiqueta_applier]].
- G2 — No off-badge on a full-price product (stray/stale discount label).
- G3 — Every `etiqueta` metaobject referenced by a live product is publishable status ACTIVE (DRAFT links but never renders — the bug that hid ~14 kit badges today).
- G4 — (hygiene, low sev) No orphaned or duplicate off/social-proof badges in the library (e.g. the deleted `mais vendido`; the duplicate R$20/15% entries).

**Storefront parity (beyond Admin API)**
- S1 — A representative discounted PDP and a collection card actually render the expected badge in raw HTML (catches DRAFT, CDN/theme cache lag, and `snippets/custom-etiquetas.liquid` regressions that Admin-API checks can't see).

## Phases
- [x] 1. Codify invariants + prove each check manually — 2026-07-08 (memories [[reference_gebeauty_bundles_app_owned]] + [[reference_gebeauty_etiqueta_applier]] written; `apply_off_badges.py` committed carrying the badge rule; bundle + verify logic proven in-session)
- [x] 2. Consolidate into one committed read-only audit `sandbox/gebeauty/scripts/audit_storefront_rules.py` — runs B1-B3, G1-G4, grouped report, exit=violation count — 2026-07-08
- [ ] 3. Add S1 storefront-render parity check (raw HTML fetch of one PDP + one card)
- [ ] 4. Alert routing — wire violations to a channel (Gmail-label alert pipeline or chosen), with severity (B1/S1 = high, G1-G3 = normal, G4 = low) and dedupe
- [ ] 5. Cron deploy + escalation policy (cadence, quiet hours, ECS-restart survival per existing cron patterns)

## Notes
- 2026-07-08 (later) — Phase 2 shipped: `audit_storefront_rules.py` committed + run against live store. Result GREEN on all functional invariants (B1-B3, G1-G3) — confirms today's fixes held. Only remaining hits are 3 LOW G4 dupes: duplicate ACTIVE off-badges "10% off" (2 metaobjects), "15% off" (3), "R$20 off" (2). Housekeeping — the applier picks the first gid deterministically, so no functional impact; dedupe when convenient. Run ad-hoc: `python sandbox/gebeauty/scripts/audit_storefront_rules.py` (exit code = violation count).
- 2026-07-08 — Initiative derived from the discount+badge audit. Ad-hoc tooling that already exists to fold into Phase 2's single script: `apply_off_badges.py` (badge rule + library load), plus in-session logic for bundle `componentVariantsCount` scan (B1), component-sum-vs-price/de (B2/B3), and off-badge correctness/stray/publish (G1-G3). All checks must stay strictly read-only — the watchdog reports, it does not auto-fix (fixes route to `apply_off_badges.py` for badges, and to the Bundles app UI for components since they're app-locked).
- Gotcha to bake into the checks: bundle components are app-owned, so B1 can detect but never remediate from our token. G3 must read `capabilities.publishable.status`, not just reference existence. Watch bash `\$`→`$` mangling in inline regex (broke a verify pass today) — the committed script sidesteps it by living in a file.

## Done means
- One command (`python sandbox/gebeauty/scripts/audit_storefront_rules.py`) reports every B/G invariant violation across the store, with zero false positives against a known-good state.
- Phase 4+: a scheduled run alerts Lucas (with severity) within one cron interval of a violation appearing, and self-heals across ECS restart.
