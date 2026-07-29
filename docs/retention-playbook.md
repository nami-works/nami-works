# GE Beauty Retention Playbook — store-credit machine

Canonical reference for the store-credit retention program: policy, targeting evidence,
wave mechanics, the RFM WhatsApp disparador, measurement discipline, and hard-won platform
constraints. Written 2026-07-29 after the first full wave cycle (issue → extend → measure).

Code + state live at `gebeauty/retention-machine/` (engine spec in its `README.md`).
Campaign history: `.claude/initiatives/gebeauty-review-repurchase.md`.
Messaging voice/authoring: `/crm-director`. The retention **program** (mechanic + targeting +
measurement + orchestration) will eventually get its own `retention-director` skill — decision
made, minting deferred until the wave loop stabilizes. It is NOT folded into crm-director.

---

## 1. The mechanic and the locked policy

**Store credit replaces BEAUTYBACK cashback codes** (CRM Bonus is out; we issue native Shopify
store credit on the customer's own account). Locked policy:

- **Value: 20% of the last PAID order subtotal, floor R$10.** No per-order redemption cap —
  see §2, this is a platform reality, not a choice.
- **Expiry: 60 days after last purchase**, extendable per campaign **with team notice**
  (retail communicates extensions; extensions are silent `notify=false` API operations).
- Credits are issued `notify=false` by default when the send channel is WhatsApp; the Shopify
  "store credit issued" notification email (with `notify=true`) is the email channel.
- **Confirm-before-customer-facing** always applies: issuance runs are smoke-paused and gated.

## 2. Platform constraints (verified — do not re-litigate)

- **No native redemption cap exists.** Store credit is a wallet tender: it applies up to the
  full order total. The old "cashback covers ≤25% of the order" coupon mechanic is NOT
  reproducible. The only levers are **issued amount** and **expiry**. Size credits accordingly.
- **No partial-apply by the customer.** Checkout auto-applies up to order total; leftover
  balance stays on the account.
- **No expiry-update API.** Extending expiry = debit the live balance + re-credit the same
  amount with a new `expiresAt` (`extend_expiry.py` pattern, with a `pending-recredit.jsonl`
  safety net so a failed re-credit never strands a customer at R$0).
- **Metafields do NOT render in Shopify notification-email Liquid** (only native fields +
  customer TAGS). This is why product recs moved to a customer metafield consumed elsewhere
  and the notification hardcodes fallbacks. Don't retry.
- **Zoko sends:** templates are `buttonTemplate` type — `POST /v2/message` must carry
  `type:"buttonTemplate"`, NOT `"template"` (which 404s misleadingly). Last template arg is the
  full button URL (bake UTMs there).

## 3. Targeting — what the causal readout says

First reactivation wave (2026-07-06, ≥60d recency, 13,935 SEND / 1,621 HOLD, 20% credit,
7-day expiry later extended to 17/07). Holdout-controlled repurchase lift at 2026-07-14:

| Recency band | Lift (pp) | Verdict |
|---|--:|---|
| 60–90d | +0.60 | positive, mild |
| **91–120d** | **+1.86** | **sweet spot** |
| 121–180d | +0.72 | positive |
| **181–270d** | **+1.28** | **second peak** |
| 271–365d | +0.76 | positive |
| 366d+ | +0.46 | nearly dead — deprioritize |
| **ALL** | **+1.01** | SEND 1.81% vs HOLD 0.80% |

~R$59k gross, ~R$10.8k credit cost, **~R$48k net** on the wave. Targeting rule going forward:
**concentrate on 90–270d recency**; include 60–90 and 271–365 at lower priority; skip 366d+.

The **refill wave** (<60d, 176 SEND / 19 HOLD) is unreadable — HOLD n=19 is noise (its 10.53%
"repurchase rate" is 2 people). The 45–59d question needs a bigger control before any read.
The **7/7 sale-day A/B** (H-SALEDAY-PUSH-01) is incomplete: Arm C never fired, so
WhatsApp-timing remains an open hypothesis (`learning/hypotheses.md`).

## 4. Wave mechanics (the loop)

1. **Build cohort** with recency bands + **deterministic holdout hashed on customer GID**
   (`md5(customer_id)`; waves ≤ 2026-07-07 used phone-hash — that seam is documented in the
   initiative; never mix the two inside one wave).
2. **Dedup before issue** — match on **phone AND name**, never phone alone. (The keeper-rule
   correction, `correct_keeper.py`, exists because phone-only dedup gave 109 same-person sets
   the wrong account/amount. It is a wave-pinned one-shot: DO NOT RE-RUN.)
3. **Snapshot the wave** to `learning/sends.jsonl` BEFORE issuing (both arms, full context:
   band, products owned, credit amount, expiry).
4. **Issue** via an idempotent, resumable script with its own `*-state.json` re-run guard and
   a smoke-pause at 3. **Append every credit event to `learning/credit-ledger.jsonl`**
   (`from credit_ledger import append_event`) — including manual one-offs. This is a hard rule;
   the ledger is the canonical record of what was credited (see retention-machine README §credit
   ledger).
5. **Tag both arms** (`retag_arms.py`): dated tags (`retention-<wave>_<date>`) for per-wave
   lift + stable tags (`retention-reactivation[_control]`) for long-term suppression/revenue.
6. **Send** (email `notify=true`, or Zoko WhatsApp, or the manual disparador §5). Send scripts
   must be **resumable-by-success-log** — log only successes so a re-run backfills without
   duplicates (proven pattern: mid-broadcast network drop, resumed to 1,142/1,142 clean).
7. **Measure** with `measure_reactivation.py` at +3d/+7d/expiry → `learning/readout-<date>.md`.
   Lift = SEND − HOLD repurchase %, per band; net = gross − credit redeemed.

## 5. RFM WhatsApp disparador (manual per-store send)

For sends run by the retail team through Lucas's per-store WhatsApp disparador spreadsheet.

- **RFM source = native Shopify `rfm_group`** (segment query:
  `customerSegmentMembers(query:"rfm_group='X'")`; member id numeric == Customer id). There is
  no per-customer RFM field. Groups holding live credit: CHAMPIONS / LOYAL / ACTIVE / PROMISING /
  NEEDS_ATTENTION / AT_RISK / PREVIOUSLY_LOYAL / ALMOST_LOST / DORMANT (never NEW/PROSPECTS).
- **Builder:** `build_disparador_rfm.py` → `out/disparador-credito-<slug>.xlsx`. Columns his
  formula consumes: **rfm · First Name · Crédito · Phone · Mensagem RFM**. `{valor}` is baked
  per row; `{nome}/{vendedor}/{shopping}` stay as his formula's placeholders; `¶¶` = line
  breaks, `*bold*` = WhatsApp bold.
- **Filters:** valid mobile only (13 digits, starts `55`, 5th digit `9` — landlines excluded,
  never pad a 9) + credit ≥ R$10.
- **4 message variants** by RFM cluster: A Fiéis / B Novos / C Esfriando / D Win-back.
  Voice: **reactivation/gift framing** ("Seu crédito de {valor} foi reativado…"), fixed date
  (never "depois de amanhã"), minimal emoji.
- **Spreadsheet gotchas:** (1) his formula prepends "55" but Phone already carries it — use
  `phone="&C8`-style reference, never concatenate another 55; (2) `HYPERLINK()` breaks on
  WhatsApp URLs >255 chars — clickable links need the VBA `Hyperlinks.Add` macro, not a formula.
- Reference split (17/07 send list): SP 3,235 · Rio 1,070 · Recife 498.
- **Any re-run is a fresh campaign:** re-scope the audience, re-date the expiry (debit +
  re-credit), and re-verify the copy's date claims before handing the file over.

## 6. Measurement discipline

- Every wave ships with a **holdout** (≈10%, GID-hash) frozen in `sends.jsonl`. No holdout,
  no wave.
- Controls must be big enough to read — the refill wave's HOLD n=19 taught this. Floor ~150+
  per cell you intend to read.
- A/B arms must BOTH fire (sale-day test died because Arm C never ran). If an arm is scheduled
  for later, it's a tracked TODO with an owner, not a hope.
- Aggressive-acquisition cohorts stay segregated from blended KPIs (CGO guardrail 6); retention
  waves are judged on **net incremental** (gross − credit redeemed) vs holdout.
- `learning/credit-ledger.jsonl` = issuance record; redemptions and expiry burn live in
  Shopify. `python credit_ledger.py` for the summary.

## 7. Edge-case / ops credits (service recovery)

Operational issues (delayed orders, damaged products, CS apologies) will demand credits with
different % and expiry than the retention policy. Rules, agreed 2026-07-29:

- **Credit programs, not exceptions.** §1's 20%/R$10/60d is the *retention* program's policy.
  Service recovery is a separate program (**`ops-goodwill`**) with its own policy space — repair
  trust, not generate lift. An edge case gets **classified into a program**; it never gets a
  bespoke one-off policy. New recurring credit reasons = new named program with its own block
  here.
- **One ledger, discriminated by `source`.** Ops credits go in the same
  `learning/credit-ledger.jsonl` with `source="ops-goodwill"`, and `notes` MUST carry the order
  gid + reason (e.g. `order #86012 delayed 9d — ops-goodwill`). Never a second file: the wallet
  is single, the record must be too.
- **Measurement exclusion.** Ops credits will land on customers inside retention cohorts —
  including HOLD-arm customers, because service recovery is never withheld to protect an
  experiment (service first, always). Therefore readouts must **exclude or flag customers who
  received a non-wave credit inside the measurement window** (read the ledger, filter
  `source not in wave-*`). Implement in `measure_reactivation.py` when the first ops credit
  exists; until then the ledger convention keeps the data clean. Ops credits stay OUT of
  retention KPIs by default (same segregation instinct as the CGO acquisition-cohort guardrail).
- **Policy knobs (Lucas's call, values still open):** ops credits default **`notify=true`** or
  CS-announced — a silent apology repairs nothing (inverse of retention's strategic silence) —
  and lean toward **longer expiry than 60d** (urgency framing on compensation reads as a second
  insult). Actual %/expiry/tiers: draft a table for Lucas's approval when the first real case
  shows up — do not invent values before that.
- **Precedent (pre-dates this framework):** the "hexagon" delayed-order batch, issued
  2026-05-22 via `gebeauty/scripts/_issue_delayed_hexagon_credits.py` — 11 customers,
  **30% of order, expiry = paid_at + 60d**, R$632.80 total. Outcome: **0/10 verifiable
  customers redeemed — 100% expired unused.** The script set no notify and no goodwill message
  went out, which is the prime suspect: the customers likely never knew. Evidence FOR the
  notify-default above, and a caution against ratifying 30%/60d on this sample — the values
  were never actually *experienced* by anyone. Backfilled to the ledger as `ops-goodwill`.

## 8. File map

| Path (under `gebeauty/retention-machine/`) | What |
|---|---|
| `credit_ledger.py` + `learning/credit-ledger.jsonl` | canonical credit-event ledger (hard append rule) |
| `issue_reactivation.py` / `issue_refill.py` + `*-state.json` | wave issuance (idempotent, smoke-paused) |
| `extend_expiry.py` + `pending-recredit.jsonl` | expiry extension via debit+re-credit |
| `retag_arms.py` | dated + stable cohort tags |
| `measure_reactivation.py` → `learning/readout-*.md` | holdout lift readouts |
| `build_disparador_rfm.py` → `out/*.xlsx` | RFM WhatsApp disparador (PII, gitignored) |
| `store_credit_push.py` | cohort builder (GID-hash holdout) |
| `correct_keeper.py` | one-shot keeper-rule fix — DO NOT RE-RUN |
| `emails/store-credit__notification.liquid` | unified issued-credit email (credit_context branch) |
| `learning/sends.jsonl` | frozen per-wave send log (PII, gitignored) |
| `learning/hypotheses.md` | test backlog (H-TIMING-01, H-SALEDAY-PUSH-01, …) |
| `engine.py` + `config.json` | review-for-reward engine (see its README) |

## 9. Open threads (as of 2026-07-29)

1. **Ana Beatriz notification** — R$138.64 manual credit (16/07, expires 04/09) is silent;
   decide whether to email her. Her Shopify history also shows an unexplained R$129
   debit/re-credit pair — logged in the ledger, balance correct.
2. **Sale-day / timing hypotheses** — need a re-run with both arms firing.
3. **retention-director skill** — mint once the wave loop stabilizes (this doc is its seed).
4. **Refill (<60d) question** — re-test with a readable control.
