---
id: ge-sales-whatsapp-app
name: Custom Shopify app — live sales WhatsApp outreach for store-credit holders
owner: cto
status: backlog
priority: normal
created: 2026-08-07
target: null
current_phase: 1-architecture-locked
next_blocker: none — ready to scaffold, needs a Claude Code session with dev/deploy access (this Cowork sandbox can't run a Shopify Partner/dev-store install flow or deploy pipeline)
next_owner: /integrations-engineer
stakeholders:
  - GE Beauty retail/sales team (end users of the app)
  - Lucas (owns the architecture calls below)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

The retail team messages store-credit holders on WhatsApp to drive redemption before
expiry (precedent: `growth/retention-machine/build_retail_wa_list.py`, a one-off Excel
export with wa.me links + a manual Status column). That pattern has a real gap: it's a
point-in-time export, so nothing stops a rep from messaging someone at 7PM who already
bought at 5PM — the list goes stale the moment it's generated. Lucas wants this solved
properly: a live tool, not a fresher export. Raised 2026-08-07 while wrapping the August
reactivation wave (14,545 SEND customers, R$674k in live credit, 7-day expiry) — that
wave's unredeemed balances are the first real user of this tool once built, but it's
designed as standing infrastructure for every future wave, not a one-off.

## Architecture decision (locked 2026-08-07)

- **A custom (private) Shopify app, embedded in GE Beauty's own Shopify admin** — NOT
  folded into `apps/omnify-admin` or `apps/connector`. Those serve the multi-tenant CPG
  Labs product (Omnify/Flywheel); this is a GE-Beauty-specific internal ops tool. Own
  small app, own schema, own deploy target — same separation principle as the two
  existing Prisma schemas ("different production Postgres instances... don't unify").
- **Real-time freshness via `orders/create` webhook, not polling.** Once there's a
  backend at all, a webhook beats "recheck live before every contact" or a refresh
  cadence: the app registers `orders/create`, verifies HMAC, looks up the customer in
  the active contact list, and if matched marks them `converted_at=<order timestamp>`
  immediately. The UI's list query is just `WHERE status='pending'` — always instantly
  correct, no staleness window to reason about, no polling cost. This directly solves
  "don't message the 7PM person who bought at 5PM."
- **WhatsApp send stays a wa.me deep link** (Lucas's call, 2026-08-07) — rep clicks,
  their own WhatsApp opens with the customer + a pre-filled message, they send it
  personally. No WhatsApp Business template approval, no Zoko API automation, keeps the
  human-sales-conversation nature of the interaction (Zoko stays reserved for the
  existing bulk/broadcast use case in `scripts/build_zoko_list.py` — different
  mechanic, not to be conflated).
- **GE Beauty only** (Lucas's call, 2026-08-07) — no multi-tenant abstraction. If a
  future tenant ever wants this, port it then; don't pre-pay that cost now.
- **UI**: Polaris, matching `apps/omnify-admin` conventions for visual consistency even
  though it's a separate app. Table view: name, phone, city/region, balance, last
  order/repor/descobrir recs (reuse the canon/CADENCE/REC_PREF logic already written in
  `build_retail_wa_list.py` rather than re-deriving it), wa.me link, Status
  (Contatado/Vendeu/Sem resposta — auto-flips to done once the webhook marks
  `converted_at`, rep doesn't have to self-report a sale that already shows in Shopify).
- **Cohort source**: query Shopify directly for customers carrying the active wave tag
  (`retention-reactivation_<date>`, already stamped by `retag_arms.py`) with live
  store-credit balance > 0 — no shared DB or API between the app and the Python
  issuance pipeline, the Shopify tag + balance IS the interface.
- **Active wave tag: hardcoded first, editable later** (Lucas, 2026-08-07). v1 ships
  with the current wave's tag as a literal constant in the app; don't build an admin
  settings UI for it until there's a second wave to prove the pattern needs to change
  without a redeploy. Sequencing, not a design compromise — the tag-based interface
  above is the real decision; whether that tag lives in code or a settings field is a
  cheap thing to change later.

## Phases

- [x] 1. Architecture locked with Lucas (send method, rollout scope, webhook-vs-poll
      freshness) — 2026-08-07.
- [ ] 2. Scaffold the custom Shopify app: App Bridge + session-token auth, its own small
      Postgres/Prisma schema, deploy target (reuse the Lightsail pattern already proven
      by `apps/omnify-admin` unless there's a reason not to).
- [ ] 3. Cohort ingestion: hardcode the active wave tag as a constant, query Shopify
      for tagged customers + live balance/address/last-orders, port the region-bucketing
      + repor/descobrir recommendation logic from `build_retail_wa_list.py` into the
      app's backend.
- [ ] 4. `orders/create` webhook wired: HMAC-verified, matches against the active
      contact list, flips `status` the instant a match orders.
- [ ] 5. Polaris UI: filterable/sortable table, wa.me links with the pre-filled message,
      Status column, auto-flip on webhook-detected conversion.
- [ ] 6. Install on GE Beauty's Shopify store, smoke test with 1-2 real reps against a
      small slice of the August wave's still-unredeemed SEND customers before the 7-day
      credit expiry window closes.
- [ ] 7. Cutover: retire the manual Excel-export process (`build_retail_wa_list.py`) for
      future waves once this is proven — keep the script itself as a fallback/reference,
      don't delete it.
- [ ] 8. Make the active wave tag admin-editable (settings field, no redeploy) once a
      second wave needs to swap it in — not before; premature to build until proven.

## Notes

- 2026-08-07 — Initiative created same session as the August wave's segment-tag-drift
  patch. Lucas explicitly wants this built by a Claude Code session, not in this Cowork
  sandbox — no Partner-dashboard/dev-store install flow or deploy pipeline available
  here. This file is the handoff.
- 2026-08-07 — Reviewed existing precedent before designing: `build_retail_wa_list.py`
  (Excel export, wa.me links, manual Status column, region-bucketed, has the
  repor/descobrir recommendation logic worth reusing) and `scripts/build_zoko_list.py`
  (Zoko bulk-campaign export — different mechanic, broadcast not 1:1, not applicable
  here). Neither solves the freshness problem; both fed the architecture decision above.

## Done means

- Reps use a live page inside GE Beauty's Shopify admin (not an Excel file) to work a
  wave's contact list.
- A customer who orders is invisible to the "pending" list within seconds of the order
  landing (webhook-driven, verified against a real test order during smoke test).
- The tool works for the August wave's remaining unredeemed balances AND is reusable,
  unmodified, for the next wave (parameterized by wave id, not hardcoded to
  `2026-08-07-ge60d`).
