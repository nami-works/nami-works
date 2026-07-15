# Build guide — "Qual Body & Hair Mist é a sua?" quiz (Octane AI CORE-1)

> A step-by-step to stand up the mist-recommendation quiz on Octane AI, grounded in the
> client briefing deck (`Briefing_Moodboard.pptx`). Engine: **AI Quiz (CORE-1)**, same as the
> hair quiz. Outcome: recommends **1 of 4 mists** (Melon Mood, Santal Skin, Rose Ritual,
> Pear Fresh) from a 6-question personality quiz, plus a layering partner.
>
> Everything you paste is in `octane-paste/`. The routing logic is in `mapping.md`.
>
> **>> For the teammate who finishes the setup, use `HANDOFF.md`** — it's the self-contained,
> paste-everything-inline version built around DUPLICATING the live quiz to reuse its layout.
> This file is the design rationale + technical reference behind it.
>
> **Two parts:** Part A is a one-time technical prerequisite (grounding the mists in Shopify).
> Part B is the Octane build the content team does by pasting the chunks.
>
> **STATUS 2026-07-15:** Part A is DONE (live) — the 4 mist `ai_readiness` metaobjects are
> created, ACTIVE, linked, and verified against official PDP copy. A teammate only does Part B.

---

## Part A — Prerequisite: ground the mists in AI Readiness (run once)

CORE-1 reasons over `custom.ai_readiness` metaobjects. Today only Melon Mood has one (under a
stale `...-splash` handle); Santal Skin, Rose Ritual, and Pear Fresh have none. Without this,
the AI cannot describe or recommend 3 of the 4 mists. Content lives in `ai-readiness-mists.json`.

> Live-store writes. Run `--dry-run` first, review, then run for real. Needs `gebeauty/.env`
> and `C:/Python314/python.exe`. This is a dev step, not a content-team step.

```bash
# from c:\claude\gebeauty
# 1. Preview what will be created (no writes)
C:/Python314/python.exe scripts/inject_ai_readiness.py --file quiz/mist-quiz/ai-readiness-mists.json --dry-run
# 2. Create the metaobjects
C:/Python314/python.exe scripts/inject_ai_readiness.py --file quiz/mist-quiz/ai-readiness-mists.json
# 3. Link each metaobject to its product (mist handles already added to the linker's map)
C:/Python314/python.exe scripts/link_ai_readiness.py --dry-run
C:/Python314/python.exe scripts/link_ai_readiness.py
```

After this, all four mists carry `custom.ai_readiness`. (The old Melon `...-splash` entry can
stay; the new `...-mist` entry supersedes it and is what the mapping references.)

---

## Part B — Build the quiz in Octane

Octane account: `abyasnknwj7yxqbu` (same as the hair quiz). Editor path throughout:
`Quiz Editor → Build tab → [page/block] → right panel config`.

### Step 1 — Create the quiz
- Octane dashboard → **Create quiz → AI Quiz (CORE-1)**.
- Name it `mist_YY.MM.DD_qual-bruma` (mirror the hair quiz naming).
- Connect it to the GE Beauty Shopify store (should already be connected at the account level).

### Step 2 — Add the 6 question pages
Open `octane-paste/questions.md`. For each of the 6 pages: **Build → add Question page (single
select)**, paste the title, add the 4 options in the exact order given, and set the page's
**variable ref** to the value listed (`estacao`, `momento`, `destino`, `situacao`, `palavra`,
`aroma`).

> Keep the answer order identical on every page (option 1 → Melon, 2 → Santal, 3 → Rose,
> 4 → Pear). The AI aggregation relies on that consistency. The QA answer-key table at the
> bottom of `questions.md` is your check.

### Step 3 — Add the opt-in + loading pages
Mirror the hair quiz: an **Opt-in (Email/SMS)** page, a **Telefone** page, and a
**Cálculo de resultados** Explainer screen before results. Loading copy is in `results-copy.md`.

### Step 4 — Create the Smart Property `bruma-resultado`
- **Smart Properties tab → New Smart Property**, name it so the variable is `{{bruma-resultado}}`.
- Paste `octane-paste/smart-property_bruma-resultado.txt` into the **Instruction** field.
- Set the **Fallback** to the fallback line at the bottom of that file.

### Step 5 — Build the Results page
Follow the block order in `octane-paste/results-copy.md`:
1. **Title** (Text) — paste block 1.
2. **Resultado** — an HTML block that renders `{{bruma-resultado}}`.
3. **Sua bruma** (Text header) — paste block 3.
4. **Smart Products** — paste `octane-paste/smart-products_bruma.txt` into "Instructions for AI".
   Constrain the block's product pool to the mist collection if available.
5. **Layering** header + subtitle (Text) — blocks 5, 6.
6. **CTA** header + Add-to-Cart button — blocks 7, 8.
7. **Cross-sell** header + subtitle (Text) — blocks 9, 10.

### Step 6 — Design
Reuse the hair quiz look: font **Italian Plate**, background **#ECDED9**, red/dark buttons.
(Optional: tint each result's accent to the mist's frasco color — Melon creme, Santal laranja,
Rose rosa, Pear verde — per `mapping.md`.)

### Step 7 — QA before publishing (mandatory)
Run all 4 "pure" paths in Octane **Preview** — pick the same column on all 6 questions and
confirm the matching mist is recommended:

| All answers in column | Must recommend |
|---|---|
| 1 (verão / almoço / Grécia / praia / viva / melão) | **Melon Mood** |
| 2 (outono / jantar / NY / drinks / marcante / sândalo) | **Santal Skin** |
| 3 (inverno / brunch / Paris / arte / delicada / rosas) | **Rose Ritual** |
| 4 (primavera / café / Indonésia / picnic / vibrante / pêra) | **Pear Fresh** |

Then run 2-3 mixed paths and confirm the tie-break (aroma > palavra > estação) resolves sanely
and the layering partner is always one of the official pairs. Confirm no product outside the
4 mists is ever recommended.

### Step 8 — Publish + embed
The hair quiz is embedded two ways (see memory `project_gebeauty_quiz.md`):
- **Modal** — quiz id hardcoded in `snippets/quiz-modal.liquid` (`data-quiz-id`).
- **Standalone page** — bound to a page metafield `custom.octane_quiz_id`.

Decide with Lucas whether the mist quiz gets its own trigger/page or replaces an existing one.
Theme wiring is a `gebeauty/theme` change (read `docs/gebeauty-theme-customization.md`), not an
Octane step. Do not swap the live hair quiz without explicit sign-off.

---

## Reusing this for future quizzes
The pattern is repeatable: (1) build a `mapping.md` routing table from the source brief,
(2) write `ai-readiness-<line>.json` and inject with `--file`, (3) write the paste chunks
(questions + Smart Property/Products instructions + results copy), (4) build in Octane, QA the
pure paths, publish. Copy this folder as the template.

## Files in this folder
| File | What it is |
|---|---|
| `mapping.md` | Profiles × scents routing table (source of truth, from the deck) |
| `ai-readiness-mists.json` | The 4 mist AI Readiness entries (Part A injection input) |
| `octane-paste/questions.md` | 6 question pages + answer key |
| `octane-paste/smart-property_bruma-resultado.txt` | AI instruction for the result reveal |
| `octane-paste/smart-products_bruma.txt` | AI instruction for the product recommendation |
| `octane-paste/results-copy.md` | Static results-page copy + loading + meta |
