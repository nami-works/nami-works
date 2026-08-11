---
id: realtime-credit-webhook
name: Move just-bought store-credit issuance from Cowork poller to a Shopify webhook
owner: cto
status: backlog
priority: normal
created: 2026-08-10
target: null
current_phase: 1-architecture-locked
next_blocker: hosting decision (apps/connector now vs. fold into the not-yet-built sales-WhatsApp app's webhook) — Lucas's call, deliberately left open, make it when you sit down to build
next_owner: lucas (via claude code) / integrations-engineer
stakeholders:
  - GE Beauty customers receiving real-time cashback credit
  - Lucas (owns the hosting decision + deploy)
working_agreement: ~/.claude/projects/c--claude/memory/feedback_cto_contract.md
---

## Why

The real-time "just-bought" store-credit poller
(`gebeauty/growth/retention-machine/issue_just_bought.py`, scheduled task
`issue-just-bought-credit`, every 15 min) works but has two structural problems Lucas
wants fixed: (1) it only runs while the Cowork desktop app is open, not true server-side
infra; (2) it detects work via a Shopify Flow tag + a live `tag:'just-bought'` search
query, which is subject to Shopify's search-index eventual-consistency lag (confirmed
directly during testing — a customer showed up in the query seconds after their tag was
actually removed). Lucas asked directly: "what is the most Shopify-native way of doing
this, server-side, not as a scheduled task here." This file is the architecture answer
+ build roadmap, handed to a Claude Code session because actual deployment (AWS
ECS/Lightsail, Shopify webhook registration) needs infra access this Cowork sandbox
doesn't have.

## Architecture decision (locked 2026-08-10)

- **Webhook (`orders/paid`) beats both Flow and polling.** Shopify's own primitive for
  "run server code the instant something happens" is a webhook subscription — Shopify
  POSTs the order to your endpoint within seconds of payment. Flow can't do the 20%-of-
  order-total math without a custom Flow Action app extension (more build for no
  functional gain once the logic is server-side anyway); polling is a workaround for not
  having a listener, which is exactly what's being replaced.
- **Retire the `just-bought` tag and its Flow entirely, not just the poller.** The tag
  exists only because nothing used to listen for the order-paid event directly. The
  webhook payload already carries the order total — there's nothing left for the tag to
  do. Don't keep the Flow "just in case"; it's dead weight once the webhook ships. (If
  Lucas wants to keep the Flow visible in Shopify Admin for legibility, that's a
  deliberate call to make explicit, not a default.)
- **Idempotency: same principle as `issue_just_bought.py`, upgraded to a real DB
  constraint.** Shopify webhooks are at-least-once delivery — the same order can arrive
  twice. The append-only-ledger lesson from the poller (never a rewritten state file;
  derive "already done" live) still applies, but a production webhook handler should
  enforce it with a unique constraint on `order_id` in a real table (Prisma, in
  whichever backend hosts this), not a `.jsonl` file. Check-then-issue-then-record in
  one transaction if the DB supports it; at minimum, insert-with-unique-constraint
  BEFORE calling `storeCreditAccountCredit`, and treat a constraint violation as "already
  handled, no-op" rather than an error.
- **HMAC verification is mandatory** — every Shopify webhook handler must verify the
  `X-Shopify-Hmac-SHA256` header against the app's client secret before trusting the
  payload. Non-negotiable, not a nice-to-have.

## Open decision — make this when you sit down to build (not decided here on purpose)

Where does the handler live?
- **`apps/connector`, now** — the existing Fastify + Prisma + AWS ECS backend already
  live at `mcp.gebeauty.com.br`. Add one new webhook route + one new Prisma model
  (`prisma/connector/schema.prisma`). Fastest to ship, reuses proven deployed infra.
- **Fold into the sales-WhatsApp app's backend, once built** — that app
  (`.claude/initiatives/ge-sales-whatsapp-app.md`) already needs an `orders/create`
  webhook to detect conversions for its contact list. One receiver could serve both
  concerns. Architecturally tidier (one Shopify-event listener, not two), but blocked on
  that app existing, which it doesn't yet.

Lucas's instinct going into this session favored `apps/connector` for speed; this was
never confirmed (AskUserQuestion failed twice mid-session) — treat it as a real open
call, not a done deal.

## Phases

- [x] 1. Architecture locked (webhook > Flow > polling, tag retirement, idempotency
      model) — 2026-08-10.
- [ ] 2. Decide hosting (see Open decision above).
- [ ] 3. Add Prisma model for issuance idempotency (`order_id` unique) + migration, in
      whichever backend was chosen.
- [ ] 4. Build the webhook route: HMAC verification, port the 20%-rule constants
      (`PCT=0.20, CEIL=120.0, FLOOR=10.0`) and the 3-arm expiry-hash logic (independent
      GID hash, own salt `"|realtime-expiry-arm-2026-08"`, 30/45/60 days,
      `just-bought-credit-{30,45,60}d` tags) straight out of
      `gebeauty/growth/retention-machine/issue_just_bought.py` — don't redesign the
      business logic, just re-host it.
- [ ] 5. Register the `orders/paid` webhook subscription against the GE Beauty store
      (Admin API `webhookSubscriptionCreate`, or via the app's config if using a
      Shopify CLI-managed app).
- [ ] 6. Smoke test against a real order (same pattern as the poller's smoke test:
      verify credit amount, arm tag, expiry, notification copy).
- [ ] 7. Cutover: disable the Cowork scheduled task `issue-just-bought-credit` ONLY
      after the webhook is confirmed working end-to-end — don't disable it first and
      leave a gap where no issuance happens at all.
- [ ] 8. Decommission the "Tag customer just-bought on order paid" Shopify Flow (or
      explicitly decide to keep it dormant) once the webhook has run clean for a few
      days.

## Context the next session needs

- Business logic to port, verbatim, lives in
  `gebeauty/growth/retention-machine/issue_just_bought.py` (committed `7d48318`) — this
  is the reference implementation, not a rough draft. The webhook handler is a
  re-hosting of this logic with a better trigger and better idempotency, not a rewrite.
- The scheduled task `issue-just-bought-credit` (Cowork, every 15 min) is live and
  correctly issuing credit right now — do not touch it until step 7's cutover.
- Ledger for the current mechanism: `gebeauty/growth/retention-machine/learning/just-bought-issued.jsonl`
  (gitignored, PII) — useful for cross-checking the new webhook's first real issuances
  against what the poller would have done, during smoke test.
- ctx stopgap: notification reuses the `credit-goodwill` tag/copy (doesn't perfectly fit
  "just bought, here's cashback" — a real copy gap, tracked separately in
  `gebeauty/pending-fixes.md`).

## Done means

- A real order paid on the live store triggers credit issuance within seconds, verified
  end to end, with zero reliance on the Cowork app being open.
- A duplicate webhook delivery for the same order provably does NOT issue credit twice
  (test this deliberately — replay a webhook payload and confirm the unique constraint
  blocks it).
- The Cowork scheduled task is disabled and the Flow is either decommissioned or
  explicitly kept with a documented reason.
