# GE Beauty — brand-context manifest

The brand-facts manifest for `gebeauty`. Skills read this instead of hardcoding. Schema + rules: `brands/SCHEMA.md`. **`null` = declared absent, never "unknown."** Numbers are dated snapshots with a source; changing a money assumption escalates to Lucas.

> Provenance: economic values extracted from the live source-of-truth files (`gebeauty/growth/params.json`, `cost-basis.json` — both updated 2026-07-22) and `gebeauty/growth/CGO-TEAM.md`. The *soft* numbers (CAC ceiling, repeat baseline) live only in CGO-TEAM prose and are "at current economics" — snapshots to re-derive from Module A, not constants.

> **Notation:** skills reference fields as bare dotted paths in backticks (`economics.profit_floor`), not `{{mustache}}`. Settled 2026-07-31 to match shipped skill behavior.

```yaml
brand:
  slug: gebeauty
  name: "GE Beauty"
  language: pt-BR
  tagline: "no seu tempo, do seu jeito."
  positioning: "Premium Brazilian hair-care; benefit-led, ingredient-as-proof; premium positioning is a hard constraint, not a lever."
voice:
  guide: ".claude/skills/content-director/references/voice.md"   # corpus-grounded
  banned: ["em-dash", "invented numbers", "deep/desperate discounting as a product endorsement"]
  register: "benefit-led; ingredient-as-proof (name an active only when bound to its benefit). NOTE: ingredient-as-proof is THIS brand's rule, not a universal one."
  lexicon: ["idiomatic PT, no calques"]
  claim_canon: ["230°C", "12h", "24h", "72h"]
  cta_default: "soft CTA by default; hard-sell only for the seasonal archetype"
  style_corpus: "Shopify Admin articles, author 'Kelviane Lima' (55 live posts, ~24.6k words, fev-abr 2026)"
  promo_case: "lowercase"
  proof_rule: "ingredient-as-proof — an active is named only when bound to the benefit it delivers"
  shared_defaults: ["no-em-dash", "idiomatic-pt-not-calques", "no-invented-numbers", "real-subjects-only", "confirm-before-writes", "verify-dont-trust", "escalate-money-product-brand"]
personas: ["Marcela (consumer persona)"]
personas_creative: ["Marcela (video persona: faceless + hair-out)"]
visual:
  tokens: null                       # storefront theme; not centralized yet
  guide: null
  logo_rules: "GE red wordmark; never place copy over the ge logo or products; respect the logo clear-zone"
  palette: "GE red #DF3630 primary + the 9-color palette per creative.video.grammar §5, with a per-product accent map (accents are label graphics, NOT bottle body). Take brand color from the design system, never by sampling a render."
  line_colors: null                  # TODO: product-line → brand-color map; needs extraction, do NOT guess
  icon_family: "viewBox 0 0 51 51, outline-as-fill, single-color, illustrative/botanical"
  icon_colorway:
    baked: "#DF3630"
    master: "currentColor"
    why: "the storefront img embed path ignores currentColor, so a baked-red variant is required alongside the master"
economics:
  model: dtc-purchase
  profit_floor: 0.10                 # params.json profit_floor_pct — hard 10% NET floor, per purchase, AFTER media
  cac_ceiling:
    value: 68
    currency: BRL
    as_of: "2026-07"
    source: "CGO-TEAM.md prose ('~R$68/new customer at current economics'); re-derive via module-a/kpi_sweep.py"
  repeat_baseline:
    value: 0.158
    as_of: "2026-07"
    source: "CGO-TEAM.md; re-derive via module-a/kpi_sweep.py"
  currency: BRL
  engine: "gebeauty/growth/module-a/contribution.py (net margin per order) + kpi_sweep.py (CAC/LTV/repeat/cohorts)"
  gate: "Clears the 10% net floor per purchase after media AND marginal CAC stays under the ceiling AND absolute contribution profit rises step over step."
  agency_register: "gebeauty/growth/module-a/agency-challenge-register.md"
  cost_model:
    params: "gebeauty/growth/params.json"          # ALWAYS read at run time; never quote rates from memory
    cost_basis: "gebeauty/growth/cost-basis.json"
    freight_revenue_pct: 0.064
    free_shipping_threshold_brl: 299
    tax_pct: 0.12
    payment_fee_pct: 0.0395
    boniteca_pct: 0.08                              # auto-projected, July 2026 (boniteca_projector.py)
    cogs_pct: 0.149                                 # bottom-up aggregate at full price (params _blended_reference_pct)
    freight_cost_pct: 0.088
    fulfillment_pct: 0.02
    in_flux:
      since: "2026-07-21"
      fields: [freight_cost_pct, fulfillment_pct, freight_revenue_pct]
      action: "confirm rates with Lucas before any margin analysis; report the note's date"
    note: "Costs split ABSOLUTE per-order R$ (freight/fulfillment/packaging + COGS units) vs AD-VALOREM %-of-revenue (tax/payment/boniteca). A discount correctly compresses margin. Use the ABSOLUTE model for per-order/campaign margin; the blended percentages are for blended KPIs only."
  test_budget:                                      # ⚠ UNSOURCED — see Open money questions
    daily_per_cell_brl: [30, 50]
    window_days: [4, 7]
    min_spend_before_kill_brl: 500
    kill_cpa_brl: 120
    funnel_collapse_monthly_brl: 5000
    currency: BRL
    as_of: null
    source: "growth-hacker SKILL.md prose — no date, no derivation. Treat as a placeholder pending Lucas."
commerce:
  platform: shopify
  catalog: "Shopify Admin (live, read at run time) + gebeauty/growth/cost-basis.json (SKU cost/retail)"
  erp: "Omie (JSON-RPC)"
  env: "gebeauty/.env"               # SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_API_VERSION, KLAVIYO_API_KEY, KREA_API_TOKEN, Lalamove, Omie
  segments:
    system: "native Shopify RFM"
    count: 11
    reference: ".claude/skills/crm-director/references/segments.md"
  publish_target: "Shopify Admin via content-director/scripts/publish.py (blog articles + product descriptionHtml); dry-run default, --confirm to mutate; scopes write_products / write_content / write_online_store_pages"
  catalog_notes:
    - "Booster Purificante does not exist"
    - "Melon Mood canonical name is 'Mist', never 'Splash'"
    - "lancto launches excluded from campaign-discount copy"
  catalog_conventions:
    launch_tag: "lancto"
    excluded_prefixes: ["[rappi]", "[brinde]"]
  discount_conventions:
    affiliate_code_pattern: "{NAME}10 (permanent by design)"
    stale_code_names: ["NAMORADOS", "VERAO", "NATAL"]
  theme:
    id: 181379236160
    name: "[Check] - Produção"
    published: true
  scrape_targets: "home · PDP full-size · PDP booster · PDP launch · collection produtos-full-size · cart — see storefront-agent for the per-row 'why'"
  store_notes: "gebeauty/CLAUDE.md"
  merchandising_specs: "docs/dogfood-merchandising.md"
  metafield_map: "gebeauty/video-director/docs/metafield-map.md"
  icon_registry:
    metaobject_type: "icones"
    fields: { image: "imagem", label: "texto", link: "link" }
    must_be_active: true
    asset_naming: "icon-<name>.svg"
design_system:
  profile: shopify-polaris           # the Omnify embedded app surface
  references: ["app/routes/app.retail-sales.tsx", "app/routes/app.local-delivery.tsx", "app/components/tab-icons.tsx", "inputs/mockups/_template.html"]
  lp_hosting: "Shopify theme custom page template"
channels:
  meta: "via CheckCommerce ticket / WhatsApp (external agency executes; audited via the challenge loop)"
  meta_account_id: "606199920079315"
  google: null                       # no Google Ads tooling yet
  tiktok: null                       # test protocol to add as the account matures
  canva: "shared Canva account (creative-producer)"
  magnific: "shared Magnific account (video-director / illustrator / iconographer)"
  krea: "direct-HTTP client gebeauty/scripts/_krea.py, KREA_API_TOKEN in gebeauty/.env (MCP will not connect in-session)"
  zoko: "WhatsApp send engine (retention-machine)"
  klaviyo: "KLAVIYO_API_KEY in gebeauty/.env"
  sms: null                          # no SMS provider wired — confirm before implying one
  gsc: null                          # Search Console not wired; keyword_research.py self-reports
  send_engine: "gebeauty/retention-machine/ — build_disparador_rfm.py (Zoko segmented disparo) · klaviyo_push.py (email, --apply gated) · engine.py (streams A/B/C/D) · BEAUTYBACK: cashback_generate.py / apply_store_credit.py / issue_reactivation.py; cooldown keys min_days_between_messages, max_touches_per_customer"
creative:
  playbook: "docs/creative-ad-image-pipeline.md"
  templates:
    - { name: "META_CACHOS2", platform: meta, sizes: ["4:5", "1.91:1", "1:1", "9:16"] }
    - { name: "PMAX_BODYHAIR_ROSERITUAL", platform: google-pmax, clones: "PMAX_ROSERITUAL_INST_01..07", folder: "Projetos › Criativos › Body & Hair Mists" }
  worked_examples:
    - "gebeauty/imagery/rose-ritual-claims/ROLLOUT-SPEC.md"
    - "gebeauty/imagery/rose-ritual-claims/creatives/MANIFEST.md"
    - ".claude/initiatives/gebeauty-paid-media-scale.md"
  video:
    grammar: "gebeauty/video-director/docs/ip.md"
    grammar_locks: ["faceless + hair-out", "calm-body + kinetic-hook", "invisible-field-via-behavior-only", "9-color palette lock", "tagline lock"]
    persona: "Marcela Costa, 34, BR consumer — faceless + hair-out"
    persona_dims: null               # TODO: create gebeauty/video-director/personas/marcela.json; the locked dimension table currently lives only in the skill body
    banned_nouns: ["field", "bubble", "dome", "boundary", "shield", "barrier", "halo", "aura"]
    aspect_ratio: "9:16"
    duration_seconds: { min: 18, max: 20, per_shot_default: 6 }
    target_platform: "Meta Reels"
    workspace: "gebeauty/video-director/"
    scripts: "gebeauty/video-director/scripts/"
    asset_catalog: "gebeauty/video-director/_SHARED/ASSET-CATALOG.md"
    validation_dir: "gebeauty/video-director/_VALIDATION/"
    material_map: "standard line = opaque cream-bodied plastic, smooth matte, coral-red ge wordmark + label, NOT translucent/frosted/glass; boosters = opaque mint-green dropper; Melon Mood = opaque orange spray"
    product_dim_map: { "150mL": [17, 5, 5], "250mL": [20, 6, 6], "booster": [13, 4], "splash": [16, 5] }   # cm
    screen_placeholders: { names: ["Maria S.", "Eq. Comercial", "Família", "Fornecedor BR"], phones: "never", emails: "never", calendar: ["Meeting", "Sync"] }
    engines: { stills: "Magnific Nano Banana Pro", motion: ["Magnific Seedance 2.0", "Krea Seedance"], physics: "Kling 3.0", fallback: "fal.ai" }
  illustration:
    kit: "docs/defense-kit/README.md"
    icon_library: "docs/defense-kit/icons/"
    deck_template: "docs/defense-kit/defense-deck-template.html"
    output: "docs/defense-kit/"
    engine: null                     # falls back to channels.magnific
  icons:
    engine: "scripts/iconkit.py (+ scripts/calib.json, scripts/proc_a_library.py)"
    output: "gebeauty/imagery/website-icons/"
    reference_set: "4 live institutional icons: fórmulas limpas · não testado em animais · vegano · 100% reciclável"
    source_library: "ICONS FINAIS.ai (18) + ICONS SITE.ai — Drive GB/IMGs"
    standard_doc: ".claude/skills/iconographer/references/icon-standard.md"
roster:
  - growth-office        # orchestrator
  - growth-analyst       # Module A
  - growth-hacker        # paid + LP
  - crm-director         # lifecycle/RFM
  - creative-producer    # still ads
  - video-director       # video
  - content-director     # SEO/PDP/hooks
  - storefront-agent     # on-store promo
  - illustrator
  - iconographer
  - product-developer
  - integrations-engineer
  - design-engineer
  - product-manager
native_delegates:
  design-engineer: [design:accessibility-review, design:design-handoff, design:design-critique]
  content-director: [marketing:seo-audit, marketing:brand-review, marketing:content-creation]
  crm-director: [marketing:email-sequence, marketing:campaign-plan]
  growth-hacker: [marketing:campaign-plan, marketing:performance-report, marketing:competitive-brief]
  growth-analyst: [data:analyze, data:statistical-analysis, data:validate-data, finance:variance-analysis]
  creative-producer: [canva:bulk-create, canva:edit-design, canva:resize-for-social-media, canva:brand-check]
  video-director: [marketing:brand-review]
  # illustrator / iconographer: no native equivalent per brands/skill-confrontation.md — intentionally undeclared.
  # ID ALIASES: Canva/design skills surface both bare and plugin-prefixed (canva:brand-check ==
  # canva:canva-brand-check). Resolve by suffix match; if neither resolves, do the limb inline and say so.
workspace:
  state: "gebeauty/growth/"
  output: "gebeauty/ (per skill)"
  knowledge: "gebeauty/growth/knowledge.md"
  org_charter: "gebeauty/growth/CGO-TEAM.md"
  imagery: "gebeauty/imagery/"
  field_notes: "gebeauty/field-notes.md"
```

