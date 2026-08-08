# Session Handoff — 2026-08-08

**Target surface:** Claude Code — written for this surface; if a different surface picks it up, re-read the surface notes below.

## What was done

- **August reactivation wave wrapped up.** 14,545 SEND customers issued store credit
  (20% rule, R$674k live liability), both layered experiments (calendar-date test,
  PAW-timing test) cancelled mid-build by Lucas before firing — wave shipped as a plain
  issuance. A real duplicate-issuance bug (55 customers, R$2,616.57 excess) was caught
  and fixed mid-flight; full story in `.claude/initiatives/retention-experiments.md`.
- **Segment-tag-drift gap patched (same-day proxy, not a durable fix).** Shopify Flows
  remove `core-target`/`missing-mascara`/`missing-shampoo` tags once a customer's
  underlying condition resolves, so live tag queries can't reconstruct point-in-time
  segment membership at send time. Patched by bulk-exporting all customer tags same-day
  and filtering to the 16,143 wave members →
  `gebeauty/growth/retention-machine/learning/segment-tags-snapshot-2026-08-07-ge60d.jsonl`
  (gitignored, PII). Durable fix (stamp seg/ctx tags into `sends.jsonl` AT issuance time)
  logged in `gebeauty/pending-fixes.md`.
- **New initiative created and architecture locked: a live sales WhatsApp outreach
  tool.** `.claude/initiatives/ge-sales-whatsapp-app.md` — see Key decisions below. This
  is the primary thing the next session picks up.
- **Real-time store-credit issuance work STARTING this same session**, immediately
  after this handoff — see "What's pending" below; this supersedes the earlier
  "do not start yet" backlog note in `gebeauty/pending-fixes.md` for that item. Lucas
  is actively building it now, not just scoping it.

## Key decisions

- **Sales WhatsApp tool = its own custom private Shopify app**, embedded in GE Beauty's
  Shopify admin — explicitly NOT folded into `apps/omnify-admin` or `apps/connector`
  (those serve the multi-tenant CPG Labs product; this is GE-Beauty-only). Matches the
  repo's existing separation discipline (two Prisma schemas, don't unify).
- **Freshness via `orders/create` webhook, not polling.** Once there's a backend at
  all, a webhook beats "recheck live before contact": HMAC-verified webhook flips a
  customer to `converted_at=<order timestamp>` the instant they order; the UI just
  queries `WHERE status='pending'`. Solves "don't message the 7PM buyer who bought at
  5PM" structurally, not with a staleness window.
- **Cohort source = the Shopify tag, not a shared DB/API with the Python pipeline.**
  `retag_arms.py` already stamps every SEND customer with a wave tag
  (`retention-reactivation_<date>` + broad `retention-reactivation`). The app queries
  Shopify directly for tagged customers + live balance > 0 — the tag + balance IS the
  interface. No new coupling between the ops-scripts world (fast-iterating, changes
  monthly) and the app (should stay stable).
