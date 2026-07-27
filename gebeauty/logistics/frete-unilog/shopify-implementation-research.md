# Applying the regional free-shipping ladder on Shopify — implementation research

**Goal:** free shipping above a **different order-value threshold per region** (SE R$199 · CO R$279 · S R$319 · NE R$399 · N R$649), and **charge real freight below** it (pass-through). GE is on **Shopify Plus**.
Grounded in Shopify dev docs (Admin API 2026-04 + Functions), verified via the dev MCP.

---

## The core challenge: destination is known at CHECKOUT, not in the CART

The threshold depends on **where the order ships**. Shopify only knows the destination **after the customer enters the shipping address at checkout**. So:

- **Rate/cost logic** (which threshold applies, free vs paid) → resolves perfectly at checkout. ✅
- **Cart incentive** (the "Faltam R$X para o frete grátis" progress bar, PDP/cart messaging) → lives **before** the address is known, so it **cannot know the region**. ⚠️ (see §5)

Everything below splits along that line.

---

## 1. What does NOT work

**Native automatic free-shipping discount** (`DiscountAutomaticFreeShipping`). Its destination selector is **country-level only** — `destination { all | countries [...] }`. There is **no province/state granularity**. So you cannot express "free ≥ R$199 in SP but ≥ R$399 in BA" with a native discount. This is the reason we need delivery profiles and/or a Function. (Verified: `DiscountShippingDestinationSelectionInput` = `all` or `countries`.)

---

## 2. The rate engine — two viable architectures (both work at checkout)

Both need **5 shipping zones = the 5 region tiers**, built from Brazilian **provinces** (states). Shopify delivery zones DO support provinces: `deliveryProfileCreate` accepts `zonesToCreate { countries { code: "BR", provinces: [{code: "SP"}, ...] } }`. One zone per region, listing its UFs.

### Architecture A — Native delivery profiles (no custom app)
Per zone, two rate method definitions with **price-based conditions** (`methodConditions`, operator `GREATER_THAN_OR_EQUAL_TO` on a `MoneyV2` subtotal — confirmed in the schema):
- **"Frete grátis"** — price R$0, condition `subtotal ≥ regional threshold`.
- **"Frete"** — the real freight (see §3), shown when below threshold.

Above the threshold both the free and the paid rate are eligible → Shopify shows both and the buyer picks free. To **force free-only**, add the Delivery Customization function in §4.
- **Pros:** no app code; provisionable via one `deliveryProfileCreate`/`deliveryProfileUpdate` GraphQL call (I can script it). Robust, native.
- **Cons:** the threshold lives inside each zone's rate condition (5 places to edit); both rates show unless hidden; static.

### Architecture B — Discount Function for the free logic (recommended for maintainability)
- Keep **one base "Frete" rate per zone** = real freight (§3). No free rate in the profile.
- Add a **Shopify Function — Discount API**, target `cart.delivery-options.discounts.generate.run`, `discountClasses: ["SHIPPING"]`. It reads `cart.cost.subtotalAmount` + `cart.deliveryGroups.deliveryAddress.provinceCode`, maps province → region → threshold from a **metafield config (the ladder as JSON)**, and returns a **100% shipping discount** (`deliveryPercentage: 100`) when subtotal ≥ that region's threshold. Below → no discount → buyer pays the base freight (pass-through). (Verified: the delivery-discount target exists, reads `deliveryAddress`, and applies `deliveryPercentage`.)
- **Pros:** the entire ladder is ONE editable metafield (matches the "every driver is a variable" ethos — retune thresholds without touching zones); free shows cleanly as the discounted rate; centralized logic.
- **Cons:** requires a custom app/extension (Plus + Partner app — GE already has `apps/`), a deploy, and CLI scaffolding.

Both are legitimate. **A** is the fastest to ship and fully no-code after provisioning; **B** is the cleanest to operate long-term.

---

## 3. Pass-through below threshold — where the "real freight" rate comes from

The below-threshold "Frete" rate must equal the true carrier cost. Two options:

