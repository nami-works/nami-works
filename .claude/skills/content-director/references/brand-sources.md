# Where brand truth lives (read these, do not reinvent)

`/content-director` never invents brand voice, products, or claims. It grounds
every run in the canonical sources below. For GE Beauty (tenant #1):

| Source | Path | What it gives you |
|---|---|---|
| **Brand voice (canonical, GEO-ready)** | `references/voice.md` | **Primary.** Corpus-grounded tom de voz, 4 archetypes, lexicon, ingredient-as-proof rule, GEO-first post structure, claim canon. Read this FIRST. |
| **GEO method** | `references/geo-playbook.md` | How to get cited by AI engines: answer-shape-first planning, atomic extraction units, format-by-citability, entity-attribution, schema-ship requirement + roadmap. |
| **Multi-format voice + CTAs** | `references/formats.md` | The voice applied to non-blog formats (ad / email / SMS / IG / banner / packaging / quiz / chatbot) + CTA-by-intention library. Migrated from the retired voice-core. |
| Workspace playbook | `gebeauty/CLAUDE.md` | Product rules, hard rules, store domain, scopes, metaobject map |
| Live catalog | `scripts/catalog_fetch.py` (runtime) | Exact product names, URLs, prices, SEO state — the anti-hallucination spine |
| Curated catalog | `gebeauty/products.json` | 17 SKUs, B2B source of truth (assinatura excluded) |
| Live style corpus | Admin GraphQL `articles` (author "Kelviane Lima") | 55 live posts = the real few-shot exemplars `references/voice.md` was distilled from |
| Brand grammar | `gebeauty/video-director/docs/ip.md` | Tagline lock, palette, banned nouns (sibling skill's constitution) |
| Memory | `~/.claude/projects/.../memory/` | `project_gebeauty_voice_registry`, `feedback_no_em_dash`, `feedback_pt_no_english_calques`, `project_gebeauty_*` |
| Legacy docs (retired) | `.streamlit/apps/gebeauty/_archive/` | 5 pre-corpus docs (voice, voice-core, format_recommendations, editorials, products) archived 2026-06-29. Fully superseded by `references/`; kept locally for history only. |

For a future tenant, swap the tenant folder and brand-voice doc; the pipeline is
brand-agnostic.

## Locked mechanical rules (non-negotiable)

1. **No em dashes (—) / en dashes (–)** in any customer-facing copy. Hyphens or
   commas. (`feedback_no_em_dash`; also enforced by `publish.py`.)
2. **Ingredient-as-proof (updated 2026-06-29, Lucas's call).** Name an active ONLY
   when bound to the benefit it delivers ("biotina, que fortalece a fibra"), never
   as a bare ingredient list. This REPLACES the old "benefit-only, never name
   ingredients" rule — the live corpus uses ingredient-as-proof in 29/55 posts and
   it is the strongest AI-citation signal. See `references/voice.md` §6.
3. **Idiomatic Portuguese, not English calques** when `content_language=pt_BR`.
   (`feedback_pt_no_english_calques`.)
4. **Tagline lock:** "no seu tempo, do seu jeito." Use it as the brand signature,
   never reword it.
5. **No miracle claims, no invented numbers.** Use real claims only. Claim canon
   for entity consistency (GEO): thermal protection = **230°C** (corpus has stray
   232/240 = errors), Booster Definição = 12h, Primers = 24h, Melon Mood skin = 72h.
6. **Soft CTAs by default** (editorial register). Hard-sell CTAs ("corra no site")
   are reserved for the seasonal/gift archetype — see `references/voice.md` §11.
7. **Only real products.** `Booster Purificante` does NOT exist. `lancto`-tagged
   launches (Máscara Mayday, Melon Mood) are excluded from campaign-discount copy.

## Voice in one line

Expert-friend PT-BR: 2nd-person scene that already answers → why it happens
(mechanism) → ingredient-as-proof → what to expect → soft CTA. Default to the
editorial/GEO register (`references/voice.md` §7); switch archetypes (§11) only when
the brief asks. Personalize by hair type / goal / climate / available time.