- **Active wave tag: hardcoded constant in v1, admin-editable field later** (Lucas,
  explicit sequencing call, not a design compromise — don't build the settings UI until
  a second wave proves it's needed).
- **WhatsApp send = wa.me deep link**, not Zoko API automation (keeps the personal
  sales-rep touch; Zoko stays reserved for the existing bulk/broadcast use case in
  `scripts/build_zoko_list.py` — different mechanic).
- **GE Beauty only, no multi-tenant abstraction** — port to Omnify/Flywheel later only
  if a tenant actually wants it.
- Precedent reviewed before designing: `growth/retention-machine/build_retail_wa_list.py`
  (Excel export, wa.me links, manual Status column, region-bucketed — has reusable
  region-bucketing + repor/descobrir recommendation logic worth porting into the app,
  not re-deriving).

## What's pending

1. **Sales WhatsApp app build** — phases 2-8 in `.claude/initiatives/ge-sales-whatsapp-app.md`,
   all unstarted: scaffold the app (App Bridge, session-token auth, own small
   Postgres/Prisma schema, deploy target — reuse the Lightsail pattern from
   `apps/omnify-admin` unless there's a reason not to), cohort ingestion, the
   `orders/create` webhook, Polaris UI, install + smoke test on GE Beauty's store,
   cutover from the manual Excel process. Needs Partner-dashboard/dev-store access this
   Cowork sandbox doesn't have — that's why this is a Code handoff.
2. **Real-time store-credit issuance** (started same session, right after this handoff
   — check `gebeauty/growth/retention-machine/` for a new script, most likely named
   `issue_just_bought.py`, and check whether a scheduled task named around
   `issue-just-bought`/`store-credit-just-bought` was created). Trigger: an existing
   Shopify Flow ("Tag customer just-bought on order paid") already tags a customer
   `just-bought` when their order is paid — see screenshot context in conversation, not
   re-attachable here, but the Flow is real and live in Shopify today. The new script's
   job every 15 min: pull customers tagged `just-bought`, issue credit per the
   established 20% rule (`PCT=0.20, CEIL=120.0, FLOOR=10.0` — see
   `store_credit_push.py` line ~28, reused as-is for consistency), remove the tag.
   **Verify this actually got built and scheduled** — if it didn't, that's the very
   next thing to do, and the design notes above (idempotency via an append-only ledger
   keyed on order id, not just the tag) are the load-bearing part to get right.
3. **Git status oddity, unresolved.** After this session's plumbing-commit work,
   `git status --porcelain=v2` reports a handful of paths in
   `gebeauty/growth/retention-machine/` (`dual_arm_issue.py`, `dual_arm_split.py`,
   `learning/readout-2026-08-07.md`) and `.claude/initiatives/ge-sales-whatsapp-app.md`
   inconsistently — appearing as both a staged deletion AND untracked in the same
   status call, even after a full `git reset` (index rebuilt from HEAD). The actual
   file *content* on disk is verified correct and unaffected (checked via `ls -la` and
   direct reads); this looks like leftover index bookkeeping fallout from an earlier
   killed `git commit` on this specific Cowork mount (a stale `.git/index.lock` from
   Aug 7 18:48 was found and removed during this investigation — that part IS fixed).
   **First thing to do in Code: run a plain `git status` with native tooling** (no
   Windows/Linux mount translation layer in the way) and confirm these paths are sane;
   if they still look wrong, `git add` the correct on-disk versions and commit — do NOT
   `git rm` anything, the working-tree content is the correct, current version.

## Modified files

- `gebeauty/growth/retention-machine/learning/segment-tags-snapshot-2026-08-07-ge60d.jsonl` —
  complete (new, gitignored, PII — a one-time proxy snapshot, not durable infra).
- `.claude/initiatives/retention-experiments.md` — complete (August wave Phase 8 closed
  out, segment-tag-drift note appended).
- `gebeauty/pending-fixes.md` — complete (two new entries: snapshot-at-issuance-time
  fix for future waves; note that real-time issuance is now actively being built, not
  just backlogged).
- `.claude/initiatives/ge-sales-whatsapp-app.md` — complete for phase 1 (architecture),
  phases 2-8 are the actual pending work, not yet started.
- `gebeauty/growth/retention-machine/dual_arm_issue.py`, `dual_arm_split.py` — complete,
  already shipped and used for the August wave; see git status oddity note above, the
  content itself is fine, just double-check the git bookkeeping.
- Whatever this session creates after the handoff for real-time issuance — check
  `gebeauty/growth/retention-machine/` for new files and `git log --oneline -5` for the
  commit before assuming it wasn't done.

## Current state

- Check `.claude/initiatives/ge-sales-whatsapp-app.md` frontmatter (`current_phase`,
  `next_blocker`) for the freshest status — it's the source of truth over this handoff
  if they ever disagree.
- Check `git log --oneline -10` for the latest commits from this session (search for
  "ge-sales-whatsapp-app", "just-bought", "retention:").
- The August wave's credits are still live and expiring on a 7-day clock from their
  individual issuance times (issued around 2026-08-07) — the sales WhatsApp app's first
  real user, once built, is working down whatever's still unredeemed from that wave.

## Recommended next steps

1. Run `git status` natively and resolve the bookkeeping oddity noted above before
   trusting any further commits in this area blindly.
2. Confirm whether the real-time issuance script + scheduled task got built this
   session (see "What's pending" #2) — if yes, watch its first few real runs closely
   given this session's history of catching a real duplicate-issuance bug in adjacent
   code; if no, that's the next build.
3. Start the sales WhatsApp app scaffold (`.claude/initiatives/ge-sales-whatsapp-app.md`
   phase 2) — architecture is fully decided, nothing left to re-litigate there.
4. Once real-time issuance is live, the store-credit notification email template
   (`gebeauty/growth/retention-machine/emails/store-credit__notification.liquid`) will
   need a new `ctx` value for "just bought, here's cashback" — its existing
   goodwill/reactivation/refill copy doesn't fit a customer who just purchased. Flagged,
   not yet designed.
5. Lucas flagged a further consequence of real-time issuance: existing flows/reminders
   about store credit need updating since credit no longer arrives in a batch wave
   customers can be told about all at once — a reminder mechanism for individually
   time-staggered credits is a real, not-yet-scoped follow-on.

## Context the next session needs

- **The 20% rule is the established, load-bearing constant set for ALL store-credit
  issuance in this program**: `PCT = 0.20`, `CEIL = 120.0` (max credit R$120),
  `FLOOR = 10.0` (skip issuance below R$10) — defined in `store_credit_push.py` line
  ~28. Reuse these exact values for any new issuance mechanism; don't reinvent.
- **Idempotency is append-only-log-derived, never a rewritten state file.** This
  session found and fixed a real production bug: `dual_arm_issue.py`'s original
  idempotency tracking was a periodically-rewritten whole-JSON-file
  (`dual-arm-issue-state.json`); the sandbox's ~120s per-tool-call kill cap landed
  mid-rewrite once, corrupting the file, causing 55 duplicate credit issuances
  (R$2,616.57 excess, corrected via debit). Fix: derive "already done" live from an
  append-only `.jsonl` log every run, defensive try/except per line. Any new
  money-issuing script (including the real-time `just-bought` one) MUST follow this
  pattern from day one — don't repeat the mistake in new code.
- **Wave tagging convention**: broad stable tag (`retention-reactivation`) + wave-dated
  tag (`retention-reactivation_YYYY-MM-DD`) on every SEND customer, applied by
  `retag_arms.py`. This is the interface the sales WhatsApp app reads from — see Key
  decisions above.
- **Zoko vs wa.me — two different mechanics, don't conflate.** Zoko
  (`scripts/build_zoko_list.py`) is for bulk/broadcast WhatsApp campaigns. wa.me deep
  links (`build_retail_wa_list.py`, and the new sales app) are for 1:1 personal rep
  outreach. The sales app explicitly stays wa.me.
- **This Cowork sandbox cannot**: run the Shopify Partner install flow, deploy to
  Lightsail, or do anything requiring a persistent dev/deploy environment — hence this
  handoff instead of building the app directly.
- **AskUserQuestion has been flaky this session** (intermittent `AbortError`/stream-
  closed failures) — if it fails, fall back to a plain-text question in chat rather
  than retrying repeatedly; this has happened multiple times across sessions.
