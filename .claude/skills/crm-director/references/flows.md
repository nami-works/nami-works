# Lifecycle-flow doctrine

For `flow` mode. A flow is a multi-touch sequence with one journey-level objective,
a fixed cadence, and progressive engagement. Map each flow to the retention-machine
stream it feeds (A/B/C/D) so the copy slots into a real send, not a hypothetical one.

## The four canonical flows

### 1. Welcome (new-customer onboarding)
**Objective:** connection → brand introduction → first (or second) purchase.
**Feeds:** a new-buyer stream (post first order). Overlaps segments `08_new`, `09_promising`.

| # | Day | Objective | Spine |
|---|---|---|---|
| 1 | 0 | Welcome + immediate value | Brand intro, "no seu tempo, do seu jeito", one hero product |
| 2 | 2 | Product showcase + social proof | The ritual + real reviews (Loox), gentle CTA |
| 3 | 5 | Entry offer + soft urgency | Authorized offer only; strong-but-soft CTA |
| 4 | 10 | Re-engage + alternative | Different product angle, final CTA |

### 2. Re-engagement (dormant / lapsing)
**Objective:** reconnect + reactivate.
**Feeds:** engine **Stream D (win-back)**. Segments `05_at_risk`, `06_previously_loyal`,
`10_dormant`.

| # | Day | Objective | Spine |
|---|---|---|---|
| 1 | 0 | Recognition + nostalgia | Acknowledge the gap, no pressure, "what she loved" |
| 2 | 3 | Value reminder + what's new | New launch + old favorite, soft CTA |
| 3 | 7 | Special offer + urgency | BEAUTYBACK store credit if authorized; expiry `DD/MM` |
| 4 | 14 | Last chance + alternative | Final, respectful; permission-based for dormant |

### 3. Post-purchase (retention)
**Objective:** satisfaction → review → repeat.
**Feeds:** engine **Stream A (review ask)** + **Stream C (earned-unused reorder)**.
Segments `04_champion`, `07_active`.

| # | Day | Objective | Spine |
|---|---|---|---|
| 1 | 1 | Order confirmation + delivery | Reassurance, what to expect |
| 2 | 3 | Usage tips + education | How to use the product for best result (real claims only) |
| 3 | 7 | Review request | Loox review link (`?ref=review`), reward per Loox tier |
| 4 | 14 | Cross-sell | The complementary next step from the catalog |
| 5 | 21 | Reorder reminder | Empirical refill window (per-product; engine computes it) |

### 4. Seasonal / promotional
**Objective:** drive sales in a defined window.
**Feeds:** a one-off broadcast (Zoko/Klaviyo), not a standing stream. Any segment;
usually a high-recency subset for the early-access touches.

| # | Day | Objective | Spine |
|---|---|---|---|
| 1 | 0 | Announcement + anticipation | Tease, no hard sell yet |
| 2 | 2 | Early access / preview | High-M segments first (`04`, `01`) |
| 3 | 5 | Main promotion | The offer, clear mechanics, strong CTA |
| 4 | 8 | Last chance + scarcity | Real deadline only; no fake countdowns |
| 5 | 10 | Post-promo + next | Thank + point to the next thing |

## Cadence rules

- **Frequency ceiling:** max 3 emails/week; 1–2/week optimal; seasonal peaks may reach
  3–4/week for a short window.
- **Cross-flow cooldown:** honor the engine's `min_days_between_messages` (14) and
  `max_touches_per_customer` (3). A customer in the win-back stream does not also get
  the seasonal blast the same week — dedupe against `state.json`.
- **Empirical refill timing** (post-purchase Email 5) is per-product and computed by the
  engine (Cachos ~139d, Liso ~174d, Mist ~63d, etc.). Reference the engine's number;
  never hard-code a refill day in copy.

## Content mix (across a flow)

- Educational (tips, how-to, ingredient-as-proof): ~30%
- Promotional (offer, product, sale): ~40%
- Relationship (story, behind-the-scenes, community): ~30%

Emotional arc per flow: **Connection → Trust → Value → Action** (welcome/post-purchase)
or **Recognition → Relevance → Urgency → Conversion** (re-engagement/seasonal).

## Success-metric targets (state per email in the output)

| Metric | Welcome | Re-engagement |
|---|---|---|
| Open rate | 25%+ | 15%+ |
| Click rate | 5%+ | 3%+ |
| Conversion | 2%+ | 1%+ |
| Unsubscribe | <0.5% per email | <0.5% per email |

Optimization triggers: low open → test subject/timing/sender; low click →
test content/CTA/offer relevance; high unsub → cut frequency or tighten targeting.
These are directional benchmarks, not guarantees — measure against GE's own baseline
once the engine has send history.

## A/B inside a flow

Every subject + preheader ships as A + B with a stated hypothesis, one variable at a
time (see `abtest` mode). Minimum ~1,000 recipients/variation and 48–72h before calling
a winner; below that sample, ship the higher-conviction variant and note it wasn't a
valid test.
