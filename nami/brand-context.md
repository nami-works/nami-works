# NAMI Works — brand-context manifest

The brand-facts manifest for `nami`. Skills read this instead of assuming GE Beauty. Schema + rules: `brands/SCHEMA.md` (in the monorepo). **`null` = declared absent, never "unknown."** A skill hitting a `null` must name the gap and offer the lead-gen-appropriate substitute — it must NEVER borrow a GE Beauty value.

> Source of truth: `nami/brand-foundation.md` (strategy/pillars), `nami/voice-tone.md` (voice — fully PT-BR, edited by Lucas; his wording is final), `nami/site/BRAND.md` (visual system), `nami/creative-hooks.md`. This folder is NOT a git repo.

> **Notation:** skills reference fields as bare dotted paths in backticks (`economics.model`), not `{{mustache}}`. Settled 2026-07-31.

```yaml
brand:
  slug: nami
  name: "NAMI Works"
  language: pt-BR
  tagline: "Opere seu negócio com inteligência, muito além do chat de IA."
  positioning: "B2B: designs and runs AI-native operating systems inside a company's real tools (ERP, ecommerce, custom apps), within their policies and goals. Broad audience (any systems-heavy business), operator-empathy underneath a productized offer."
voice:
  guide: nami/voice-tone.md
  banned:
    - "em-dash / travessão (use comma, period, or parentheses)"
    - "hard pricing (always 'orçamento fechado, definido depois do intake')"
    - "hype punctuation (!!!), near-zero emoji"
    - "English marketing lines on public surfaces (except BR-adopted terms: copy, growth, e-commerce)"
    - "a named individual / 'eu' (voice is collective)"
    - "invented or rounded numbers"
    - "claiming AI runs unsupervised"
  register: "operator-to-operator ('nós / a gente'), pain-first then proof then offer; calm and precise; humor lives in the mascot, never in loud copy. Sentence case except the 11px uppercase kicker."
  lexicon:
    - "IA que opera / dentro dos seus sistemas  (not: solução de IA, plataforma)"
    - "sob medida, dentro do seu ERP  (not: revolucionário, disruptivo, de ponta)"
    - "opere seu negócio com inteligência  (not: transforme seu negócio)"
    - "trabalha com o seu time, a gente treina as pessoas  (not: automatize/substitua seu time)"
    - "supervisionado, com gente no loop  (not: 100% automático, sem esforço)"
    - "proprietary framing: chatters → tweakers → operadores"
  claim_canon: null                  # no product claim set; proof is voice.proof_rule
  cta_default: "pain-first, then proof, then offer; the CTA is the intake/diagnóstico, never hard pricing"
  style_corpus: null                 # calibrate from nami/voice-tone.md
  promo_case: null
  proof_rule: "Real Brazilian operations incl. an 8-figure ecommerce one, kept ANONYMOUS in public — reference only as 'uma marca de e-commerce de 8 dígitos'."
  shared_defaults: ["no-em-dash", "idiomatic-pt-not-calques", "no-invented-numbers", "real-subjects-only", "confirm-before-writes", "verify-dont-trust", "escalate-money-product-brand"]
  pillars:
    - "Operating, not chatting"
    - "Both sides, merged (train the AI AND the people)"
    - "Tailor-made, not templated"
    - "Proven in the trenches"
    - "Supervised autonomy"
personas: ["the operator (collective 'nós / a gente'; never a named individual)"]
personas_creative: ["monkey-in-goggles mascot (carries the personality; type/palette/copy stay restrained around it)"]
visual:
  tokens: nami/site/src/styles/global.css
  guide: nami/site/BRAND.md          # rendered companion: nami/site/brand-guide.html
  logo_rules: "Two-mark rule: detailed mark ≥24px (mark-*.png), simplified glyph below 24px (favicon-glyph*.png). Match accent tone to theme (mark-accent on light, mark-accent-dark on dark). Accent files are named *-accent*, never after the colour, so a palette change touches pixels not paths. No recolor outside the 5 approved files, no glow/gradient/shadow, no copy over the mark or another logo. Clear-space ≥50% of mark height."
  palette: "warm off-white #faf8f4 + ink #1c1b19 + one pinheiro-green accent (#1b4d2e light / #5fb87f dark). Accent changed from forest teal to pinheiro on 2026-08-02; both clear WCAG AA (9.22 light text, 7.52 dark). No purple/blue/gradient — those belong to the sibling omnify-site and must never cross over."
  line_colors: null
  type: "Geist (variable 400-700), self-hosted. Sentence case except the 11px uppercase eyebrow."
  icon_family: null                  # no icon family standard yet — iconographer must ASK, not emit GE-shaped icons
  icon_colorway: null
economics:
  model: lead-gen
  profit_floor: null                 # NAMI is not DTC-purchase; the 10% net-margin-per-order floor does NOT apply
  cac_ceiling: null                  # no DTC CAC ceiling; do NOT apply GE's ~R$68
  repeat_baseline: null
  currency: BRL
  engine: null                       # no Module A; contribution.py does not model a services sale
  gate: "Conversion is a QUALIFIED LEAD, not a purchase. Economic test = cost per qualified lead vs close rate and services LTV, not net margin per order. When a skill wants a profit floor, substitute this lead-gen gate; never invent a margin number."
  agency_register: null
  cost_model: null                   # no per-order cost model; services costing is TBD with Lucas
  test_budget: null                  # lead-cost target to be set with Lucas before any spend
commerce:
  platform: none
  catalog: null                      # no product SKUs; the offer is two service lines (implementation + ecommerce operation)
  erp: null
  env: null
  segments: null                     # no ERP-backed RFM base — do NOT fabricate RFM segments
  publish_target: null               # static Astro site; deliver files and hand to design-engineer
  catalog_notes: null
  catalog_conventions: null
  discount_conventions: null
  theme: null
  scrape_targets: null
  store_notes: null
  merchandising_specs: null
  metafield_map: null
  icon_registry: null                # no Shopify Files upload path, no icones metaobject
design_system:
  profile: brand-tokens              # static Astro marketing site + CSS custom properties (NOT Shopify Polaris)
  references: ["nami/site/BRAND.md", "nami/site/src/styles/global.css", "nami/site/brand-guide.html"]
  lp_hosting: "nami/site — Astro route (static)"
channels:
  meta: null                         # paid not running yet (creative-hooks are ideas, not live) — no agency exists
  meta_account_id: null
  google: null
  tiktok: null
  canva: null
  magnific: null
  krea: null
  zoko: null
  klaviyo: null                      # NAMI has no Klaviyo. A Klaviyo MCP has appeared in sessions; ownership UNVERIFIED and possibly GE Beauty's. Never use it for NAMI without confirming ownership first.
  sms: null
  gsc: null
  send_engine: brevo                 # CHOSEN 2026-08-01 (free tier: 100k contacts, 300 emails/day, v3 API + double opt-in). NOT YET PROVISIONED: no account, no API key, no list. Do NOT attempt a send or claim a send path works until provisioned. Integration pattern: LP form -> existing Lambda Function URL -> Brevo v3 API (server-side), per the site wall rule "the Lambda Function URL is the only form action."
  send_engine_status: chosen-not-provisioned
creative:
  playbook: null
  templates: null
  worked_examples: null
  video:
    grammar: null
    grammar_locks: null
    persona: "monkey-in-goggles mascot"     # mascot, NOT a human persona — disables the hand/jewelry/wardrobe machinery
    persona_dims: null
    banned_nouns: null
    aspect_ratio: null                      # ask; do not assume 9:16
    duration_seconds: null
    target_platform: null
    workspace: null
    scripts: null
    asset_catalog: null
    validation_dir: null
    material_map: null
    product_dim_map: null                   # no physical product to anchor
    screen_placeholders: null
    engines: null
  illustration:
    kit: null                               # no defense kit — ask where imagery should live
    icon_library: null                      # everything is one-off
    deck_template: null
    output: null
    engine: null
  icons:
    engine: null
    output: null
    reference_set: null
    source_library: null
    standard_doc: null
roster:                                 # NAMI's org chart — genuinely different from GE's
  - growth-office        # orchestration (gate degrades to lead-gen)
  - growth-hacker        # paid acquisition → leads + LP
  - content-director     # site copy / SEO / social
  - creative-producer    # still ad hooks (mascot-led)
  - video-director       # motion hooks
  - design-engineer      # site/app design (brand-tokens profile)
  - illustrator          # mascot / concept imagery
  - product-developer
  - integrations-engineer
  - product-manager
  _excluded:
    storefront-agent: "no store (commerce.platform: none)"
    crm-director: "still excluded, but the reason narrowed 2026-08-01: a send engine is now chosen (Brevo, unprovisioned). Blocker is now commerce.segments: null — no segmentation base to message against. Revisit once Brevo is live AND there is a real contact base."
    growth-analyst: "no DTC Module A engine; lead-gen measurement is TBD, not net-margin-per-order"
    iconographer: "no icon family standard (visual.icon_family: null) and no Shopify Files path"
    b2b-proposta: "GE Excel simulator only"
native_delegates:
  design-engineer: [design:accessibility-review, design:design-handoff, design:design-critique, figma:figma-design-to-code]
  content-director: [marketing:seo-audit, marketing:brand-review, marketing:content-creation]
  growth-hacker: [marketing:campaign-plan, marketing:performance-report, marketing:competitive-brief]
  creative-producer: [canva:bulk-create, canva:edit-design, canva:resize-for-social-media, canva:brand-check]
  video-director: [marketing:brand-review]
  # ID ALIASES: Canva/design skills surface both bare and plugin-prefixed (canva:brand-check ==
  # canva:canva-brand-check). Resolve by suffix match; if neither resolves, do the limb inline and say so.
  # NOTE: the Canva MCP requires authorization; if unauthorized, creative-producer falls back to inline mechanics.
workspace:
  state: "nami/"
  output: "nami/ (per skill)"
  knowledge: null                        # no dedicated knowledge base yet
  org_charter: null                      # the roster above IS the org chart
  imagery: null
  field_notes: null
```

