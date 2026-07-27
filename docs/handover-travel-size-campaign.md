# Session Handover — 2026-07-10

**For a `/growth-hacker` session: launch the GE Beauty travel-size acquisition campaign.**
Front-end (LP + email creative + coupon delivery) is BUILT and live-unlisted. Your job is the media launch: creatives → audiences → budget → tracking → go, plus the two pre-launch gates below.

## The offer (what we're selling)
- **Free-plus-shipping tripwire for NEW customers:** pick **one** travel size (shampoo, máscara, or leave-in; melon mood excluded), **pay only shipping**.
- **Coupon:** `MINI-GRATIS_2PDR1FZ` — a **Function Studio** discount (code-activated; invisible to the Shopify discount API + draftOrderCalculate, like the R$299 free-ship function). Lucas confirmed it's in place: first travel item free, customer pays shipping.
- **R$299 free-shipping does NOT apply** to this cortesia order (shipping always paid). The FAQ on the LP states this.
- **AOV design (the economics balance):** not a pure tripwire (a free mini alone is a net loss). The LP keeps the free-mini hook AND lifts AOV via a **"monte sua rotina"** bundles section (collection `a-linha-completa`) + the Dawn cart-drawer upsell. Free-ship progress nudge was dropped (shipping always paid).

## URLs (use the discount link, not the bare page)
- **LP (published, UNLISTED, random slug):** `https://www.gebeauty.com.br/pages/lp-e4fa5694b3a8`
- **CAMPAIGN DESTINATION (point every ad/email button here):**
  `https://www.gebeauty.com.br/discount/MINI-GRATIS_2PDR1FZ?redirect=/pages/lp-e4fa5694b3a8`
  → applies the coupon to the visitor's session, then lands on the LP. Verified: sets the `discount_code` cookie, 200 to the LP. **If you point ads at the bare `/pages/...` URL the coupon still auto-applies (on-load script), but the discount-link destination is the primary guarantee — use it.**

## Coupon delivery (how the customer is guaranteed the free mini)
Two layers, both live:
1. **Entry:** the discount-link destination above applies the code on arrival.
2. **Belt-and-suspenders:** a silent on-load script on the LP (`giftapply` custom-liquid section, gated by page metafield `gift_mode`) applies `/discount/<gift_code>` once per session — so the R$0,00 shown on the cards is honest for ANY visitor, even direct.
- **CTA behavior:** add-to-cart → Dawn drawer (stays on page for the rotina upsell) → session discount rides to checkout → Function zeroes the mini.
- **Card price display:** each card shows the regular price struck → **R$0,00** + note "1 unidade grátis na primeira compra · você paga só o frete", with the in-button price hidden. Gated by `gift_mode` (only this LP; the boosters LP that shares the template is unaffected — verified).

## Email creative (ready)
- **Sliced chunks:** `gebeauty/imagery/email-chunks/` → `1_hero.png`, `2_copy.png`, `3_opcoes.png`, `4_fechamento.png` (each 1021px wide, high-quality, cut at the design's breathing gaps from the Canva "email" design `DAHPBRuQv-4`). `_full_hi.png` = 7200px source.
- **Subject / pre-header options** (brand-voice: idiomatic PT, no em dashes, lowercase GE styling). Recommended A/B:
  - **A (gift, message-matches the hero):** subj `seu primeiro GE Beauty é por nossa conta` / pre `escolha um travel size e pague só o frete. sem pegadinha.`
  - **B (mechanic):** subj `leve um GE Beauty pagando só o frete` / pre `shampoo, máscara ou leave-in tamanho viagem. você escolhe.`
  - Other angles (bold/curiosity, direct, personalized, short) are in the conversation; ask Lucas if you want them re-listed.

## Ad-media context (from the initiative)
- Ad-account + creative/audience history lives in **`.claude/initiatives/gebeauty-paid-media-scale.md`** (modified this session) and the paid-test design in **`.claude/initiatives/landing-page-replication.md`** (PDP-vs-LP A/B section).
- From landing-page-replication: account **GE_Beauty `606199920079315`** (BRL), Foreplay brand id `teAkgOSykZ4SbTvRO1Zm`, FB page `106114707866572`. **Verify current account state before launching** — that note is from 2026-07-04.
- Meta ad creatives for the campaign are staged in `gebeauty/imagery/travel-size-promo/creatives/` (1x1, 4x5, 9x16, 3x1 `ganhe-miniatura`, plus `hooks-4x5/` and `matrix/` variants).

## Cart-aware buttons (added 2026-07-10 — needs a browser test)
The cortesia is **1 free unit/order**, so the LP cards read `/cart.js` and adapt (gated by `gift_mode`): none-in-cart → `comprar` (R$0,00); a travel size in cart → that card shows `no carrinho ✓`, the other two show `adicionar por R$XX` (primary, paid 2nd unit) + `trocar por {produto}` (outline, free swap). Reuses Dawn's native add+drawer via `.click()`; `trocar` does `/cart/change.js` remove-then-add. Markup + gating verified via curl (0 errors), but **the JS behavior itself is UNTESTED in a real browser** — swap, paid-add, drawer refresh, and detection-after-add all need a real-browser pass on the unlisted URL. Mockup: `scratchpad/.../cart-aware-buttons-v1.html`.

## What's pending BEFORE launch (gates)
1. **Real checkout test (blocking):** the Function discount can't be verified via API. Do one real **add-to-cart → checkout** on the LP (arriving via the discount link) and confirm the mini lands at **R$0,00 and shipping is charged**. If it does, card + cart agree. **Same session: browser-test the cart-aware buttons** (all 3 states + swap + paid-add + drawer).
2. **Publish gate:** message-match (ad hook ↔ LP hero), Core Web Vitals (LCP<2.5s/CLS<0.1), Pixel + CAPI firing + UTMs on the destination, then a **clean public slug** (currently the random unlisted `lp-e4fa5694b3a8`).
3. **New-customer gating:** confirm the Function only rewards first-order/new customers (abuse guard) — Lucas owns the Function config.

## Context the next session needs
- **Do NOT re-point ads at the bare page URL** — the discount-link destination is the coupon guarantee.
- **The LP template is SHARED with the boosters LP** (`templates/page.guia-boosters.json`). All giveaway behavior (R$0,00 display, coupon auto-apply) is gated by page metafields `gift_mode` (bool) + `gift_code` (the code). Boosters verified unaffected. Don't remove the gates.
- **Source of truth = live theme asset**, not the stale builder scripts. Full LP build + reusable multi-product scaffold documented in `.claude/initiatives/landing-page-replication.md`.
- **Storefront full-page cache lags** (CheckCommerce) — verify renders via `?preview_theme_id=181379236160` on the `.myshopify.com` origin, not the public domain.
- The LP is **unlisted** (random slug, no nav link) so you can send test traffic without public exposure. Keep it unlisted until the publish gate passes.
