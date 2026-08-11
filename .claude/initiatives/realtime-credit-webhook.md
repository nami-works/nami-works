---
id: realtime-credit-webhook
name: Move just-bought store-credit issuance from Cowork poller to a Shopify webhook
owner: cto
status: in-progress
priority: normal
created: 2026-08-10
target: null
current_phase: 4-webhook-route-built
next_blocker: another session is concurrently mid-migration on the connector's infra
  (ECS/RDS → Lightsail Docker Compose + self-hosted Postgres, on branch
  chore/connector-prune-nami-agent-surface) — confirmed real by Lucas 2026-08-10, not
  yet landed. Wait for that to land before touching prod: the deploy/migration plan in
  phase 5 below assumed the now-decommissioned ECS+RDS setup and needs re-planning
  against Lightsail (SSH + docker compose, no more temporary-SG-allowlist migration
  runbook, no more scripts/deploy-connector.ps1).
next_owner: lucas (confirm the other session has landed, then re-open phase 5 planning)
pr: https://github.com/nami-works/nami-works/pull/98
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
- [ ] 5. **Re-planned 2026-08-10 for Lightsail** (superseded ECS/RDS plan below was never
      run). Sequence, once the other session's infra migration has landed:
      1. Confirm the migration story on Lightsail's self-hosted Postgres (no more
         temporary-SG-allowlist runbook — that was RDS-specific; likely `docker compose
         exec` into the connector container, or SSH + run `prisma migrate deploy`
         directly against the box's Postgres. Check whatever the other session's landed
         `apps/connector/CLAUDE.md` / deploy docs say once merged).
      2. Create the secret for the custom app's API secret key (NOT the Admin API access
         token — used only for HMAC verification) wherever Lightsail secrets now live
         (SSM `/omnify/` prefix per root CLAUDE.md, or the box's env files at
         `/etc/cpg-labs/*.env` — confirm which).
      3. Deploy `apps/connector` (build → push to ECR → SSH to box → bump tag in
         `/srv/cpg-labs/docker-compose.yml` → `docker compose pull && up -d`, per the
         landed `apps/connector/CLAUDE.md`).
      4. For the agreed contained test: do NOT register the real
         `webhookSubscriptionCreate` yet — hand-craft one HMAC-signed request against a
         real recent order's data and POST it directly to the deployed endpoint. Confirms
         the full pipeline without going live for every future order. (Register the real
         subscription only at actual cutover, phase 7.)
      5. Pause the Cowork scheduled task `issue-just-bought-credit` for the duration of
         the test (confirmed with Lucas) to eliminate double-credit risk on the test
         order; re-enable after.
      Old ECS/RDS-based plan (temporary SG allowlist, `scripts/deploy-connector.ps1`) is
      VOID — that infra was torn down 2026-06-29.
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
