# brand-context — the contract

The single schema every brand-agnostic skill reads instead of hardcoding brand facts. One manifest per brand, named `brand-context.md`, living **inside that brand's own folder** so it is always reachable in Cowork (folder-local discovery) and travels with the brand.

- GE Beauty → `gebeauty/brand-context.md`
- NAMI Works → `nami/brand-context.md`

This file is the **schema + rules**. The per-brand values live in each manifest. The registry of known brands is `brands/registry.md`.

## Hard rules

1. **`null` means "declared absent," not "unknown."** A skill must branch on `null` and offer the brand-appropriate substitute. It must NEVER invent a value to fill a `null`.
2. **No cross-brand bleed.** A skill may only use facts from the resolved brand's manifest. If a needed field is absent, say so plainly; do not borrow another brand's value (this is the exact failure the refactor exists to kill: applying GE's tagline / 10% floor / Marcela persona to NAMI).
3. **Numbers are dated snapshots, not eternal truth.** Money assumptions (floors, ceilings, fees) carry a `source` and `as_of`. When a skill's decision hinges on one, it cites the snapshot and flags if it looks stale. Changing a money assumption escalates to Lucas.
4. **Method stays in SKILL.md; facts stay here.** SKILL.md references contract fields, never literals. If you find a literal brand fact in a SKILL.md, it belongs in the manifest.

**Notation (settled 2026-07-31):** skills reference fields as **bare dotted paths in backticks** — `economics.cac_ceiling` — not `{{mustache}}`. The mustache form was the original sketch; shipped skills use bare paths, so bare paths win.

**Native-skill ID aliases:** Anthropic plugin skills surface under two forms depending on surface — `canva:brand-check` and `canva:canva-brand-check` both refer to the same skill. Resolve a `native_delegates` entry by **suffix match**, and if neither form resolves (or the plugin's MCP is unauthorized), do the limb inline and say so. Never block a run on a missing native skill.

## Brand resolution (replaces the silent GE default)

Order, first hit wins:

1. Explicit `--brand <slug>` in the invocation.
2. Inferred from the connected folder / repo that contains a `brand-context.md`.
3. **Ask the user.** Never assume.

If the resolved brand lacks a capability a skill needs, the skill names the gap and offers the brand-appropriate substitute (e.g. lead-gen cost gate instead of net-margin floor).

## The field contract

```yaml
brand:
  slug:                # nami | gebeauty  (unique key; matches folder + registry)
  name:                # display name
  language:            # e.g. pt-BR
  tagline:             # exact string, or null
  positioning:         # one-line market position
voice:
  guide:               # path to the authoritative voice doc (source of truth)
  banned: []           # hard bans (e.g. em-dash, hype punctuation, hard pricing)
  register:            # who-to-whom, pronoun stance
  lexicon: []          # say-this-not-that
  claim_canon: []      # the approved claim figures, or null
  cta_default:         # default CTA posture
  style_corpus:        # the writing corpus to calibrate against, or null
  promo_case:          # promo-copy casing rule, or null
  proof_rule:          # how proof is stated (and anonymized), or null
  pillars: []          # messaging pillars, or []
  shared_defaults: []  # rules inherited from brands/shared-defaults.md, explicitly declared
visual:
  tokens:              # path to CSS/token source, or null
  guide:               # path to visual guide, or null
  logo_rules:          # or null
  icon_family:         # spec string, or null   (gebeauty: "viewBox 0 0 51 51")
personas: []           # named personas, or []   (gebeauty: Marcela · nami: the operator)
economics:
  model:               # dtc-purchase | lead-gen
  profit_floor:        # decimal or null         (gebeauty: 0.10)
  cac_ceiling:         # {value, currency, as_of, source} or null
  repeat_baseline:     # {value, as_of, source} or null
  currency:            # ISO or null
  engine:              # path to the economics engine, or null
  gate:                # the go/no-go economic test in words (per model)
  agency_register:     # path to the media-agency challenge register, or null
  cost_model:          # {params, cost_basis, per-line rates, in_flux:{since,fields,action}} or null
                       # ALWAYS read the params file at run time; never quote a rate from memory
  test_budget:         # {daily_per_cell, window_days, min_spend_before_kill, kill_cpa, ...} or null
                       # every figure carries as_of + source; an unsourced figure is a placeholder
commerce:
  platform:            # none | shopify
  catalog:             # path/source, or null
  erp:                 # e.g. Omie, or null
  env:                 # path to the tenant .env, or null
  segments:            # {system, count, reference} or null  (gebeauty native RFM: 11)
  publish_target:      # where content publishes, or null
  catalog_notes: []    # known catalog traps (non-existent SKUs, canonical names), or null
  catalog_conventions: # {launch_tag, excluded_prefixes} or null
  discount_conventions:# {affiliate_code_pattern, stale_code_names} or null
  theme:               # {id, name, published} or null
  scrape_targets:      # the touchpoint URL set, or null
  store_notes:         # per-store notes doc, or null
  merchandising_specs: # merchandising spec doc, or null
  metafield_map:       # metafield mapping doc, or null
  icon_registry:       # {metaobject_type, fields, must_be_active, asset_naming} or null
design_system:
  profile:             # brand-tokens | shopify-polaris
  references: []       # per-property reference implementations
  lp_hosting:          # where landing pages live, or null
channels:              # meta / meta_account_id / google / tiktok / canva / magnific / krea /
                       # zoko / klaviyo / sms / gsc / send_engine → handle or null
creative:              # creative-production bindings (added 2026-07-31 by the creative migrations)
  playbook:            # canonical pipeline doc, or null
  templates: []        # per-platform ad templates (name, platform, sizes, clones, folder)
  worked_examples: []  # prior builds worth reading before a new one
  video:               # grammar, grammar_locks, persona, persona_dims, banned_nouns, aspect_ratio,
                       # duration_seconds, target_platform, workspace, scripts, asset_catalog,
                       # validation_dir, material_map, product_dim_map, screen_placeholders, engines
  illustration:        # kit, icon_library, deck_template, output, engine
  icons:               # engine, output, reference_set, source_library, standard_doc
roster: []             # which skills operate for THIS brand (per-brand org chart)
                       # roster._excluded: {skill: reason} — why a skill does NOT apply to this brand
native_delegates:      # per policy "keep + delegate": which Anthropic native skills each director leans on
  <skill>: [native-skill, ...]
workspace:
  state:               # scratch/state dir, or null
  output:              # deliverable dir, or null
  knowledge:           # knowledge base path, or null
```

## `native_delegates` — the confrontation outcome

Policy (set by Lucas 2026-07-31): **keep + delegate to native limbs.** Our directors stay; they hand generic sub-tasks to Anthropic native skills rather than reimplementing them. This map records, per brand, which native skills a director may call. It is per-brand because a brand may not have a plugin installed. If a listed native skill is unavailable at runtime, the director falls back to its own inline method and notes it. Full rationale + the 24-skill matrix: `brands/skill-confrontation.md`.

## Shared defaults

Genuinely cross-brand rules (both GE Beauty and NAMI ban em-dashes; both write idiomatic PT-BR, not calques) live in `brands/shared-defaults.md`. A manifest inherits them by listing them in `voice.shared_defaults` — **declared, never assumed.**