## Absent-capability crib (what a skill should say instead of stalling)

- **net-margin gate / 10% floor** → "NAMI is lead-gen; the gate is cost-per-qualified-lead vs close rate and services LTV, not net margin per order."
- **CAC ceiling (R$68)** → "No DTC CAC ceiling exists for NAMI; use a lead-cost target set with Lucas."
- **Module A / contribution.py** → "There is no Module A for this brand. Running GE scripts or quoting GE's floor/ceiling/baseline is forbidden, even as a benchmark or order of magnitude."
- **Shopify catalog / SKUs / RFM segments / Omie** → "NAMI has no store, catalog, ERP, or RFM base; the offer is two service lines."
- **Polaris design language** → "NAMI's site is a static Astro marketing site on brand-tokens; use `site/BRAND.md`, not Polaris."
- **Marcela / GE tagline / ingredient-as-proof / 9-color palette / banned-noun list** → GE facts. NAMI's persona is the collective operator (mascot in creative), tagline is above, proof is anonymized real operations.
- **icon family (viewBox 0 0 51 51)** → "No family standard exists; ask for canvas/construction/weight/register/colorway before drawing anything."
- **media agency** → "`channels.meta` is null: there is no agency, no ticket route, and no challenge loop. This is first-campaign design plus tracking prerequisites."
