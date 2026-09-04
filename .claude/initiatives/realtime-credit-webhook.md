---
id: realtime-credit-webhook
name: Move just-bought store-credit issuance from Cowork poller to a Shopify webhook
owner: cto
status: in-progress
priority: normal
created: 2026-08-10
target: null
current_phase: 6b-hold-deployed
next_blocker: PR #125 (2026-09-04) changed the webhook's own shape — orders/paid no
  longer issues credit immediately, it now writes a pending_hold row (holdUntil = +72h)
  and a 15-min sweep (process-pending-credit.ts) does the actual issuance later. Also
  added: orders within 100km of a physical store, or picked up/sold in-store, always
  get the 60-day arm (armForcedReason column audits this vs. the random 3-arm draw).
  Deployed + migration applied to prod same day, health check clean, but NOT YET
  watched end-to-end for a real order (the ~76h wait to confirm hold->sweep->issued
  actually fires wasn't automatable — cloud routines can't reach the box with the
  local SSH key, and a local Windows Scheduled Task / manual check was Lucas's call to
  make later, not scheduled). Once ~76h have passed since 2026-09-04 deploy, check:
  any JustBoughtCreditIssuance rows stuck in pending_hold past their holdUntil (sweep
  not running), and confirm at least one row transitioned to issued with a real
  Shopify credit grant. THEN still need the original phase-7 question below.
next_owner: lucas or next session (check the hold/sweep pipeline once ~76h have
  passed since the 2026-09-04 deploy; also still decide poller pause/resume, phases 7-8)
pr: https://github.com/nami-works/nami-works/pull/98 (original webhook), https://github.com/nami-works/nami-works/pull/125 (100km-radius arm override + 72h hold)
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

## Hosting decision (locked 2026-08-10)

**`apps/connector`, now.** Confirmed directly with Lucas via AskUserQuestion. Add the
webhook route + Prisma model to the existing Fastify + Prisma + AWS ECS backend already
live at `mcp.gebeauty.com.br`. Not revisiting the sales-WhatsApp-app-fold option unless
Lucas reopens it.

## Phases

- [x] 1. Architecture locked (webhook > Flow > polling, tag retirement, idempotency
      model) — 2026-08-10.
- [x] 2. Decide hosting — `apps/connector` confirmed 2026-08-10.
- [x] 3. Prisma model `JustBoughtCreditIssuance` (unique on `(tenantId,
      shopifyOrderId)`) + migration `20260810230000_add_just_bought_credit_issuance`
      (hand-authored, no local DB reachable to run `migrate dev`; follows the exact SQL
      shape of the existing migrations — verify shape once more against a real DB before
      `prisma:deploy`). Also added `@@index([shopifyShop])` on `IntegrationTenant` for
      the shop-domain lookup.
