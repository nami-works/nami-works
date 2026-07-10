# Stress test — does Guru read Shopify metafields/metaobjects?

> **Goal:** determine empirically, without waiting on Zoko support (India time), whether
> Guru's Shopify integration reads only the product description (`body_html`) or also
> metafields / metaobjects. Decides the §6 boundary in `kb-draft-v2.md` and whether
> /content-director must enrich PDP bodies.

## Key prior (from Zoko docs, 2026-07-07)

Zoko's Shopify sync is a **WhatsApp Catalog** sync → Meta Commerce Catalog. That schema is
fixed (name, description, price, image, link, availability); **no slot for arbitrary Shopify
metafields/metaobjects.** So if Guru answers from the catalog, it sees the **description
only**. Metafields would reach it only via a separate ingestion pipeline (not indicated).
Sync latency: up to 90 min initial, **1–24h** for updates.

## Tier 0 — Dashboard inspection (do first; minutes, no writes, no bot)

1. Zoko dashboard → Catalog / Products → open any synced product.
2. Look at the stored fields. Only name/description/price/image → metafields NOT synced.
   The description shown = the text Guru would read.
3. Works today regardless of Guru/OpenAI state (catalog sync ≠ bot). Likely answers it.

## Tier 1 — Canary test (definitive for the bot; plant today, read after sync)

**Prereq:** Guru live enough to answer (OpenAI connected + catalog synced + bot in test mode).

### Canaries (planted on one existing synced product)

| Layer | Field | Token | Visible? |
|---|---|---|---|
| Control/body | existing true description detail (no write) OR temp body sentinel | `VERGGB-BODY` | body write is visible |
| Scalar metafield | `custom.zoko_canary_text` (single_line_text) | `VERGGB-META` | No (not theme-rendered) |
| Metaobject ref | metaobject `zoko_canary.codigo` via `custom.zoko_canary_ref` (metaobject_reference) | `VERGGB-OBJ` | No |

Script: `canary_probe.py` — `plant` creates the two invisible canaries + metaobject; `revert`
deletes them. Reads creds from `../.env`. Target product set at top of script.

### Questions to ask in the Guru test chat (after sync, ~next day)

Ask each in a fresh test conversation:
1. **Control:** "Qual é o código de verificação interno do [produto]?" (if body sentinel used)
   or an existing-fact question to confirm the bot answers from catalog.
2. **Metafield:** "Qual é o código de verificação interno do [produto]?" → looking for `VERGGB-META`.
3. **Metaobject:** same question → looking for `VERGGB-OBJ`.

(If all three canaries answer the same question, use one question and see WHICH token(s) it
returns — that directly reveals which layers it can read.)

### Interpretation

| Guru returns | Conclusion | Action |
|---|---|---|
| Only body token / body fact | **Description-only** (expected) | content-director enriches `body_html`; keep product Q&A out of Zoko |
| `VERGGB-META` | Reads scalar metafields | Can rely on `finalidade`, `caracteristicas`, `dosagem` |
| `VERGGB-OBJ` | Resolves metaobject references | `custom.faq`, `descricao_longa` already usable by the bot |
| Nothing (even body) | Sync delay / bot not reading catalog / config | Re-check sync + test mode; not evidence about metafields |

## Cleanup

Run `canary_probe.py revert` once the test concludes. Deletes both test metafields, the
metaobject entry, and the `zoko_canary` metaobject definition. Leaves the store as found.

## Cross-check

Tomorrow, when Zoko is reachable, confirm the empirical result against their answer on read
scope (body only vs metafields vs metaobjects vs policy pages).
