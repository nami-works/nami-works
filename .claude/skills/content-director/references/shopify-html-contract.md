# Shopify HTML output contract

Both modes of `/content-director` emit HTML that pastes straight into Shopify
with **zero manual cleanup**. This is the hard contract. Ported and tightened
from the SEO Lab `format_recommendations/shopify.md`.

## Structure (blog body AND PDP body)

- **Semantic tags only:** `<h2> <h3> <p> <ul> <ol> <li> <strong> <em> <a>`.
- **Never emit `<h1>`** — Shopify generates it from the post Title / product name.
- **Never emit global structure** — no `<!DOCTYPE>`, `<html>`, `<head>`, `<meta>`, `<title>`, `<body>`.
- **No inline styles, colors, fonts, sizes.** No `style=""`.
- **No `<script>`, `<iframe>`, or interactive elements.**
- Correct hierarchy: `<h2>` for main sections, `<h3>` for subtopics.
- Short paragraphs (2-4 lines). Lists for steps and pitfalls.

## Links

- Internal links only to URLs that came back from `catalog_fetch.py` (products,
  collections) or verified blog URLs. Format: `<a href="/products/handle">Texto</a>`.
- Clean anchors only — no `target`, no `rel`, no tracking params.
- **Every product mention is a link to its real PDP URL.** No bare product names.

## Blog-only enrichments

- **"Resposta rápida" block near the top** — the atomic extraction unit: question in
  `<strong>`, a 40-60 word direct answer, then "o que usar" naming the real product.
  Independently quotable (see geo-playbook.md §2).
- Reading-time line near the top: `<p><em>⏱️ Tempo de leitura: 5 minutos</em></p>`.
- `<h2>` FAQ section (featured-snippet + AEO bait), `<h3>` per question.
- Table of contents for long posts (anchor links to in-page sections).
- Soft CTA at the end (invite, never pressure).

## AEO structure (get cited by AI engines)

> Method + strategy: [geo-playbook.md](geo-playbook.md). This section is the structural
> contract; the playbook is how to think about answer-shape, atomic units, and attribution.

- **Question-shaped headings.** H2/H3 phrased as the user's question.
- **Answer-first.** First 40-60 words under each heading directly answer it, then
  elaborate. Primary keyword in the first 100 words of the post.
- **Semantic chunks.** 200-400 words per section, one concept, independently citable.
- **Real-claim citations only.** Cite an authoritative source for technical/scientific
  claims; use GE's real product claims (°C, hours). Never invent a number.
- **Entity consistency.** Official brand/product names (from the live catalog), terms
  defined on first use.

## Schema artifact (not inline)

Emit FAQ/Article/Breadcrumb structured data as a separate `*_faq-schema.json`
(JSON-LD), NOT as an inline `<script>` in the body — the body contract forbids
`<script>` and Shopify can strip it. The artifact **must be injected at the
theme/template level to have any effect** — generating it without shipping it does
nothing. That injection is the #1 roadmap item in geo-playbook.md §7 (a brand-surface
chore = Lucas's call); until it ships, still emit the artifact so it's ready. FAQPage
schema is the highest-impact AEO markup; Article (BlogPosting) and BreadcrumbList support it.

## Metafields (blog)

Emitted as a separate `metafields.md` consumed by `publish.py`:

```
meta_title: <45-70 chars, contains the primary keyword, max ~6 words, brand name only if it adds value>
meta_description: <140-160 chars, MANDATORY range, action-oriented, anticipates value>
summary_html: <150-160 chars Resumo HTML / Excerpt, unique (not the title), keyword-aware, may use <strong>/<em>>
related_products: <comma-separated product handles exactly as they appear in the live catalog>
related_collections: <up to 4 comma-separated collection handles, in display order>
```

`publish.py` wires these into the article's OWN metafields so the theme renders them:
`related_products` -> `custom.produto` (list.product_reference); `related_collections`
-> `custom.colecao_relacionada_1..4` (collection_reference, in order). Handles are
resolved to GIDs at publish time and validated in the dry run (unresolved handles are
flagged, never silently dropped). Always populate `related_products` (the legacy system
did; the rebuild had regressed and didn't).

Capitalization in titles: only the first word of each sentence is capitalized,
except brand/product names.

## PDP body structure (benefit-led)

A "killer" product description follows the brand's product approach (see
`brand-sources.md` §"Abordagem de Produto"):

1. **O que é** — one-line plain identity (by benefit, not chemistry).
2. **Para que serve** — the concrete benefit / pain it solves.
3. **Como usar** — quantity + sequence + when in the routine.
4. **Combina com** — smart pairings (link to the real partner products).
5. **Resultado** — what the person notices (sensation, look, durability).

PDP SEO goes to the product's `seo { title, description }` (not metafields):
- `seo_title`: 45-70 chars.
- `seo_description`: 140-160 chars.

Note: GE Beauty PDPs also use a tabbed-description **metaobject**
(`custom.descricao_longa_com_abas` -> `descricao_longa`). v1 targets
`descriptionHtml` + `seo`. Writing the tabbed metaobject is a richer path to
confirm with Lucas before doing (brand surface = his call).

## Final mechanical rules (enforced by the QA gate + publish.py sanitizer)

- **No em dashes (—) or en dashes (–).** Use hyphens or commas. These are AI
  tells and a standing brand rule.
- No invented stats, no miracle claims.
- Keywords the writer inserted as `***keyword***` (bold+italic) must survive
  refinement and review unchanged.
