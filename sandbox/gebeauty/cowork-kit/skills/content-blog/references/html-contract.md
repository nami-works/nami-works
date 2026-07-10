# Shopify HTML output contract (product descriptions)

The description body must paste straight into Shopify's product `descriptionHtml`
with zero cleanup. This is the hard contract.

## Body structure

- **Semantic tags only:** `<h2> <h3> <p> <ul> <ol> <li> <strong> <em> <a>`.
- **Never emit `<h1>`** — Shopify generates it from the product name.
- **Never emit global structure** — no `<!DOCTYPE>`, `<html>`, `<head>`, `<meta>`,
  `<title>`, `<body>`.
- **No inline styles, colors, fonts, or sizes.** No `style=""`.
- **No `<script>`, `<iframe>`, or interactive elements.**
- Correct hierarchy: `<h2>` for the main sections, `<h3>` for subtopics.
- Short paragraphs (2-4 lines). Use lists for steps and pairings.

## Links

- Every product mention is a link to its real PDP URL: `<a href="/products/handle">Texto</a>`.
- No bare product names. No `target`, no `rel`, no tracking params.
- Only link to handles you confirmed exist on the live store (from the reference
  fetch or from the person). If you are unsure a handle is real, do not link it.

## PDP body structure (benefit-led)

Follow the 5 parts, each as an `<h2>` (or a tight flowing version for short PDPs):

1. **O que é** — one-line plain identity, by benefit, not chemistry.
2. **Para que serve** — the concrete benefit / pain it solves.
3. **Como usar** — quantity + sequence + when in the routine.
4. **Combina com** — smart pairings, linking to the real partner products.
5. **Resultado** — what the person notices (sensation, look, durability).

## SEO (separate from the body)

Produce these two alongside the body. They go into the product's `seo` fields in
Shopify (Title and Description, under "Search engine listing"):

- `seo_title`: 45-70 chars. Only the first word capitalized, except brand/product
  names.
- `seo_description`: 140-160 chars, action-oriented, anticipates the value.

## Mechanical rules (enforced)

- **No em dashes (—) or en dashes (–).** Hyphens or commas.
- No invented stats, no miracle claims, no technical ingredient names.
- Benefit-only language throughout.

> Note: GE Beauty PDPs also use a tabbed-description metaobject
> (`custom.descricao_longa_com_abas`). Phase 1 targets the plain `descriptionHtml`
> + `seo` only. The richer tabbed metaobject is a later, confirm-first path.
