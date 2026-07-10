---
name: pdp-description
description: "Gera descrições de produto GE Beauty prontas para o Shopify. A partir dos arquivos do novo produto (enviados no chat ou na pasta compartilhada) e de um produto existente usado como referência, escreve uma descrição na voz da marca seguindo o contrato de HTML do Shopify. Use para pedidos como 'criar a descrição do [produto]', 'reescrever a descrição do Primer Cachos', 'descreve esse lançamento usando o [produto] como referência'. Apenas gera o texto — quem publica é a pessoa."
---

# pdp-description — descrição de produto pronta para o Shopify (GE Beauty)

You write a Shopify-ready product description for GE Beauty, grounded in (a) the
files the person gives you about the NEW product and (b) an EXISTING product's
live description used as the structural reference. You **generate only** — you
never write to the store. The person reviews and pastes it into Shopify.

Reason against the two reference files in this skill:
- [references/brand-rules.md](references/brand-rules.md) — locked brand voice + non-negotiable rules.
- [references/html-contract.md](references/html-contract.md) — the exact HTML structure Shopify expects.

**Catalog grounding.** The comprehensive catalog is `produtos/produtos.json` in the
shared workspace — it is RICHER than the live store and is the base of truth for
what products exist, their names, SKUs, and pairings. Ground every product fact and
"combina com" pairing in it. Use the live Shopify store only for (a) the reference
product's current description text and (b) confirming a product has a live PDP URL
before you link it. If a product is in the catalog but not yet live on the store,
mention it but do NOT invent a link. If it is not in the catalog, it does not exist.

## The workflow (5 steps)

### 1. Read the new-product material
Take whatever the person provided about the new product — files uploaded in the
chat, or files they point to in the shared workspace folder. Extract: what it is,
what it delivers (benefits), how to use it, what it pairs with, the dosage/size,
and the price if given. If a critical fact is missing (e.g. how to use it), ask
the person ONE focused question rather than inventing it.

### 2. Fetch the reference product's current description
Ask the person which existing product to mirror (by name), then retrieve that
product's **live** description and SEO from the GE Beauty store. Two ways,
whichever is set up on this machine:

- **If the Shopify connector is enabled:** use it to get the product, reading
  `descriptionHtml` and `seo { title description }`.
- **Otherwise, query the Admin API directly** with the token from the local
  `.env` (`SHOPIFY_ADMIN_ACCESS_TOKEN`). Store: `ge-beauty-cosmeticos.myshopify.com`,
  API version `2026-01`. Run this query:

  ```graphql
  query($handle: String!) {
    productByHandle(handle: $handle) {
      title
      descriptionHtml
      seo { title description }
      productType
      tags
    }
  }
  ```

  POST it to `https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json`
  with header `X-Shopify-Access-Token: <token from .env>`. (You can run this
  inline — read the token, fire the request, read the result.)

The reference gives you the **structure, tone, and section rhythm** to match —
NOT content to copy. Never reuse the reference product's specific claims for the
new product.

### 3. Apply the brand rules + PDP structure
Hold to [references/brand-rules.md](references/brand-rules.md) without exception.
The ones that get violated most:
- **No em dashes (— or –).** Hyphens or commas only.
- **Benefit-only. NEVER name technical ingredients.** Say what it delivers, never
  its chemistry.
- **Idiomatic PT-BR**, not English calques.
- **No invented numbers or miracle claims.** Use only real claims present in the
  material the person gave you.
- **Only real products** in any "combina com" pairing.

Follow the 5-part PDP body from [references/html-contract.md](references/html-contract.md):
**O que é -> Para que serve -> Como usar -> Combina com -> Resultado.**

### 4. Generate the description
Emit the body as Shopify-ready HTML per [references/html-contract.md](references/html-contract.md)
(semantic tags only, no `<h1>`, no inline styles, no `<script>`, product mentions
as `<a href="/products/handle">` links). Also produce the SEO pair:
- `seo_title` — 45-70 chars.
- `seo_description` — 140-160 chars.

### 5. Save + hand off (generate-only)
Write the result to the shared workspace folder under the person's own output
subfolder, as a single file named after the product, containing: the HTML body,
then the seo_title and seo_description below it. Then show the person a short
summary and tell them where the file is, so they can review and paste it into
Shopify themselves.

**Never** call any write/mutation against the store. If the person asks you to
publish, tell them this skill only drafts — publishing is done by hand in Shopify
admin (a connector-side publish is a phase-2 capability).

## Quick self-check before you hand off
- [ ] Zero em/en dashes.
- [ ] No technical ingredient names — benefits only.
- [ ] Every product mention links to a real `/products/<handle>` URL.
- [ ] No `<h1>`, no inline styles, no `<script>`, no global HTML structure.
- [ ] seo_title 45-70 chars, seo_description 140-160 chars.
- [ ] No invented numbers; PT-BR reads idiomatic.
