# Session Handoff — 2026-07-30

**Scope:** GE Beauty's store-credit **retention program** — its policy, targeting evidence, and
the `ops-goodwill` service-recovery framework it recently spun off. The CD Extrema fulfillment
delay is the current, still-open **task** inside that program, not a separate topic. This work
is moving from Claude Code to **Cowork** (Lucas's direction, end of this session).

## The retention program (read this even if you skip everything else)

GE Beauty runs a store-credit retention program on native Shopify store credit (replaced
BEAUTYBACK cashback codes). Canonical doc: `docs/retention-playbook.md`. This section is the
self-contained fallback in case Cowork can't fluently pull this repo's docs/memory the way a
Claude Code session does.

**Locked retention policy:** 20% of last paid order, R$10 floor, 60-day expiry. Two platform
facts that apply to *any* credit issued, not just retention: **no per-order redemption cap
exists** (store credit is a wallet tender, applies up to order total) and **customers cannot
partial-apply** — the only real levers are issued amount and expiry.

**Targeting evidence** (first wave, holdout-controlled): SEND 1.81% vs HOLD 0.80% repurchase =
+1.01pp causal lift. Sweet spot 91–120d and 181–270d recency; 366d+ nearly dead.

**Hard rule:** every credit/debit event — waves *and* one-off manual credits — gets appended to
`gebeauty/retention-machine/learning/credit-ledger.jsonl` via `credit_ledger.append_event()`.
This is the one ledger; it's the only place that answers "what have we issued, to whom, what's
still live."

**The `ops-goodwill` program (agreed 2026-07-29, playbook §7):** service-recovery credits
(delayed orders, damage, CS apologies) are explicitly a **separate program from retention** —
never a one-off exception to the retention policy. Own %/expiry per case, defaults leaning
`notify=true` (a silent apology repairs nothing) and longer-than-60d expiry. Ledger
`source="ops-goodwill"`, order gid + reason in notes. Readouts exclude customers who got a
non-wave credit in the measurement window.

**The one prior ops-goodwill case is a warning, not a template:** the "hexagon" delayed-order
batch (unrelated orders, 2026-05-22, 30% credit, 60d expiry) had its goodwill message actually
sent (via an external flow) and still **0% of those credits were redeemed**. Don't inherit
30%/60d for any new case just because it's the only precedent — design each case on its own
terms and watch redemption, not just delivery.

**Skill architecture:** messaging stays in `crm-director`; the retention *program* gets its own
`retention-director` skill once the wave loop stabilizes (not yet minted). Everything above also
lives in memory (`project_gebeauty_retention_machine.md`) for any session that can read
`~/.claude/projects/c--claude/memory/`.

## Current task: CD Extrema delay (the second ops-goodwill case)

**Diagnosis**
- Confirmed **CD Extrema** (Shopify Location `gid://shopify/Location/105538257216`) fulfilled
  47 orders on **Jul 21** via TEX Courier / "Total Express MG" shipping, then **zero orders
  since** — a hard stop, not a slowdown. The backlog behind it has grown every day since.
- Ruled out **CD Cajamar** as a related incident — Lucas confirmed zero fulfillments there is
  expected (deactivated by design, not a second failure).

**Scoping the affected population** (successive exclusion passes, all read-only Shopify queries)
- Excluded local-delivery/store-fulfilled orders (shipping line = Shops Jardins, RioSul, RioMar
  Recife, Shopping Recife, Local Delivery, Frete) — different fulfillment path, unaffected.
- Excluded **TikTok-channel orders** — Lucas's explicit direction, not part of this batch.
- Excluded RETAIL/in-store POS orders and 1 Draft Order — confirmed via `sourceName`/`app`
  introspection (27 of 28 "no shipping line" candidates were `pos`/Point of Sale, 1 was a Draft
  Order; none belong to CD Extrema's e-commerce queue — they only *looked* unfulfilled because
  in-store sales don't need shipping).
- **Locked batch-1 scope: 552 orders / 546 unique customers**, created **Jul 21–29 only**,
  unfulfilled + paid + uncancelled + e-commerce channel + CD-Extrema-bound. **Orders created
  today (Jul 30) are explicitly excluded from this batch** — see Key decisions.

**Shopify actions (live now)**
- Tagged all 546 customers with **`atraso_extrema-jul-27`** via `tagsAdd` (append-only, never
  overwrites existing tags). Script: `gebeauty/scripts/_tag_cd_extrema_delay.py`, idempotent +
  resumable via `gebeauty/scripts/tag-cd-extrema-delay-state.json` (local, untracked).
- Created Shopify segment **"CD Extrema delay — Jul 21"**
  (`gid://shopify/Segment/1153124794688`), query `customer_tags CONTAINS
  'atraso_extrema-jul-27'` — verified membership = 546, matches the tagging run exactly. Usable
  today as an audience in Shopify Email/Messaging.
- Validated the `customer_tags CONTAINS 'x'` segment-query syntax empirically (read-only
  `customerSegmentMembers` preview against a tag with a known count) before ever writing —
  Shopify's own docs search didn't surface the literal syntax cleanly.

**Repo**
- Committed the tagging script on branch **`feat/cd-extrema-delay-tagging`** (commit `0020a4d`)
  — **not main**, per a repo-wide convention change made this session (cut feature branches,
  don't commit direct to main). **Not pushed yet** — deliberate pause, not an oversight.

## Key decisions

- **Batch 1 = Jul 21–29 only.** Today's orders (Jul 30) are excluded from this round of
  outreach/credit treatment. **If CD Extrema's fulfillment problem is not resolved by tomorrow
  (Jul 31), build a second batch** for everything that queued up from Jul 30 onward, using the
  same scoping method (below) and a **new, separately-dated tag** — do not reuse
  `atraso_extrema-jul-27` for batch 2.
- TikTok-channel orders are excluded from this batch entirely, not just deferred. Whether they
  need separate treatment (TikTok Shop may have its own SLA/comms) was not resolved this
  session.
- The scoping proxy is the **shipping line**, not a direct fulfillment-location field —
  `FulfillmentOrder.assignedLocation` returned empty on every order tried, both GraphQL and REST
  (`orders/{id}/fulfillment_orders.json`) — looks like a token-scope gap (`read_fulfillments`
  isn't enough; likely needs `read_merchant_managed_fulfillment_orders` or
  `read_assigned_fulfillment_orders`). The shipping-line proxy ("Total Express MG") was
  cross-validated against the 47 orders with a confirmed CD Extrema fulfillment record: 40/47
  used that shipping line, the other 7 used TikTok/SEDEX/CORREIOS PAC labels but were still
  physically fulfilled from Extrema (shipping line is the checkout-facing label, not the
  warehouse) — solid proxy, not a 100% guarantee at the margins.
- Repo git convention changed mid-session: **cut feature branches, don't commit direct to
  main** (Lucas's call, session-wide, not specific to this topic). Not yet reflected in
  `gebeauty/CLAUDE.md`.

## What's pending

1. **Comms + credit treatment for the 546 batch-1 customers** — not designed yet. Apply the
   `ops-goodwill` framework above; don't reuse the hexagon precedent's 30%/60d values uncritically
   (its own lesson: 0% redemption despite the goodwill message being sent).
2. **Verify before treating batch 1 as final.** A same-day re-check (Jul 30) found the live
   CD-Extrema-bound backlog had grown to 593 orders / 587 unique customers. 35 of those are
   today's new orders (expected, correctly excluded). But that still leaves **~6 orders
   unaccounted for** against the 546 already tagged — likely Jul 29 stragglers that landed
   after the original pull, but **verify by diffing order names, not just counts**, before
   calling batch 1 done.
3. **Second-batch trigger:** check tomorrow (Jul 31) whether CD Extrema is fulfilling again. If
   not, build batch 2 per the decision above.
4. **Root cause at CD Extrema/Total Express MG is still unknown.** This session only diagnosed
   and scoped the customer-facing fallout — it did not investigate *why* the location/carrier
   stopped fulfilling. That's a logistics-ops question, possibly its own workstream.
5. **Retention-director skill** — still deferred until the wave loop stabilizes; two ops-goodwill
   cases now exist (hexagon, CD Extrema) — worth reconsidering once this one closes.
6. **This whole thread is moving to Cowork.** The next session picking this up may not be
   Claude Code at all.

## Modified files

- **Complete, committed:** `gebeauty/scripts/_tag_cd_extrema_delay.py` — branch
  `feat/cd-extrema-delay-tagging`, commit `0020a4d`. Reusable/idempotent — re-run against a new
  customer-id list for batch 2.
- **Intentionally not committed:** `gebeauty/scripts/tag-cd-extrema-delay-state.json` — the
  script's own idempotency state, left local/untracked (matches convention elsewhere in
  `gebeauty/`).
- **Deleted this session (scratch, PII, superseded):** `gebeauty/all_orders_since_jul21.json`,
  `cd_extrema_customer_ids.json`, `cd_extrema_final_552.json`, `cd_extrema_orders.json`,
  `unfulfilled_tags.json` — the tag + segment in Shopify is now the source of truth. Don't
  recreate these as long-lived files; re-run the scoping query fresh if needed.
- **Not mine — do not touch:** other sessions' modified/untracked files were present in the
  working tree throughout (inherited dirty tree, confirmed at session start) — none related to
  this topic.

## Current state / how to verify

- Segment "CD Extrema delay — Jul 21" (`gid://shopify/Segment/1153124794688`) is live now —
  open in Shopify Admin → Customers → Segments, or query
  `customerSegmentMembers(query:"customer_tags CONTAINS 'atraso_extrema-jul-27'")` → expect 546.
- To re-run the scoping logic (read-only, ~30 lines, `urllib` only): pull
  `orders(query:"created_at:>=2026-07-21 AND fulfillment_status:unfulfilled")`, exclude
  cancelled, exclude shipping lines in `{Shops Jardins, RioSul, Local Delivery, Frete, RioMar
  Recife, Shopping Recife}`, exclude shipping line containing `"TikTok"`, exclude orders tagged
  `RETAIL`, exclude any remaining `sourceName in (pos, shopify_draft_order)` stragglers.
- Carrier signature for reference: "Total Express MG" shipping line / "TEX Courier S.A."
  tracking company.

## Recommended next steps (priority order)

1. Design the comms + credit treatment for the 546 batch-1 customers (`ops-goodwill` framework
   above) — the actual deliverable Lucas is waiting on.
2. Verify the ~6-order gap (587 current-pool customers vs 546 tagged) by diffing order names.
3. Check Jul 31: is CD Extrema fulfilling again? If not, build batch 2 (Jul 30+ orders, new
   dated tag).
4. Decide whether push/PR of `feat/cd-extrema-delay-tagging` is still wanted, now that this
   thread is moving to Cowork.

## Context the next session needs

- **`customer_tags CONTAINS 'x'`** is the validated Shopify segment-query syntax for
  tag-based segments — confirmed empirically via a dry-run `customerSegmentMembers` call, not
  doc search (docs search didn't surface the literal field name cleanly).
- **`FulfillmentOrder.assignedLocation` is empty on this store's token** (both GraphQL and
  REST) — likely a scope gap, not a data gap. This is why the shipping-line proxy exists; if
  the scope ever gets added, the scoping method could be simplified.
- **Repo git convention changed today**: feature branches, not direct-to-main. Session-wide
  change, not topic-specific — confirm it lands in `gebeauty/CLAUDE.md` if it hasn't already.
- **Working-tree collision this session:** a shared checkout (no git worktrees) meant other
  concurrent sessions' staged files got twice accidentally swept into a commit attempt here.
  Both were caught and undone non-destructively (`git reset --soft`, never `--hard`; their file
  content was never touched, only staged→unstaged). Flagged as a reason to consider isolating
  concurrent sessions (worktrees, or the Cowork move itself may resolve it structurally).
