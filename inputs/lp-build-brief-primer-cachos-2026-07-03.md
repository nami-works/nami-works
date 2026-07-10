# LP Build Brief — Primer Cachos Definidos (cold-traffic) — 2026-07-03

**For:** /product-developer · **Producer:** /growth-hacker · **Approval gate:** Lucas signs off on wireframe + hero copy before build (see bottom).

## Route
- GE Beauty Shopify theme, custom page template (Liquid section). Suggested: page template suffix `primer-cachos-lp`, page handle `/pages/primer-cachos-definido` (confirm final slug; must be distinct from the SEO PDP `/products/primer-cachos-definidos`).
- Host: gebeauty.com.br (Shopify Plus). See `sandbox/gebeauty/CLAUDE.md`.
- This LP is SEPARATE from the SEO PDP. Paid traffic points here; organic/SEO stays on the PDP.

## Context
- Campaign: Primer Cachos cold-traffic prospecting (Meta). Winning ad = Fernanda Paes Leme + hairstylist curl-transformation video, subject reacts "amei!".
- Temperature: COLD. Educate then convince a stranger. Framework: Hero → Problem → Solution → How-it-works → Proof → How-to → FAQ → Closing CTA.
- Primary conversion: purchase (add to cart / checkout). Product R$139, 250mL, cachos/ondulados.
- Offer: **NO discount code.** Lead on value: transformation + frete grátis + 6x sem juros. (Lucas decision, per Nik #20/#22.)
- CVR target (cold): 2-4% landing→purchase to start; iterate.

## Message-match contract (hard)
- H1 MUST echo the ad: salon-quality defined curls at home, up to 24h, no frizz. NOT a SKU/spec title.
- Hero visual MUST be the creator transformation (still + short loop), matching the ad frame.

## Wireframe (mobile-first, 390px) — approved shape
Header (logo + cart only, NO nav) → HERO [transformation media + H1 + subhead + review-count badge + primary CTA above fold ~560px + reassurance row: R$139 · 6x sem juros · frete grátis] → PROBLEM (3 pains) → SOLUTION (product as mechanism, 3 canon benefits) → HOW IT WORKS (ingredient-as-proof, active bound 1:1 to benefit) → PROOF (creator UGC + Camila Coutinho before/after + Giovanna Marini testimonial) → HOW TO USE (3 steps) → FAQ (fit / weight / yield / shipping) → CLOSING (recap + CTA + tagline) → minimal footer. Sticky mobile add-to-cart appears after fold. Desktop: 2-col hero, no sticky bar, CTA repeats inline.

## Copy (approved — use H1 variant 1)
- **H1:** Definição de salão no seu cabelo, todo dia em casa.
- **Subhead:** Primer que define os cachos, protege do calor e hidrata sem pesar. O mesmo resultado que você viu, agora nas suas mãos.
- **CTA (all instances):** Quero meus cachos definidos
- **CTA microcopy:** Frete grátis. 6x sem juros. Envio para todo o Brasil.
- **PROBLEMA:** "Você define os cachos de manhã. Até o meio do dia, o frizz volta." + body (calor da escova/babyliss abre a fibra).
- **SOLUÇÃO:** "Um primer que prepara o cacho antes de tudo." Define, protege até 230°C, hidrata sem pesar, até 24h. 250mL, cachos e ondulados.
- **PROVA:** "O antes e depois é real, e dura." (callback to the viral transformation + "amei!"). Social-proof block = curated real comments from the Canva comment-ad `META_CACHOSCOMENTÁRIOS` (design DAHM7sW6osA, 16 cards). Seed set (verbatim, keep IG-comment styling):
  - @leilanyriosbarreto — "O melhor! Não deixa o cabelo com a textura pesada! Sem falar no cheiro!!!!"
  - @isadoracruz — "Viciada no meu @gebeauty primer 🥰🫶🏻"
  - @prisci…ossomatica — "esse primer é MOOOOOOOITO bom pra cabelo cacheado!!! Comprei antes de mudar de país e já tô no foco de comprar mais um assim que botar o pé no Brasil! 🤎"
  - content-director to curate 5-6 total from the 16 cards.
- **COMO USAR:** 1 Aplique (úmido, mecha a mecha) · 2 Distribua/modele · 3 Finalize (natural ou difusor).
- **FAQ:** serve pro meu cabelo? / dura o dia todo (até 24h)? / pesa ou resseca? (full answers in copy doc).
- **FECHAMENTO:** "Seus cachos definidos começam hoje." + "no seu tempo, do seu jeito."
- **Reassurance line (policy-accurate, replaces "a gente resolve"):** "Troca ou devolução grátis em até 7 dias." (Pulled verbatim intent from the store return policy: devolução/troca em até 7 dias corridos, processo gratuito, sem custo de frete. NO money-back "satisfação garantida" claim exists, so do not imply one.)

## Visual assets (need production — see Flags)
- **Hero = Fernanda Paes Leme footage** (Lucas decision, post-checkin) — strongest message-match to the exact ad. **GATE:** confirm usage rights to place the Fernanda footage on an owned LP before it ships. If rights don't clear, fall back to owned creator/UGC + Camila Coutinho before/after.
- Remaining slots (before/after, creator UGC, produto em uso, macro textura): prompt sheet in session. Transversal rule: mulher brasileira, cacho real visível, tom de pele quente, pele real (não plástica). Generate via /video-director (hero loop) + Magnific (stills).
- Assets live in `inputs/lp-assets/primer-cachos/`.

## CSS / build conventions
- Mobile-first, breakpoint 768px, base rules before @media overrides.
- No em dashes in any rendered copy. PT-BR. Tagline exact: "no seu tempo, do seu jeito."
- Native theme components where possible; keep above-fold weight < 1MB.

## Tracking (hand to /integrations-engineer — see separate Tracking Brief)
Pixel: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase. CAPI dedup. UTM passthrough to checkout + Shopify order attribution.

## Core Web Vitals budget (launch blockers)
LCP < 2.5s, CLS < 0.1, INP < 200ms on mobile 4G. Hero loop must be poster-framed + lazy, not render-blocking. (Note: PDP loads Loox+Okendo+Yotpo; do NOT stack all three on the LP.)

## Out of scope
- The SEO PDP (leave it; separate fix list in growth-gebeauty-primer-lp-audit-2026-07-03.md).
- Any discount-code mechanic (offer is value-led).
- Liso LP (clone after Cachos is validated).

## Success criteria
- Renders per wireframe on 390px; primary CTA above fold; sticky ATC works.
- Message match intact (H1 vs ad hook).
- CWV inside budget on mobile 4G.
- Tracking verified in Events Manager before paid traffic.

## Review checkpoint
growth-hacker reviews built LP on real mobile + 4G + real UTM BEFORE tracking wire-up. Then /integrations-engineer wires tracking. Then pre-launch checklist. Then paid traffic.

## Decisions locked (post-checkin, 2026-07-03)
- **Approval:** wireframe + hero copy (H1 variant 1) approved as-is.
- **Hero media:** Fernanda Paes Leme footage, gated on a usage-rights check (fallback = owned creator/UGC + Camila before/after).
- **Social proof:** real comments from the Canva comment-ads (`META_CACHOSCOMENTÁRIOS`), NOT the Loox 3.9★/69 aggregate. Do not display the 3.9★ score anywhere.
- **Guarantee/reassurance:** policy-accurate "Troca ou devolução grátis em até 7 dias" from the store return policy. No money-back guarantee claim.
