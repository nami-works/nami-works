# GEO Playbook — engineer the answer, then ground and verify it

> **What this is.** The canonical **method/strategy** layer for getting GE Beauty
> content cited by AI engines (AI Overviews, ChatGPT, Perplexity, Claude). It is the
> *how to think* doc. The *where things go in a post* specifics live in
> [shopify-html-contract.md](shopify-html-contract.md) and
> [voice.md](voice.md) §7/§9; the *voice* lives in voice.md. This doc points at
> those rather than duplicating them.
>
> **Origin.** Distilled 2026-06-29 from analyzing a competing blog-generation
> platform's method (Hexagon "Blog Studio"). We took its *form* theories and kept
> our *grounding + truth + voice* discipline, which is the axis where our process is
> the stronger one. See **Keep / Reject** below.

---

## 0. The organizing principle

**Write the answer an AI model would assemble — then ground it and verify it.**

The default posture of classic SEO is "write an article that ranks." The GEO posture
is to **reverse-engineer the post from the machine's answer-construction**: decide what
question the model is answering, give it the pre-built, attributable answer, and make
every unit independently liftable. We then layer our non-negotiables on top: it must be
catalog-grounded, claim-true, and in GE's real voice. Form from the machine, substance
from the brand.

---

## 1. Answer-shape-first planning (do this in pass 4, before structure)

Classify the target query by the **reasoning shape** the model uses to answer it, then
build the whole post as that answer template:

| Query shape | Model wants | Post template |
|---|---|---|
| **Por que… / Why** | root cause | phenomenon → mechanism → consequence → what to do |
| **Como… / How** | ordered procedure | goal → numbered steps (qty + order) → what to expect |
| **Qual a diferença… / X vs Y** | comparison | define each → side-by-side table → "qual escolher" |
| **Quando… / When** | decision rule | situation → decision framework / "se… então…" → recommendation |

Pull the actual queries from pass-3 research (GSC questions, autocomplete, SERP "People
also ask"). One dominant shape per post; name it in the plan. Question-shaped H2/H3s
(already in the contract) should mirror the chosen shape.

---

## 2. The atomic extraction unit (the single highest-leverage format)

Models lift **self-contained, declarative, attributable** units. Lead every post, and
ideally every section, with one.

- **Top-of-post "Resposta rápida" block** (the TL;DR): the question in bold, a direct
  40–60 word answer, then "o que usar" naming the real GE product. Independently
  quotable with zero surrounding context.
- **Per-section answer-first lead** (already in the contract): first 40–60 words answer
  the heading, then elaborate.
- **Declarative, not interrogative, in the body.** Headings may be questions; the
  sentences that answer them must be statements a model can quote verbatim
  ("O calor acima de 230°C degrada a queratina" — anchored to our real claim canon).

Example:
```
## Resposta rápida
Quanto tempo o calor leva para enfraquecer o fio? O dano térmico começa já na
primeira passada acima da temperatura segura do fio; o uso recorrente sem proteção
acelera a perda de massa e brilho. O que usar: o Leave-in com Proteção Térmica
GE Beauty protege até 230°C, aplicado no cabelo úmido antes do secador.
```

---

## 3. Format-by-citability (choose format by liftability, not just topic)

Some shapes are inherently more citable. Prefer, when the topic allows:

- **Comparison / decision tables** — but **GE-internal only** (product-vs-product,
  use-case-vs-routine, "qual booster para qual necessidade"). **Never named-competitor
  tables** (off-voice, legal risk). A neutral category row ("creme de pentear comum vs
  primer") is fine; "GE vs Marca X" is not.
- **Step-by-step** numbered guides (qty + order + "por que funciona").
- **Decision frameworks** ("se o seu fio é… então…").
- **Myth → evidence → truth** ("desmistificando").

Low-citability shapes (avoid as the *primary* structure): pure product praise,
lifestyle narrative, testimonial-only, promo copy.

---

## 4. Engineered entity-attribution (make the citation carry GE)

A citable claim must bind a fact to a **named GE entity + a real anchor**, so when a
model quotes it, the attribution travels with it:

- Bind the claim to the **exact product name** (from the live catalog) **+ its PDP URL**.
- Anchor the number to our **claim canon** (230°C / 12h / 24h / 72h) or a genuinely
  sourced fact — **never an invented stat** (see Reject).
- Prefer "O Primer Liso Intacto GE Beauty blinda o fio da umidade por 24h" over a
  source-less "esse produto controla o frizz." The first is attributable; the second
  is not.

---

## 5. Machine-semantics layer (schema) — and it MUST ship

Schema (`faq-schema.json`: FAQPage + Article/BlogPosting + BreadcrumbList) tells the
machine *what the page is* and how to attribute it. **We already generate it — the gap
is that it is never injected** (the contract flags it as a "theme-level follow-up").
Generated-but-not-injected schema does nothing. Closing this is the #1 roadmap item
(§7). Until injection ships, still emit the artifact so it's ready.

---

## 6. Keep / Reject (the axis where our method is stronger)

**Keep (our discipline — do NOT regress to the competing method's shortcuts):**
- **Live-catalog grounding** over a static catalog snapshot (anti-hallucination by
  construction).
- **Corpus-derived voice** ([voice.md](voice.md), from 55 real posts) over a
  3-adjective voice descriptor.
- **The adversarial verification gate** (pass 7) between generation and output — form
  *and* fact checked.
- **Drop old-SEO ritual.** No keyword-density targets, no "keyword every 300 words,"
  no Flesch target. Optimize semantic completeness + extractability. LLM citation does
  not reward keyword density.

**Reject (form is fine, substance is not):**
- **Invented statistics / clinical claims** ("reduz o dano em 40%", "73% das
  usuárias"). Violates the no-invented-numbers rule and is an ANVISA/CDC hazard.
- **Named-competitor comparison tables.**
- **Self-scored "citation score."** A generator cannot grade its own liftability;
  that signal is external only (§7 measurement).

---

## 7. Roadmap (architecture not yet built — own chores, not doc edits)

These realize the method but touch the engine/theme/measurement, so they are scoped
work, not part of this doc:

1. **Ship schema to the live theme.** Inject the generated JSON-LD at the
   theme/template level (integrations/design chore; brand-surface = Lucas's call).
   Highest priority — it's the difference between generating schema and using it.
2. **Structured-content-model generation.** Emit one typed content object (sections as
   data: lead, section, product_card, faq, comparison) and **render the HTML + derive
   the schema + build the publish payload from that single object**, so body and schema
   cannot drift. Adopts the competing method's cleanest structural idea and closes the
   schema gap at the source.
3. **External citation-measurement loop.** Periodically probe live engines
   (AI Overviews / ChatGPT / Perplexity / Claude) with our target question-headings and
   record whether GE is cited, against **live URLs only**. Without it, "GEO-ready" is
   unfalsifiable. Pairs with GSC (search) which we already have.

---

## 8. Where this plugs into the pipeline

- **Pass 3 (opportunity mapping):** capture the real questions + classify each by shape (§1).
- **Pass 4 (planning):** pick the dominant answer-shape; choose the citable format (§3).
- **Pass 5 (writing):** lead with the atomic unit (§2); bind claims to entities (§4);
  follow [shopify-html-contract.md](shopify-html-contract.md) for structure.
- **Pass 7 (QA gate):** verify every claim/number is real (Keep §6) — citability never
  overrides truth.
- **Pass 9 (metafields + schema):** emit `faq-schema.json` (ready for the §7.1 injection).