- [x] 4. Webhook route built: `apps/connector/src/webhooks/{index,verify,just-bought-credit}.ts`,
      mounted from `server.ts` at `POST /:tenant/webhooks/shopify/orders-paid`. HMAC
      verification against the raw body (scoped Fastify plugin so the raw-buffer parser
      doesn't leak to sibling routes) + shop-domain header check, both before touching
      the payload. Business logic (PCT/CEIL/FLOOR, 3-arm GID hash, arm tags) ported
      verbatim from `issue_just_bought.py`. Insert-then-issue ordering + P2002 no-op per
      the idempotency model. Unit tests for HMAC verify pass (`verify.test.ts`); full
      `tsc` build passes clean.
- [x] 5. **Deployed to Lightsail 2026-08-11.** Old ECS/RDS-based plan (temporary SG
      allowlist, `scripts/deploy-connector.ps1`) was void — that infra was torn down
      2026-06-29. Actual sequence run: built + pushed image (`nami-works:5f030fc`) to
      ECR, refreshed the box's stale ECR login (root's docker auth token had expired —
      not on any cadence, just went stale; refresh by piping a fresh
      `aws ecr get-login-password` over SSH into `docker login` on the box), bumped the
      tag in `/srv/cpg-labs/docker-compose.yml`, `docker compose pull && up -d
      connector`. Migration applied via `docker compose exec connector npx prisma
      migrate deploy` — hit `P3005` first (the box's Postgres had **never** had a
      tracked Prisma migration run against it before this — schema existed but
      `_prisma_migrations` didn't; pre-existing hygiene gap, unrelated to this feature,
      just the first deploy to trip over it). Fixed by baselining all 10 pre-existing
      migrations (`prisma migrate resolve --applied <name>` for each) before deploying
      the 11th (this feature's) for real. Webhook secret set in SSM at
      `/nami-works/tenants/gebeauty/shopify/webhook_secret` (same value as
      `SHOPIFY_API_SECRET` in `gebeauty/.env`).
- [x] 6. **Smoke test passed 2026-08-11**, contained (no live subscription yet at test
      time): hand-crafted one real HMAC-signed `orders/paid` payload for a real order
      (#91570, Amanda Cruz Bezerra, R$95.00, direct storefront/PagBrasil — deliberately
      NOT a marketplace-channel order, and confirmed not already credited by the old
      poller) and POSTed it directly to
      `https://mcp.gebeauty.com.br/gebeauty/webhooks/shopify/orders-paid`. Verified
      end-to-end against LIVE Shopify data, not just our own DB: R$19.00 (20% of R$95,
      correct arm/floor/ceiling math) landed on her real `storeCreditAccounts` balance,
      tags `credit-goodwill` + `just-bought-credit-60d` applied, `expiresAt` correct
      (60d), and the `JustBoughtCreditIssuance` row matches. Cowork poller was paused
      for the duration per Lucas's confirmation, to rule out double-crediting the same
      order.
- [x] 5b. **Real subscription registered 2026-08-11**, per Lucas's explicit go-ahead
      (a deliberately separate call from the contained test above — this is the actual
      go-live, not a test, since it now fires on every future real order automatically):
      `webhookSubscriptionCreate` → `gid://shopify/WebhookSubscription/1963781816640`,
      topic `ORDERS_PAID`, callback `https://mcp.gebeauty.com.br/gebeauty/webhooks/shopify/orders-paid`.
- [x] 6b. **72h issuance hold + 100km-radius arm override, deployed 2026-09-04**
      (PR #125). orders/paid now only decides the arm + writes `pending_hold`
      (`holdUntil` = now + 72h); `process-pending-credit.ts`'s 15-min sweep does the
      actual `storeCreditAccountCredit` + tag mutations once the hold elapses. Orders
      within 100km of a physical GE Beauty store, or with no shipping address at all
      (POS in-store / pickup — confirmed live: those orders always report
      `shippingAddress: null`, `shippingLines: []`), always force the 60-day arm
      (`armForcedReason` audits this). Refund during the hold now cancels the pending
      row directly (`cancelled_before_issuance`) instead of issue-then-clawback.
      Migration applied to prod (2,261 existing rows backfilled), container healthy,
      246 connector tests pass. **Not yet watched end-to-end** — see next_blocker.
- [ ] 7. Cutover: **don't disable the Cowork scheduled task yet.** It's currently
      PAUSED (from the smoke test), not disabled — resume it or leave paused is an open
      call. Before permanently disabling per the original phase-7 intent, watch at least
      one REAL (non-test) order flow through the live webhook end-to-end, to confirm the
      registered subscription actually fires in production, not just the hand-crafted
      test request.
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

- A real order paid on the live store triggers the webhook within seconds (recording
  the arm decision + hold), with zero reliance on the Cowork app being open. Actual
  credit issuance is now intentionally delayed 72h (PR #125, 2026-09-04) — "done" no
  longer means instant, it means the hold->sweep->issued path is CONFIRMED to complete
  on its own, unattended, for a real order (see next_blocker above).
- A duplicate webhook delivery for the same order provably does NOT issue credit twice
  (test this deliberately — replay a webhook payload and confirm the unique constraint
  blocks it).
- The Cowork scheduled task is disabled and the Flow is either decommissioned or
  explicitly kept with a documented reason.
