# Phase 1 — Shopify metafield map for `/video-director`

**Source authority:** verified on `primer cachos definidos` (gid://shopify/Product/9668674879808) and `leave-in pluma` (gid://shopify/Product/9856328565056), 2026-05-17. All metafields live under the `custom` namespace.

This document is the contract the brain's Step 1 (Ingest) reads against.

---

## The four content layers per product

Each GE Beauty product carries four distinct levels of benefit content. Each layer has a different role for the brain.

### Layer 1 — `custom.finalidade` (single_line_text_field)

**Role:** the product's positioning sentence. One-liner answer to "what is this for?".

**Examples:**
- primer cachos definidos: `cachos definidos, macios e sem pesar os fios`
- leave-in pluma: `hidrata, repara, protege até 230 °C, dá brilho e controla o frizz`

**Brain use:** Step 2 (benefit→moment mapping) anchors the overall brand narrative against this line. Tells the brain "the product is positioned as X" before it starts mapping individual benefits to moments.

### Layer 2 — `custom.beneficio_em_destaque_1/2/3` (single_line_text_field × 3)

**Role:** the curated top-3 benefits. Marketing-ready phrases. The "headline benefits" the brand chose to highlight on the PDP. Always exactly three fields.

**Examples:**
- primer cachos definidos:
  1. `definição leve e natural`
  2. `controla o frizz e blinda por até 24h`
  3. `brilho e hidratação sem rigidez`
- leave-in pluma:
  1. `leveza, liberdade e praticidade`
  2. `hidrata, repara e dá brilho`
  3. `protege do calor até 230ºC`

**Brain use:** PRIMARY input to Step 2 (benefit→moment mapper). Each `beneficio_em_destaque_N` becomes one moment in Marcela's day. Three benefits → three core moments. With a hook + offer beat added, this gives a natural 4-5 shot arc.

### Layer 3 — `custom.imagem_beneficio_em_destaque_1/2/3` (file_reference × 3)

**Role:** the paired image for each highlighted benefit. The visual the merchandiser chose to represent that specific benefit on the PDP.

**Brain use:** ADDITIONAL seed-image candidates for the specific shot demonstrating that benefit. The brain can use:
- `featuredMedia` for hero shots (the canonical product photo)
- `imagem_beneficio_em_destaque_N` for the specific benefit's demonstration shot, when image-to-video is appropriate

This is a meaningful upgrade over the v1 seed-image rules in IP doc §6 — each benefit shot can be seeded with its own contextual image, not just the canonical product.

### Layer 4 — `custom.caracteristicas` (rich_text_field)

**Role:** the expanded characteristic list. More detail than the `beneficio_em_destaque` fields. Often 3-5 bullets with bold key terms + descriptions.

**Examples:**

primer cachos definidos:
- **definição leve** e natural, com movimento
- **controla o frizz** e blinda da umidade por até 24h
- **adiciona brilho** e hidrata sem rigidez

leave-in pluma:
- **hidrata e nutre** devolvendo maciez aos fios
- **repara danos** e fortalece a fibra capilar
- **protege do calor** até 230 °C
- **potencializa o brilho** sem pesar

**Brain use:** SECONDARY context for Step 2. When a `beneficio_em_destaque_N` phrase is too compact or value-led (e.g. "leveza, liberdade e praticidade"), the brain looks into `caracteristicas` to find the functional bullet that explains what the benefit actually means. Then maps it to a moment.

---

## Supporting metafields (also fetched in Step 1)

| Key | Type | Use |
|---|---|---|
| `custom.dosagem` | single_line_text_field | Volume, e.g. "200mL" or "250mL". Used in offer copy. |
| `custom.tipo_de_cabelo` | list.single_line_text_field | Target hair types (audience hint). |
| `custom.necessidade` | list.single_line_text_field | Pain-point list (informs moment mapping). |
| `custom.finalizacao` | list.single_line_text_field | End-state finishes (informs offer copy). |
| `custom.faq` | list.metaobject_reference | FAQ entries (optional context for ad copy). |
| `custom.antes_e_depois` | metaobject_reference | Before/after content if exists. |
| `custom.etiquetas` | list.metaobject_reference | Product tags (e.g. "Lançamento" — but use sparingly, lançamento framing is locked off per Lucas's earlier decision). |

---

## Step 1 (Ingest) — the canonical query

The brain's Step 1 should issue this single GraphQL query per product:

```graphql
query VideoDirectorIngest($productId: ID!) {
  product(id: $productId) {
    id
    title
    handle
    description
    priceRangeV2 { minVariantPrice { amount currencyCode } }
    featuredMedia {
      preview { image { url width height } }
    }
    media(first: 10, query: "media_type:IMAGE") {
      edges { node {
        ... on MediaImage {
          preview { image { url } }
          alt
        }
      }}
    }
    metafields(first: 25, namespace: "custom") {
      edges { node { key type value } }
    }
  }
}
```

After execution, the brain extracts:

```python
state.benefits = [
  metafield("beneficio_em_destaque_1"),
  metafield("beneficio_em_destaque_2"),
  metafield("beneficio_em_destaque_3"),
]
state.benefit_images = [
  resolve_file_ref("imagem_beneficio_em_destaque_1"),
  resolve_file_ref("imagem_beneficio_em_destaque_2"),
  resolve_file_ref("imagem_beneficio_em_destaque_3"),
]
state.finalidade = metafield("finalidade")
state.caracteristicas = parse_rich_text(metafield("caracteristicas"))  # array of strings
state.product_meta = {
  title, handle, description, price,
  dosagem: metafield("dosagem"),
  tipo_de_cabelo: metafield("tipo_de_cabelo"),
  necessidade: metafield("necessidade"),
  finalizacao: metafield("finalizacao"),
  hero_image: featuredMedia.preview.image.url,
}
```

The `file_reference` type returns a `gid://shopify/MediaImage/N` which needs a second query to resolve to a CDN URL (or `node()` query with the GID). Handle that in the brain's Step 1 implementation.

---

## Validation checks before Step 2 runs

The brain should refuse to continue if any of these are missing:

- [ ] `finalidade` is populated
- [ ] All three `beneficio_em_destaque_1/2/3` are populated and non-empty
- [ ] `featuredMedia` exists

If a check fails, the brain emits a clear error to chat naming the missing field and the product handle, and pauses. No silent fallback to "Step 2 with two benefits" — better to fail loud.

---

## Open data-quality observations

From the two products I sampled:
- Both have the same 3-benefit + 3-image + finalidade structure populated. **Consistent across the line.**
- `caracteristicas` count varies (3 for primer cachos, 4 for leave-in pluma). The brain treats it as a 3-5 item list.
- `beneficio_em_destaque_N` mixes value-led and functional phrasing. Pluma's "leveza, liberdade e praticidade" is more emotional than cachos's "definição leve e natural". The brain handles both styles in Step 2.

**Recommended:** before the brain ships to production, spot-check the full 14-product portfolio for any product with empty `beneficio_em_destaque_*` fields. If found, those products are not eligible for /video-director generation until populated.