- **CarrierService API (live rates)** — a callback endpoint returns Unilog/Sélia freight per cart (weight + destination) in real time. GE's Plus plan **meets the Advanced+ requirement** for carrier-calculated rates. Best fidelity; the existing `apps/connector` could host the callback. Requires `write_shipping` scope + an endpoint that mirrors the freight table.
- **Static rate table** — weight×zone tiers entered in the delivery profile, mirroring the Unilog table (the same matrix I parsed). No integration; approximate (rounds weight bands), more rows to maintain, and it drifts when the carrier table changes.

For a clean pass-through that always matches the invoice, **CarrierService** is the right long-term answer; a static table is an acceptable MVP.

---

## 4. Forcing free-only (optional polish)
**Delivery Customization Function** (`cart.delivery-options.transform.run`) reads `deliveryGroups.deliveryOptions[].cost` and can **hide** the paid option when a R$0 option is present (the docs' "hide the free/duplicate option" pattern, keyed on cost/handle). Use it under Architecture A so the buyer never sees a paid rate once they qualify. Max 25 delivery customizations/store; Plus supports it.

---

## 5. The cart progress-bar problem (the real UX wrinkle)

The theme's "Faltam R$X para o frete grátis" bar (currently enabled via `settings_data.json`, flat R$299) **cannot know the destination region in the cart** — the address isn't collected until checkout. Options, roughly in order of effort:

1. **Single headline threshold pre-address** — show the SE/most-common tier ("frete grátis a partir de R$199") in cart, and let the *real* per-region rule apply at checkout. Simple, but a NE customer sees R$199 and is charged unless they hit R$399 → expectation gap.
2. **Show the highest tier** ("a partir de R$649") — honest for everyone, but kills the incentive for the 66% in SE. Bad.
3. **IP geolocation** to guess region and show that tier in cart — approximate (IP ≠ shipping address), needs an app/script.
4. **Defer the incentive to checkout** — no cart bar; surface the applicable threshold once the address is entered (Checkout UI extension, Plus). Accurate, but later in the funnel.

**Recommendation:** headline the SE R$199 in cart (covers ⅔ of orders accurately), and add a Checkout UI extension line that states the exact regional threshold once the address is known. Accept the gap for the ⅓ outside SE, or soften copy ("frete grátis a partir de R$199* · *valor varia por região").

---

## 6. Recommended architecture

| Layer | Recommendation | Why |
|---|---|---|
| Zones | 5 province-zones (SE/CO/S/NE/N) in the GE delivery profile | Only way to get per-state granularity |
| Free logic | **Discount Function** (SHIPPING, 100%), ladder in a metafield | One editable config; clean UX; retune without touching zones |
| Below-threshold rate | **CarrierService** (Unilog/Sélia live) — static table as MVP | True pass-through matching the invoice |
| Force free-only | Delivery Customization function (optional) | Hide paid rate once qualified |
| Cart incentive | Headline SE R$199 + Checkout UI extension for exact regional value | Best accuracy given cart doesn't know destination |

**Fastest MVP** (no app code): Architecture **A** (native zones + price-conditional free rate + static freight table), provisioned by one `deliveryProfileCreate` call, headline R$199 in cart. Ship in a day; upgrade to the Function + CarrierService later.

---

## 7. Requirements & what I can do next

- **Plan/scopes:** Plus ✅ (CarrierService ok); Functions need a Partner custom app (`apps/` exists); `write_shipping` for CarrierService.
- **I can script now:** the `deliveryProfileCreate`/`deliveryProfileUpdate` GraphQL to build the 5 zones + rates (Architecture A) as a dry-run first (no live change without approval, per house rule).
- **I can scaffold:** the Discount Function extension (Rust/JS) + metafield config for Architecture B — that's `apps/**` app-building (branch + PR + deploy queue).
- **Open decision:** A (native, fast) vs B (function, maintainable); and CarrierService vs static table for pass-through.

*Not yet implemented — research only. No store changes made.*
