# Session Handoff — 2026-07-11

Multi-product landing-page work for GE Beauty. **Read this fully — most of the work is LIVE on Shopify (theme assets + page/product metafields + Files + collection order + a discount Function), NOT in git.** Git shows almost none of it; the `.claude/initiatives/landing-page-replication.md` copy in `c:/claude` is STALE (this session's detailed notes were written to the now-relocated Desktop path). This doc is the source of truth.

## Environment / paths (post-relocation)
- Repo cwd: **`c:/claude`**. GE tenant lives at **`c:/claude/gebeauty/`**.
- Shopify token: **`c:/claude/gebeauty/.env`** (`SHOPIFY_ADMIN_ACCESS_TOKEN`, `SHOPIFY_SHOP_DOMAIN=ge-beauty-cosmeticos.myshopify.com`, API `2026-01`). Python: **`C:/Python314/python.exe`**. Use `urllib`; resolve `.env` from an absolute path (the Desktop `nami-works` tree is GONE).
- Main theme id **`181379236160`** ("[Check] - Produção"). **Verify `role==main` before any theme edit** (CheckCommerce cache-bust can swap it).
- **Storefront cache lags badly** (CheckCommerce). Verify renders on the myshopify origin with `?preview_theme_id=181379236160&_fd=0&pb=0` and refetch a few times; the public `www.gebeauty.com.br` lags longer. The **theme asset + metafields are authoritative** — trust them over a stale render.
- The build scripts I used lived in an **ephemeral session scratchpad (gone on Desktop)**. Do NOT look for them. **Source of truth = the live theme asset**: fetch `templates/page.guia-boosters.json` via the Asset API, modify the JSON, PUT it back.

## The core architecture
**One shared template `templates/page.guia-boosters.json` drives BOTH landing pages.** It's a fully page-metafield-driven, reusable **multi-product LP scaffold**. Per-page content = that page's `custom.*` metafields; a template edit hits BOTH pages.

- **Boosters LP** — `/pages/nossos-boosters` (page id **164373692736**), PUBLISHED. `gift_mode` OFF.
- **Travel-size LP** — `/pages/lp-e4fa5694b3a8` (page id **164513415488**), PUBLISHED but **UNLISTED** (random slug, no nav link). `gift_mode` ON.

**Giveaway behavior is gated by page metafield `gift_mode` (boolean)** so it applies ONLY to the travel LP; boosters is unaffected (verified repeatedly). Never remove the gate.

### Page-metafield register (custom.* — all defs exist store-wide)
`banner_desktop`/`banner_mobile` (file_ref) · `intro_titulo` + `intro_ponto_1..4` (single_line, inline `<strong>`) · `cards_titulo` · **`produto_em_destaque_1..8`** (product_ref — each drives one `featured-product` card; empty slots 6-8 self-hide) · `tab_1_label`/`tab_2_label`/`tab_3_label` (default como usar/resultados/saiba mais) · `faq_titulo` + `faq_1..4_pergunta`/`_resposta` (resposta = rich_text, bind `| metafield_tag`) · `colecao_titulo` + `colecao_descricao` (rich_text) + `colecao_em_destaque_1` (collection_ref) · `promo_icones` (list.metaobject_reference→`icones`, default trio fallback) · **`gift_mode`** (bool) + **`gift_code`** (the coupon).
Cards ride the product for free: `beneficio_em_destaque_1..3` (+`imagem_`), `loox.avg_rating`/`num_reviews`, and tabs from the product's `descricao_longa_com_abas` metaobject via `{{ section.settings.product.metafields.custom.descricao_longa_com_abas.value.<field> | metafield_tag }}` (passo_a_passo→tab1, resultado→tab2, o_que_e→tab3). **Custom sections:** `boosters-oquesao` (intro pills), `boosters-headline` (heading), `lp-promo-icones` (objection strip + fallback), plus a `custom-liquid` section `giftapply` (first in order) holding the gift-mode script.

**Spin up a new LP** = duplicate a page → assign template suffix `guia-boosters` → fill ~12-15 page metafields + point products. Zero theme-code edits.

## Travel-size acquisition LP — full state (all LIVE)
Offer: **new customer picks 1 travel size free (shampoo/máscara/leave-in), pays only shipping.**
- **Coupon `MINI-GRATIS_2PDR1FZ`** — a **Function Studio** discount (code-activated; invisible to the discount API + draftOrderCalculate). Ad/entry URL (point ALL traffic here, not the bare page): `https://www.gebeauty.com.br/discount/MINI-GRATIS_2PDR1FZ?redirect=/pages/lp-e4fa5694b3a8` (verified: sets `discount_code` cookie). Belt-and-suspenders: `giftapply` section also silently `fetch('/discount/<gift_code>')` once/session so R$0,00 is honest for any visitor.
- **R$0,00 gift display** on cards: struck regular price → `R$0,00` + note "1 unidade grátis na primeira compra · você paga só o frete"; native in-button price hidden.
- **Cart-aware buttons** (reads `/cart.js`; cortesia = 1 free/order): state 0 → `experimentar`; a travel size in cart → that card `no carrinho ✓` (status), other cards stacked `trocar brinde por {produto}` (outline, top; free swap via `/cart/change.js` remove-then-add) + `adicionar por R$XX` (primary, below; paid 2nd unit → that card also flips to `no carrinho ✓`). Native buy button hidden but kept in DOM, driven via `.click()` to reuse Dawn's add+drawer. Buttons use **Italian Plate No1 Mono** (theme button font). **JS behavior is UNTESTED in a real browser** — needs a pass.
- **WhatsApp widget hidden**: the loader `<script id="hexagon-ge-whatsapp-widget">` injects `#hxWaRoot`/`#hxWaBtn`/`#hxWaBadge`/`.hx-wa-*` at runtime → hidden via CSS + a `killWa()` JS that removes them (retries + 6s MutationObserver). Gated by gift_mode.
- **Hero banners** (red headline per updated creatives, products untouched): desktop **3:1** (the `21x9_hybrid` plate extended right), mobile **4:5** (`4x5_hybrid`); headline "seu primeiro / GE Beauty / é por nossa conta" in Italian Plate Expanded Bold (GE Beauty never line-breaks), subhead "escolha um travel size e pague só o frete", no eyebrow. Products left (desktop) / bottom (mobile). Plates: `c:/claude/gebeauty/imagery/travel-size-promo/expanded/`. Mobile maxes at 2 lines (products framed high, ~28% down).
- **4 benefit icons generated** (Magnific, icon-150 style) — shampoo: `limpa sem ressecar` (fortificante's oleosidade icon), `livre de sulfatos` (institutional fórmula-limpa leaf), `use todos os dias` (sun); máscara: `nutrição profunda` (`icon-150-pluma`).
- **Tabs** labeled `como usar / resultados / saiba mais`.
- **FAQ frete** answer: cortesia pays shipping BUT R$299 free-ship DOES apply on qualifying baskets ("como em toda a loja").
- **Bundles**: `colecao_em_destaque_1` = **a-linha-completa** (498312610112); title "já ganhamos sua confiança?"; desc "adicione mais itens e aproveite! **o frete é grátis a partir de R$299**" (bold on the frete phrase).
- **Intro "como funciona" pills**: escolha 1 travel size → pague só o frete → receba em casa para experimentar e se apaixonar → quer mais? leve nossos mais vendidos com **frete grátis***.
- Removed hero→first-phrase padding (template: hero `show_text_below`=false + intro `padding_top`=0 — affects boosters too).

## Boosters LP + collection — reordered this session
Order (topselling last-90d + Loox reviews, **antifrizz forced last**): **1 definição · 2 hidratante · 3 fortificante · 4 antioxidante · 5 antifrizz**. Applied to the LP via `produto_em_destaque_1..5` AND to the **`boosters` collection** (id 494063649088, manual sort) via `collectionReorderProducts`. Booster hero images were bg-normalized to `#ecede9` earlier. (Old `guia-pratico-dos-boosters` collection stays unpublished/redirected — left alone.)

## Email creative (ready, on disk)
`c:/claude/gebeauty/imagery/email-chunks/` — 4 block chunks sliced from Canva design `DAHPBRuQv-4` (`1_hero.png` / `2_copy.png` / `3_opcoes.png` / `4_fechamento.png`, each 1021px wide, cut at whitespace gaps). Recommended subject A/B: **A** `seu primeiro GE Beauty é por nossa conta` / **B** `leve um GE Beauty pagando só o frete` (pre-headers + more variants in the conversation history).

## What's pending (pre-launch gates)
1. **Browser-test the travel LP** on the unlisted URL (arrive via the discount link): confirm coupon applies, mini shows **R$0,00** and **shipping charged** at checkout (Function can't be API-verified), and the **cart-aware buttons** work (swap / paid-add / drawer refresh / re-detect).
2. **Confirm the Function is new-customer/first-order gated** (abuse guard) — Lucas owns the Function config.
3. **Publish gate**: message-match ad↔hero, Core Web Vitals, Pixel+CAPI+UTMs firing, then a **clean public slug** (currently the random unlisted one).
4. Optional: mobile banner copy could be larger only by top-extending the 4:5 plate (adds headroom, keeps products).
5. Campaign launch itself = a `/growth-hacker` job (ad account etc. in initiative `gebeauty-paid-media-scale.md`).

## Context the next session needs
- **Editing the LP = edit the live `templates/page.guia-boosters.json` asset directly** (fetch→modify→PUT). Both pages share it; anything giveaway-specific MUST stay wrapped in `{% if page.metafields.custom.gift_mode.value %}`.
- **rich_text page metafields** bind via `| metafield_tag`; values must be the JSON AST, not HTML. `inline_richtext` settings take single_line via `.value` (inline `<strong>` renders). See memory `reference_shopify_dynamic_sources` (may be under the `c--Users-Lucas-Guimar-es-Desktop-nami-works` memory project, not `c--claude` — carry these facts from here if absent).
- `metafieldsSet` caps at **25 metafields/call**. featured-collection shows the collection's own description when `show_description:true`; set it FALSE to use the page `colecao_descricao`.
- Full (older) playbook: `.claude/initiatives/landing-page-replication.md` — but treat THIS doc as current where they differ.