## Brand-gate rules (Module F — positioning)

Prefer value-add (free product) over deep % discount wherever brand perception is at stake; a discount is only acceptable framed as an apology/win-back gesture, not a product endorsement. Premium positioning is a hard constraint.

## Cohort isolation

Any campaign with an aggressive acquisition mechanic (free-travel-size "pague só o frete", deep-discount tripwire, buy-X-get-Y loss-leader) is measured as its OWN cohort, segregated from the organic base; success metric is downstream (2nd-purchase / hero-trial / payback), never first-order AOV. Tag at creation. Precedent: Module A excludes the 699 "pague só o frete" orders by default.

## Open money questions (escalated, NOT silently resolved)

1. **Free-shipping threshold conflict.** The old storefront-agent hardcoded **R$199**; `params.json` says **R$299** (`free_shipping_threshold_brl`). This manifest carries 299 (the file wins over skill prose), but the live theme setting has not been checked. storefront-agent now runs a three-way check (theme setting vs live Shopify discount vs cost-model assumption) and escalates any disagreement instead of choosing.
2. **`economics.test_budget` is unsourced.** The R$30-50/day per cell, 4-7 day window, R$500 min-spend, R$120 kill-CPA and R$5k funnel-collapse figures came from skill prose with no date or derivation. They are recorded as a placeholder with `as_of: null`. Bless them with a date+source or replace them.
3. **`visual.line_colors` and `creative.video.persona_dims` are unfilled.** The product-line→color map needs extraction; the Marcela dimension table needs to move from the skill body into a real `personas/marcela.json`. Neither was guessed.
4. **Cost rates in flux since 2026-07-21** (freight cost, fulfillment, freight revenue) per the fulfiller change. Confirm before any margin analysis.
