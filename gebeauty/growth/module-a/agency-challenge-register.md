# Agency Challenge Register — GE Beauty paid media

A client-side accountability loop on the media agency. We hold our own Meta access
(meta-ads MCP) + the Module A margin model, so every finding here is verified against
**independent data**, not the agency's reporting. The agency keeps the wheel; this is
the instrument panel that says whether the driving is working.

**Framing (important):** internally this is rigorous and adversarial — we actively try
to find what's underperforming. Externally, findings become a **constructive punch-list**
("here's what our profit model surfaces, can we lean this way?"), never a gotcha. The
agency is a good partner; the goal is to make their results better and defensible, which
usually unlocks more budget for them. Rigor in, diplomacy out.

## The loop (biweekly cycle)

1. **Challenge** — pull fresh Meta (spend/ROAS by campaign + ad, Opp Score) via MCP,
   join to the Module A margin truth, refresh + rank findings. Low-hanging fruit =
   high impact × easy for the agency to action.
2. **Prompt** — translate the findings into a short constructive ask list handed to the
   agency (through Lucas, or a shared doc). Each ask has a specific expected action.
3. **Validate** — next cycle, re-pull independently and check: *did the structural
   change actually happen in the account?* (ad set paused, budget shifted, enhancement
   on). A "yes we did it" from the agency is not evidence; the data is.
4. **Follow up** — acted → measure it; not acted → re-ask / escalate with the cost of
   inaction quantified.
5. **Map results** — attribute the metric delta (ROAS, CPA, blended efficiency, absolute
   contribution profit) to the change. Log it. This is the scoreboard over time.

**Status vocabulary:** `open` (found, not yet raised) → `raised` (given to agency, dated)
→ `acted` (change confirmed in data) / `not-acted` → `measured` (result logged) → `closed`.

## Validation method per finding type

| Finding type | How we independently verify the fix + result |
|---|---|
| Ad set paused/killed | ad set no longer spending in the next MCP pull |
| Budget reallocated | spend share moved toward the named winners; blended ROAS delta |
| Free-efficiency lifts (music / A+ / multi-text) | Opportunity Score rises; CPA / CPM trend |
| Structure consolidation | fewer overlapping ad sets; CPM trend (less self-competition) |
| Destination/message-match fix | ad-level `link` points to the right PDP/LP; CVR on those ads |
| Product conversion leak | CTR vs ROAS gap closes after LP/offer fix (partly our side) |

---

## Findings — cycle 0 (seeded 2026-07-21)

Ranked by leverage × ease. Evidence provenance marked: **[fresh]** = 30d MCP pull
2026-07-20; **[carry]** = from the paid-media-scale initiative's earlier analysis,
re-verify in cycle 1.

### F1 — Four Primer static tests bleeding below breakeven **[fresh]** · severity HIGH
- **Evidence:** Liso Coloquial ROAS 1.18 (R$2.0k) · Liso Institucional 1.74 (R$2.2k) ·
  Cachos Coloquial 2.13 (R$3.2k) · Cachos Institucional 2.54 (R$2.7k). All below the
  2.86 breakeven. ~R$10k/30d spent at a loss.
- **Challenge:** test budgets should carry a kill criterion. Why are four losers still
  live after a full 30d? 
- **Ask:** pause them (or hard-cap) and fold the budget into proven winners.
- **Validate:** these ad sets show ~0 spend next pull.
- **Result metric:** ~R$10k redeployed; blended ROAS delta.
- **Status:** open

### F2 — Proven winners starved **[fresh]** · severity HIGH
- **Evidence:** Novos Vídeos *Validados* 7.71 @ R$1.5k · Liso review 6.67 @ R$1.0k ·
  Cachos review 4.26 @ R$1.3k. The 7+ ROAS creatives get <2% of spend each while the
  4.70 workhorse holds 48%.
- **Challenge:** the account's best-performing creatives are the least funded. That is
  backwards for efficiency at this spend level.
- **Ask:** graduate the validated/review winners into a funded slot (and we supply more
  variants of those angles from our in-house pipeline).
- **Validate:** spend share on these rises materially next pull.
- **Result metric:** blended ROAS lift toward ~5 on flat total spend.
- **Status:** open

### F3 — Free-efficiency lifts likely unharvested **[carry, verify]** · severity MED
- **Evidence (to re-confirm):** Opportunity Score ~63/100 with Meta-flagged free lifts —
  music on ads (+CTR), A+ standard enhancements (~-11% CPA), Reels 9:16 + audio,
  multi-text. Zero-cost mechanical gains Meta itself recommends.
- **Challenge:** a good agency harvests the platform's own free lifts before asking for
  more budget. Are these on?
- **Ask:** apply the flagged enhancements across eligible ads.
- **Validate:** Opp Score rises; CPA/CPM trend down.
- **Status:** open (pull Opp Score in cycle 1)

### F4 — Auction fragmentation / self-competing ad sets **[carry, verify]** · severity MED
- **Evidence (to re-confirm):** multiple ABO ad sets flagged as self-competing in the
  same auctions, inflating CPM. The 30d view shows many parallel Primer ABO test sets.
- **Challenge:** fragmented structure makes GE bid against itself and starves the
  learning phase.
- **Ask:** consolidate overlapping ad sets; concentrate learning.
- **Validate:** fewer overlapping sets; CPM trend.
- **Status:** open

### F5 — Ad destination / message-match leaks **[carry, verify]** · severity MED
- **Evidence (to re-confirm, from landing-page initiative):** ~10 product ads point to
  the homepage and ~7 "buy now" ads point to `/pages/indique-e-ganhe` instead of the
  product PDP/LP. Traffic paid for, then dropped on a mismatched page.
- **Challenge:** paying for clicks that land on the wrong page is pure waste, independent
  of creative quality.
- **Ask:** repoint those ads to the correct PDP/LP.
- **Validate:** ad-level `link` field corrected in the next pull; CVR on those ads.
- **Status:** open

### F6 — Ramping into diminishing returns without flagging it **[fresh]** · severity MED
- **Evidence:** spend +38% (R$59k→R$82k/30d) while ROAS fell 5.29→4.46 (-16%). The
  marginal dollar is getting less efficient.
- **Challenge:** is the agency managing the efficiency frontier, or just deploying the
  budget? We want their read on *marginal* efficiency and the plan to defend it
  (this is where the incrementality test comes in).
- **Ask:** a stated marginal-efficiency plan + agreement to run a Meta Conversion Lift
  before the next step up.
- **Validate:** lift test scheduled; marginal ROAS read.
- **Status:** open

### F7 — Primer Liso: conversion leak, not a demand problem **[carry, verify]** · severity MED
- **Evidence:** Primer Liso high CTR (~5.5%) but low ROAS (~2.4) — strong interest, weak
  conversion. Points to LP/PDP/offer, not media.
- **Challenge:** scaling media into a leaky funnel wastes spend; the fix is the page, not
  the bid. (Shared: the LP side is ours — landing-page-replication initiative.)
- **Ask:** hold Liso media flat until the PDP/LP conversion gap is addressed on our side.
- **Validate:** CTR-vs-ROAS gap closes post-LP fix.
- **Status:** open

---

## Scoreboard (fills in as cycles run)

| Cycle | Date | Findings raised | Acted | Verified result |
|---|---|---|---|---|
| 0 | 2026-07-21 | F1–F7 seeded | — | — |
