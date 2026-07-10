# Growth — GE Beauty Checkout AOV + Cross-Sell Engine (mist launch) — 2026-06-22

**Owner:** growth-hacker (offer strategy, matrix, copy, guardrails, KPIs)
**Executes:** /integrations-engineer (AfterSell / Checkout UI extension wiring, Functions discount, Klaviyo segment)
**Goal:** Maximize AOV **before** purchase completes (cart + checkout), using the 3-mist launch to drive a bidirectional cross-sell between the impulse pole (mists) and the core-LTV pole (haircare). Lift checkout completion with trust badges.

## Locked decisions
- **Pre-purchase only** (cart drawer + checkout UI extension). Post-purchase one-click is held as a future pure-additive layer.
- **Incentive = % off the attached cross-sell item** (Functions-based, applies to the introduced item only). Recommended tier: **15%**. Dial 10-20% on your margin call.
- **v1 = cart-contents rules** (cover everyone incl. guests). Klaviyo customer-segment arm (Scenario 3 history) = fast-follow.

## The frame: two poles, one bridge
- **Impulse pole — mists:** Melon Mood R$129, + new Rose Ritual / Pear Fresh / Santal Skin, + Melon travel R$79. Scent-driven, gateway, collectible.
- **Core-LTV pole — haircare best-sellers:** Primer Cachos Definidos R$149, Primer Liso Intacto R$139, Leave-in c/ Proteção Térmica R$99, Máscara Condicionadora R$95, Shampoo Sem Sulfato R$95, Booster Definição R$69.

Every play moves a customer toward the pole they're missing.

## Cross-sell decision matrix (cart-contents, v1)

| Trigger (cart) | Offer (cart + checkout block) | Incentive | Scenario |
|---|---|---|---|
| Has Melon or 1 mist | The other scents / the trio bundle | "Complete the collection" + free-ship progress (no extra discount) | 1 — mist→mist |
| **Only** mist(s), no haircare | 1-2 haircare best-sellers, scent-led ("the scent lives in your routine") — default: Shampoo Sem Sulfato + Máscara Condicionadora | **15% off the added haircare item** | 2 — impulse→core (LTV) |
| Haircare, **no** mist | One vibe-matched mist ("finish with your signature scent") | **15% off the added mist** | 3 — core→impulse (cart-level) |
| Has both | Trio bundle or complementary booster | Bundle price | — basket max |
| *(fast-follow)* Known: repeat haircare buyer, 0 mist orders | Mist intro — checkout block + Klaviyo flow | One-time 15% "meet the mists" | 3 — history-level |

Scenario 2 is the LTV unlock: a scent-only buyer is otherwise one-and-done; pulling them into the routine multiplies lifetime value.

## Illustrative AOV math
- Scenario 2: mist order R$129 + Shampoo R$95 @15% (R$80.75) = **R$209.75 (+63%)**, and closer to the R$299 free-ship line.
- Scenario 3: haircare order ~R$200 + mist R$129 @15% (R$109.65) = **+R$109.65**, plus the buyer now knows the scent line.

## Trust-badge block (checkout completion lever, all carts)
- **Pix + "Parcele em até 12x"** + card brands (installments = top BR conversion lever)
- **"Compra 100% segura"** (secure checkout)
- **"Frete grátis acima de R$299"** (ties to the Function Studio threshold + cart progress bar)
- **"Vegano e cruelty-free"**
- **Loox rating / "+X mil clientes"** (Melon alone has 136 reviews)
- **"Entrega expressa em SP"** where applicable

## Conversion guardrails (operator rules)
- **One matched cross-sell offer per surface, never a grid.** Pre-purchase upsell adds a decision before money is captured; keep it light or it dents completion.
- **Trust badges are the conversion-protector** that offsets the added cross-sell step.
- **Checkout completion rate is the guardrail metric.** If completion drops after launch, the cross-sell is too heavy — pull it back to cart-only.
- **Discount stacking:** the 15% cross-sell discount is an automatic Function discount on the attached item only. Decide stacking vs affiliate/BEAUTYBACK codes (default: does NOT stack with cart-level codes; larger benefit wins). Confirm with discounts policy before wiring.
- **Brand voice:** benefit-only, no em dashes, PT-BR.

## KPIs (measure at 2 + 4 weeks)
- Attach rate per scenario (% of eligible carts that add the cross-sell)
- AOV lift vs pre-launch baseline (segment: carts with mist, carts with haircare)
- **Cross-line conversion rate** (Scenario 2: % of mist-only buyers who add haircare; Scenario 3: % of haircare buyers who add a mist) — the real LTV signal
- Checkout completion rate (guardrail — must not fall)
- Incremental margin after the 15% discount cost

## Scope
- **v1 (now):** cart drawer + checkout UI extension cross-sell rules (4 cart-contents triggers) + trust-badge block + 15% attach-item Function discount.
- **Fast-follow:** Klaviyo segment "haircare buyers, 0 mist orders" → intro flow + personalized checkout block (Scenario 3 history arm).
- **Blocked on:** the 3 new mists must be published (out of Draft — need INCI, images, stock, copy) before they can appear as cross-sell offers.

## Hand-off to /integrations-engineer
1. Stand up the cross-sell via **AfterSell checkout** (or native Checkout UI extension) with the 4 cart-contents rules above; recommend products = the best-seller lists named here.
2. Build the **trust-badge block** with the 6 badges.
3. Create the **15%-off-attached-item** automatic discount (Shopify Function), scoped to the introduced line item only, with the stacking rule once confirmed.
4. Wire the cart drawer cross-sell block (reuse existing drawer).
5. Fast-follow: Klaviyo segment + flow for Scenario 3 history arm.
Verification: checkout completion baseline captured before launch; attach-rate + AOV events tracked.
