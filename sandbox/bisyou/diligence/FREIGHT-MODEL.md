# Bisyou × Unilog B2C Freight — Per-Order Cost Model

_Source: Unilog "ANEXO II.I – TABELA DE FRETE B2C" + complementary rules page, from GE's signed Unilog B2C contracts (`source-docs/unilog/`, rendered pp.24–29). Bisyou order profile from Ivan: products ~30g each (clareador 70g, sabonete 150ml); **average order ~250g** due to kit formation + branded unboxing box._

## The decisive nuance: cubed weight, not real weight

Unilog bills on the **greater of real weight vs cubed weight**, cubagem factor **167 kg/m³** (rules p.29).
- Real weight: ~0.25 kg → would hit the **first band (0–0.25 kg)**.
- But the **rigid branded unboxing box** has volume. A ~20×15×8 cm box = 0.0024 m³ × 167 = **~0.40 kg cubed** → bills in the **0.30–0.50 kg band**.
- **So model Bisyou orders at the 0.30–0.50 kg band, not the first band.** The unboxing box (Ivan confirmed it's a rigid, branded delivery box, heavier gramatura) costs us a weight tier. For SE the difference is small (~R$1–2); for the NE/North tail it is larger.

## Rates for Bisyou's bands (R$/order), key zones

| Zone (GEOCOM) | 0–0.25 kg | 0.30–0.50 kg (likely billed) |
|---|--:|--:|
| ES / Capital 1 (origin region) | 12,85 | 17,10 |
| RJ / Capital 1 | 15,87 | 18,75 |
| MG / Capital 1 | 18,10 | 19,07 |
| SP / Capital 1 | 18,55 | 20,35 |
| SP / Capital 2 | 22,90 | 23,47 |
| PR / Capital 1 | 22,02 | 24,22 |
| DF / Capital 1 | 22,62 | 23,57 |
| SC / Capital 1 | 23,32 | 24,42 |
| RS / Capital 1 | 23,50 | 25,12 |
| GO / Capital 1 | 22,78 | 23,53 |
| MS / Capital 1 | 24,82 | 25,83 |
| BA / (zone 1) | 23,60 | 32,17 |
| CE / Capital 1 | 27,70 | 31,60 |
| PE / Capital 1 | 27,80 | 32,07 |
| SP / Interior 3 | 49,33 | 50,90 |
| PA / Capital 1 (North) | 46,05 | 63,65 |
| AM / Capital 1 (North) | 47,62 | 55,95 |
| RR / Capital 1 (North) | 158,08 | 168,85 |

Full grid for every state/zone and every weight band is in the rendered pages (`unilog/freight_p24..29.png`).

## Surcharges & rules that hit per-order cost (p.29)

- **GRIS** (risk mgmt): ~0.33% of NF value (some zones 1.67–3.33%).
- **Ad Valorem**: ~0.67% of NF value. → GRIS+AdV ≈ **~1% of AOV** (≈ R$1.75 on a R$175 order).
- **Reentrega (redelivery): 50%** of outbound freight. **Devolução (return): 100%** of outbound freight. A 5–10% failed-delivery/return rate adds ~R$1.5–3/order on average.
- **Líquidos engarrafados / vidro: Unilog disclaims liability for breakage.** Relevant for água micelar, sabonete líquido — breakage loss sits with us.
- Coleta Mon–Fri; weekend collection quoted separately; max dimension 120 cm.

## Blended per-order estimate

Bisyou's exact UF mix is in Ivan's unshared per-order file. Using a representative Brazilian DTC-beauty destination mix (SP ~33%, RJ 12%, MG 11%, South 19%, NE 17%, CW 6%, North 2%), at the **0.30–0.50 kg band**:

- **Last-mile freight ≈ R$27–30/order** (blended, nationwide).
- **+ GRIS/AdV ≈ R$1.75 + reentrega/return drag ≈ R$2 → all-in ≈ R$30–34/order.**
- **SE-capital-only orders ≈ R$18–22 all-in.** North/NE-interior orders R$50–160 each (low volume but they drag the blend up).

→ On a ~R$175 AOV, freight is **~17–19% of AOV**. That is consistent with Bisyou's reported "Despesas com Vendas" running ~18% of net revenue (which also includes armazenagem + comissões).

## Strategic read (important)

1. **Freight is NOT an obvious synergy.** For ultralight skincare (sub-300g), **Correios PAC/Mini Envios or a hybrid carrier is often cheaper than Unilog's transportadora table.** If Bisyou currently ships via Correios, moving them onto GE's Unilog contract could *raise* per-order freight. The Unilog value is integrated **fulfillment** (fiscal filial, storage, pick/pack from the Serra/ES + SP nodes), not necessarily the cheapest last-mile.
2. **Origin matters.** GE's Unilog filial is in Serra/ES (cheapest ES zone). Bisyou stock today sits in SP + MG (deck p.81). Shipping origin should be chosen per destination to minimize zone cost.
3. **To lock the exact number we need, from Ivan's per-order file:** (a) UF/CEP destination mix, (b) order count (→ true freight/order they pay today), (c) current carrier (Correios vs transportadora), (d) real box dimensions (to confirm the cubed-weight band).

## VALIDATED against the per-order file (2026-06-14)

Reconstructed 44,969 paid B2C orders from the base tab and priced each against this table using its **actual UF and order size**:
- **Unilog est. freight: R$28–29/order** (Shopify, by real UF mix) = **~15% of Shopify AOV (R$200)**, ~18% of all-B2C AOV (R$152). Independently confirms the ~R$30 estimate.
- File has **no weight/dimension data** (cols 38–40, 45–46 all zero) → cubed weight can't be read, only inferred. But SE freight bands are nearly flat across 0.25–2 kg, so the cubed-box nuance barely moves the dominant SE volume.
- **Today they ship J&T Express + R3 Express (budget couriers); 59% free shipping, avg R$6.52 charged to customer.** Their true carrier cost isn't in the file but J&T/R3 light-parcel rates sit well below Unilog's table.

## Bottom line for unit economics
Budget **~R$28–29/order** if served on Unilog. **But that is likely ~2× what they pay J&T/R3 today** — so **do NOT migrate Bisyou's last-mile to Unilog**; keep J&T/R3 or tender it. Freight is a cost to *match, not win*. The fulfillment synergy is warehousing/pick-pack + overhead consolidation, per `ANALYSIS.md`. Action: get one month of their actual carrier invoice to quantify the gap.
