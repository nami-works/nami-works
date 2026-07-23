# Session Handover — 2026-06-10

> **⚠️ Outdated data source (updated 2026-07-23).** This handover references
> `gebeauty/data/reviews.csv` as the review source. That CSV was a 4–5★-only export
> (it hid every negative review) and has been **deleted**. Reviews now come LIVE from the
> Loox API — use `gebeauty/scripts/loox_reviews.py` (full 1–5★ corpus). See the
> `gebeauty-loox-reviews` memory. The vocabulary findings below still stand; only the
> source path changed. To re-run the mining, pull from the API instead of the CSV.

## What was done

### Consumer vocabulary research
- Ran two parallel research agents:
  - **Web agent** — swept Beleza na Web, Amazon.com.br, r/cabelos, Cacheia!, Acorda Bonita, Reclame Aqui, independent BR beauty blogs. Collected broader market vocabulary.
  - **Reviews agent** — mined GE Beauty's own 1,589 verified Loox reviews from `gebeauty/data/reviews.csv`. Extracted vocabulary by category and frequency.
- Combined outputs into a single structured dictionary covering: problems, desired effects, sensory descriptors, performance language, emotional/identity language, and community slang.

### Reviews CSV
- File moved from Downloads → `gebeauty/data/reviews.csv`
- 2,144 rows total; 1,589 with meaningful text content
- Columns: id, status, rating, email, img, nickname, full_name, **review**, date, productId, **handle**, variant, verified_purchase, orderId, reply, replied_at, metaobject_handle, incentivized
- All 5-star dominated — negative signals appear as caveats inside positive reviews, not as standalone 1–3 star entries

### Claim translations
- 8 original brand claims translated into consumer voice, 3 variations each. See Google Doc (link below) Part 2.

### Google Doc published
- Full dictionary + claim translations + copy insights published to Lucas's Google Drive at:
  `https://docs.google.com/document/d/1e6uC2y41nJ9idapTcyomAXLlBWvP77eWWYwJsH39gK8/edit`
- Owner: lucas@gebeauty.com.br
- Already shareable — Lucas just needs to set permissions via the Share button

---

## Key decisions

- **Reviews over brand outbound** — Lucas explicitly wanted more weight on customer reviews and web vs. brand ad language. The dictionary reflects this: all terms are grounded in organic consumer voice.
- **"Curvatura dos fios" eliminated** — This phrase does not appear in any customer review. It's internal brand language. Any claim using it should be rewritten to "cachos", "textura", or "forma".
- **"Por até 24h" → "do banho ao day after"** — Same factual claim, human frame. Applied to all longevity variations.
- **"Definem sem pesar" is consumer-generated copy** — This exact phrase appeared independently in multiple reviews. It is not a brand invention. It should be owned.
- **Fragrance is the #1 spontaneous mention** — More reviews mention the scent than any functional performance claim. This was a discovery, not an assumption. It changes copy hierarchy.

---

## What's pending

### Immediate
- **Local markdown file** — The dictionary exists only in the Google Doc. A local copy at `gebeauty/data/vocabulary-dictionary.md` was proposed but not created. Worth doing for repo-native access.
- **Claude prompt template** — Lucas approved building a self-serve prompt template so any team member can paste a brand claim and get 3 consumer-voice variations. Not built yet. This is the highest-leverage next step.

### Future
- **Periodic refresh** — Monthly agent pass to re-mine new reviews from Shopify API and append new terms. Proposed but deferred until the team is actively using the dictionary.
- **Expand to negative reviews** — The CSV only contains GE Beauty reviews (mostly 4–5 stars). Reclame Aqui and competitor 1–3 star reviews would add richer problem vocabulary. Partial coverage from the web agent but not systematic.

---

## Modified files

| File | Status | Notes |
|---|---|---|
| `gebeauty/data/reviews.csv` | Complete | Moved from Downloads; source of truth for all review-based vocabulary |
| Google Doc (Drive) | Complete | Shareable; Lucas needs to set link permissions |
| `gebeauty/data/vocabulary-dictionary.md` | Not created | Proposed, not built |

---

## Current state

- No code was changed. This session was pure research + content.
- `git diff` shows only `.mcp.json` modified (pre-existing, unrelated to this session).
- Google Doc is live and fully populated with all 3 parts (dictionary, translations, insights).
- `reviews.csv` is in the repo at `gebeauty/data/reviews.csv` — not committed yet.

---

## Recommended next steps

1. **Build the Claude prompt template** — A system prompt that includes the full vocabulary dictionary and translates any brand claim into 3 consumer-voice variations. File: `gebeauty/data/copy-translator-prompt.md`. This is the daily-use interface for the team.
2. **Save local markdown of the dictionary** — `gebeauty/data/vocabulary-dictionary.md` as a repo-native version of the Google Doc.
3. **Commit reviews.csv + new data/ files** — `git add gebeauty/data/ && git commit -m "feat(gebeauty): add customer reviews + vocabulary research"`
4. **(Optional) Expand negative vocabulary** — Run a focused agent pass on Reclame Aqui for GE Beauty competitors (Salon Line, Lola, L'Oréal) to get more 1–3 star problem language.

---

## Context the next session needs

### The dictionary in brief (key terms only)

**Top problem terms (by frequency in reviews):**
- `frizz` (50+), `macio/maciez` (50+ desired), `não pesa` (40+), `leve/levinho` (40+), `definição` (40+), `ressecado` (25+), `fica oleoso` (20+), `queda` (20+), `day after` (integrated loanword)

**Consumer-generated phrases ready to be copy:**
- "definem sem pesar" — appeared independently in multiple reviews
- "blinda os fios" — adopted verbatim from brand language, used as organic proof
- "do banho ao day after" — consumer frame for 24h claims
- "cachos com mais dignidade" — longevity as dignity, not vanity
- "desmaia o cabelo de tão hidratado" — hyperbole for mascara conditioning
- "cheiro de riqueza / cheiro de rica" — aspirational social signal encoded in fragrance

**Terms to eliminate from brand copy:**
- "curvatura dos fios" → use "cachos", "textura", "forma"
- "por até 24h" → use "do banho ao day after"
- Any "hold" language → use "maleável", "não deixa durinho", "com balanço"

**Negative signal to watch:**
- "pouca espuma" — 8+ shampoo complaints; consumers equate foam with cleanliness
- "fica duro" — gel rigidity; consumers explicitly escape this; "maleável" is the antonym

### Data files
- Reviews source: `gebeauty/data/reviews.csv` (2,144 rows, Loox export)
- Product with most reviews: `leave-in-com-protecao-termica-ge-beauty-150ml` (223 reviews)
- Google Doc: `https://docs.google.com/document/d/1e6uC2y41nJ9idapTcyomAXLlBWvP77eWWYwJsH39gK8/edit`

### What the prompt template should do
When built, the template should:
1. Receive a brand claim as input
2. Use the full dictionary as context
3. Output 3 variations per claim, each with a distinct angle (rational / sensory / emotional)
4. Avoid: "curvatura dos fios", "por até Xh", any hold/fixação language
5. Prefer: "day after", "definem sem pesar", "maleável", "cheirinho", consumer idioms
