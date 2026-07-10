# Guru ← Shopify readiness audit (2026-07-07)

> **Question:** if Zoko/Guru reads Shopify product data, what would it actually find today?
> **Method:** read-only Admin API sweep of the 30 active products (`productType` product /
> acessorio). Script: `scratchpad/guru_shopify_audit.py`. Measures the product description
> body (the field a catalog integration is most likely to read) vs. content locked in
> metafields/metaobjects (which a plain read usually misses).

## Headline

**"Let Guru read Shopify" is the right architecture, but Shopify is not bot-ready today.**
The bot-readable field (the description `body_html`) is nearly empty of the things
customers ask. The substance lives in metafields and metaobjects that a standard catalog
integration typically does **not** resolve.

## What the description body contains (what a catalog read most likely sees)

| Signal | Coverage | Read |
|---|---|---|
| How-to / modo de uso in body | **1 / 30** | A bot reading only the body cannot answer "como uso?" |
| Claim number (230°C / 12h / 24h / 72h) in body | **5 / 30** | Claims are absent from most bodies |
| Description length | ~25–70 words | Marketing hook, not an answer source |

## Where the real content lives (metafields / metaobjects)

| Metafield | Products | Holds |
|---|---|---|
| `custom.caracteristicas` (rich text) | 22 | Benefit/feature copy |
| `custom.finalidade` | 22 | What the product is for |
| `custom.descricao_longa_com_abas` (metaobject ref) | 21 | Long description w/ tabs |
| `custom.dosagem` | 20 | How much to use |
| `custom.faq` (metaobject ref) | 17 | **GE's own product FAQ** |
| `custom.tipo_de_cabelo` | 4 | Hair-type match (sparse) |
| `custom.necessidade` | 4 | Need/pain match (sparse) |
| `custom.como_usar` (direct key) | 0 | How-to only inside the tabs metaobject |

## Implications for the pivot

1. **Delegating product answers to Shopify only works if one of these is true:**
   - (a) Guru's Shopify read resolves **metafields + metaobject references** (unlikely for
     a stock catalog sync — verify with Zoko), or
   - (b) we **enrich the description `body_html`** with the essentials (finalidade, how-to,
     canonical claim) so the field Guru *does* read carries the answer. A /content-director
     PDP task, one source, benefits storefront + quiz + Guru at once.
2. **Recommendation matching can't lean on structured fields** — `tipo_de_cabelo` /
   `necessidade` exist on only 4 products. The quiz-brain reasoning doc stays the
   recommendation source regardless; Shopify won't drive it via metafield filtering today.
3. **`custom.faq` (17 products) is a strong asset** — GE's own product FAQ — but it's in a
   metaobject. If Guru can't read metaobjects, this content is invisible to it.

## Recommendation

- **Verify the read scope with Zoko** (fields: body only? metafields? metaobjects? policies?).
- **If body-only:** run a /content-director pass to lift the essentials
  (finalidade + canonical claim + one-line how-to) into each product body, claim-consistent.
  Until then, keep a lean product Q&A in Guru rather than assume Shopify covers it.
- **Do not** rebuild a full per-SKU KB in Zoko — enrich the canonical source instead.
