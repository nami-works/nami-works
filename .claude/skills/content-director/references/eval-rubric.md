# Content Evaluation Rubric — our quality bar, turned outward

> **What this is.** The scored version of our own quality bar, used to **audit
> third-party content** (today: the Hexagon-generated "Redação GE Beauty" posts) and,
> by the same token, to QA our own output. It is the spec the content-director `audit`
> mode runs. The standards are not invented here — they come from
> [voice.md](voice.md), [geo-playbook.md](geo-playbook.md),
> [brand-sources.md](brand-sources.md), [shopify-html-contract.md](shopify-html-contract.md),
> and the **live catalog** (`scripts/catalog_fetch.py`).
>
> **Built 2026-06-29** to assess content GE did not write to our standards. Concern
> ranked highest by Lucas: **product accuracy** and **brand voice fidelity**.

---

## Operating principles

1. **External ground truth, never the post's own claims.** A post does not get credit
   for *sounding* authoritative. Every product/claim/ingredient is checked against the
   live catalog. (This is the opposite of Hexagon's self-reported "8/10 citation score.")
2. **Gates, not averages.** A single fabrication sinks the post. We do not average a
   hallucinated claim away under good prose. Hard gates → `REJECT` regardless of polish.
3. **Evidence or it didn't happen.** Every finding quotes the offending sentence and
   names the ground-truth it contradicts. No vibe scores.
4. **Adversarial by default.** The judge tries to *refute* quality; on uncertainty it
   fails the item, not passes it. Same posture as the content-director pass-7 gate.
5. **The rubric is OUR forward bar.** Even known-good live posts may trip a house rule
   (e.g., Kelviane uses em-dashes); that is expected and informative, not a rubric bug
   (see Calibration).

---

## The five dimensions

Each dimension lists: what it checks · ground truth · how checked (D = deterministic
scan, J = LLM-judge) · whether it is a **gate** or **graded 0–3**.

### 1. Product accuracy  *(priority · highest trust, mostly deterministic)*
| Check | Ground truth | How | Gate? |
|---|---|---|---|
| Every product named **exists** (exact catalog name) | live catalog | D + J | **GATE** — nonexistent product = REJECT |
| Every PDP link **resolves** to a real product URL | live catalog | D | **GATE** — broken/wrong link = REJECT |
| Every numeric claim matches the **canon** (230°C · 12h · 24h · 72h) or a real spec | brand-sources claim canon | D | **GATE** — invented/contradicting number = REJECT |
| Ingredients named are **real and correctly attributed** to that product | catalog + voice.md §6 map | J | **GATE** if misattributed/invented; graded if merely thin |
| Prices, if stated, are correct | live catalog | D | **GATE** if wrong |
*Failure examples: "Booster Purificante" (does not exist); "protege até 240°C"; chia attributed to the Antioxidante.*

### 2. Brand voice fidelity  *(priority · deterministic markers + judge)*
| Check | Ground truth | How | Gate? |
|---|---|---|---|
| Tone = warm expert-friend ("você"/"a gente"), not generic/luxury-template | voice.md §1–3 | J | graded 0–3 |
| Ingredient-as-proof done right (bound to benefit, not bare list, not benefit-only evasion) | voice.md §6 | J | graded 0–3 |
| Clean-beauty pillar present; archetype-coherent | voice.md §1,4 | J | graded 0–3 |
| No em-dash / en-dash | feedback_no_em_dash | D | **GATE** (house rule) |
| Tagline intact if used ("no seu tempo, do seu jeito.") | voice.md §8 | D | **GATE** if mangled |
| Idiomatic PT, no English calques | feedback_pt_no_english_calques | J | graded 0–3 |
| CTA register fits the archetype (soft default; hard-sell only seasonal) | voice.md §11 | J | graded 0–3 |

### 3. Claim safety / regulatory  *(judge + scan)*
| Check | Ground truth | How | Gate? |
|---|---|---|---|
| No invented statistics ("reduz 40%", "73% das usuárias") | brand-sources | D + J | **GATE** |
| No miracle / cure claims ("transforma", "resolve tudo") | voice.md, brand-sources | J | **GATE** |
| No clinical/therapeutic claims (ANVISA/CDC risk) | regulatory | J | **GATE** |

### 4. GEO / AEO structure  *(graded — the dimension Hexagon is supposedly strong at)*
Answer-first lead · question-shaped headings · "Resposta rápida" atomic unit · FAQ ·
`faq-schema.json` present · internal links with descriptive anchors · entity
consistency · tags populated. Ground truth: geo-playbook + shopify-html-contract. D+J.
**Graded 0–3** (not a gate — weak GEO is a quality miss, not a falsehood).

### 5. Mechanical hygiene  *(deterministic)*
No typos/spelling errors that break entity names · meta description clean (no
`<meta charset>` cruft, 140–160 chars) · heading hierarchy correct (no `<h1>`, H2→H3) ·
no inline styles/scripts. Ground truth: shopify-html-contract. **Graded 0–3**, except a
**typo inside a product/brand name** is escalated (breaks entity consistency).

---

## Scoring → verdict

1. **Run the gates first.** Any hard-gate failure → **`REJECT`** (list every gate hit;
   do not soften with the graded score).
2. **If all gates pass, score the graded dimensions 0–3** (voice, GEO, hygiene; plus any
   non-gated product/safety items):
   - All graded ≥ 2 and no major findings → **`PUBLISH`**
   - Any graded ≤ 1, or accumulated major findings → **`NEEDS-FIX`**
3. **Severity tags** on every finding: `blocker` (a gate) · `major` (graded ≤1 cause) ·
   `minor` (cosmetic).

---

## Per-post scorecard (output format)

```
POST: <title> | <handle> | <draft|published> | <words>
VERDICT: PUBLISH | NEEDS-FIX | REJECT
GATES: product-exists [pass] · links [pass] · claim-canon [FAIL] · ingredient-attr [pass]
       · em-dash [pass] · tagline [n/a] · invented-stat [FAIL] · miracle [pass]
SCORES (0-3): product 2 · voice 1 · claim-safety 0 · geo 3 · hygiene 2
FINDINGS:
  - [blocker · claim-canon] "protege até 240°C" — catalog/canon = 230°C
  - [blocker · invented-stat] "reduz o frizz em 40%" — no such figure exists
  - [major · voice] reads as generic/luxury; no "a gente", no clean-beauty pillar
  - [minor · hygiene] summary carries leftover <meta charset> markup
```

## Batch rollup (the answer to "is their content good?")

- Verdict distribution: N posts → __ PUBLISH / __ NEEDS-FIX / __ REJECT.
- **Gate-failure frequency** (the headline): e.g. "18/131 invent a claim number",
  "6 name a nonexistent product", "9 make a miracle claim".
- Per-dimension average + the worst offenders (linkable).
- Top systemic patterns → the evidence behind the confidence call.

---

## The two-layer mechanism

- **Layer 1 — deterministic scan** (every post, ~free, 100% reproducible): em-dash,
  banned words, tagline, claim-number canon, link resolution, product-name match against
  catalog, HTML hygiene, empty tags, meta cruft. Reuses `catalog_fetch.py` + the article
  fetcher (Admin GraphQL `articles`, filtered by author).
- **Layer 2 — adversarial LLM-judge** (the subjective dimensions): fed the catalog facts
  + voice.md + this rubric, prompted to refute, citing evidence per finding. This is the
  pass-7 gate pointed at someone else's content.

## Run modes

- **Backlog sweep:** all `author = "Redação GE Beauty"` posts → scorecards + rollup.
  These are still **drafts**, so this is a **pre-publication gate** — we catch everything
  before it is ever public.
- **Forward gate:** periodic pass detecting new Redação posts since the last run; evaluate
  before they leave draft.

## Calibration (do this before trusting verdicts on Hexagon)

1. Run on **Kelviane's 55 posts** (known-good voice): the **judged voice dimensions**
   should score high. If they don't, tune the voice rubric, not the posts. *(Note: the
   mechanical em-dash gate will flag Kelviane — expected; that gate is our forward house
   rule, which the live blog predates. Calibrate judgment, not house rules.)*
2. Run on a **content-director-generated post** once one exists: expect a clean PUBLISH.
3. Only after the rubric agrees with our established quality bar do we act on the Hexagon
   verdicts.
