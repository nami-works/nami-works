# Session Handoff — 2026-07-31 — Make the skill roster brand-agnostic

**Target surface:** Claude Cowork — written to stand alone. You will NOT have Claude memory auto-loaded and CLAUDE.md is not guaranteed, so everything you need is inlined below. Do not go looking for memory files.

**Scope agreed with Lucas:** the **growth + creative roster (11 skills) is the PILOT**, not the end state. The intent is a **full makeover of the entire skill set**, converted **on demand** — as each remaining skill is next needed for real work, it gets migrated to the same pattern rather than waiting for a big-bang sweep. So build the pattern to be cheap to apply repeatedly: the pilot's job is to prove a template that a future session can run against any skill in one pass.

---

## Why this work exists (the trigger)

In the prior session Lucas asked for a new NAMI Works landing-page flow "using `/growth-office` and `/design-engineer`." Both skills loaded and both were **structurally unable to run for NAMI without improvisation**, because they are written as if GE Beauty / the Omnify Shopify app are the only possible subjects.

Concretely, on invocation `/growth-office` instructed: read `gebeauty/growth/CGO-TEAM.md`, read `.claude/initiatives/gebeauty-chief-growth-office.md`, pull Module A economics, gate against a **10% net-profit floor** and a **~R$68/new-customer CAC ceiling**. For NAMI none of those files exist, and none of those numbers apply: **NAMI is a B2B services business whose conversion is a lead, not a DTC purchase.** `/design-engineer` similarly mandates Shopify Polaris as the design language and cites `app/routes/app.retail-sales.tsx` as the reference implementation, while NAMI's site is a static **Astro marketing site**.

The agent had to silently improvise around both. That is the bug: **the method is reusable, but it is welded to one brand's facts.**

---

## Findings — the actual diagnosis

### Finding 1: three layers are conflated into one file

Every roster skill mixes these together in prose, with no separation:

| Layer | Reusable? | Examples in current skills |
|---|---|---|
| **Method** | Yes, fully | intake loop (frame → gate → decompose → delegate → verify → report), mockup-first, Phase 3.5 state matrix, hide-don't-disable, "verify, don't trust the agency", approval gates |
| **Brand facts** | No, per brand | tagline `no seu tempo, do seu jeito.`, Marcela persona, 9-color palette, banned-noun list, ingredient-as-proof, 11 RFM segments, "faceless + hair-out" |
| **Infra bindings** | No, per property | `gebeauty/.env`, `gebeauty/growth/module-a/contribution.py`, `app/routes/app.retail-sales.tsx`, `docs/defense-kit/`, `inputs/mockups/_template.html`, Canva/Magnific/Zoko accounts |

The **method is the real IP and it is 100% brand-agnostic.** It is currently unusable for a second brand only because it is glued to layers 2 and 3.

### Finding 2: the dangerous failure mode is the silent default

Skills don't ask which brand they're operating on; they assume GE Beauty. For NAMI that risks **silently applying GE's tagline, Marcela persona, 10% floor, R$68 CAC ceiling, and "ingredient-as-proof" grammar to a B2B AI-services brand.** Wrong output that looks confident is worse than a refusal. There is no brand-resolution step anywhere in the roster.

### Finding 3: hardcoded volatile numbers are a bug *even for GE Beauty alone*

These are baked into prose across multiple files:

- `10% net floor` — appears in **growth-analyst, growth-hacker, crm-director, content-director, creative-producer**
- `R$68/new customer` CAC ceiling — growth-analyst, growth-hacker
- `R$120 / R$500 / R$5 / R$30` — growth-hacker
- `11 segments` — crm-director
- `8-figure` / `8 dígitos` — proof claims
- `9:16`, `18-20s` — video-director; `viewBox 0 0 51 51` — iconographer

When GE's CAC ceiling moves, **five files silently disagree** and there is no single source of truth. So extracting these into a manifest is not a multi-brand tax — **it makes GE Beauty strictly better too.** This is the "equally or even more enabled" part of Lucas's question, and it's the strongest argument for the refactor.

### Finding 4: cross-skill coupling assumes one org chart

`/growth-office` delegates to a fixed roster read from `gebeauty/growth/CGO-TEAM.md`. NAMI's roster is genuinely different: **no store → no `/storefront-agent`; no RFM base → no `/crm-director` yet.** The roster itself is per-brand data, not a constant.

### Finding 5: absence must be representable

NAMI has **no CAC ceiling, no Shopify catalog, no ERP-backed RFM segments, no product SKUs.** Today a missing input reads as "file not found" and the skill stalls or improvises. A brand must be able to declare a capability **absent**, and the skill must degrade gracefully — e.g. `/growth-office` must accept "this brand's gate is qualified-lead cost + close rate, not net margin per order" instead of blocking on Module A.

### Finding 6: one precedent already exists — copy it

`/digest` already solves this: it defaults to GE's knowledge base **but accepts `--into <path>`** to target another. That is the pattern to generalize (with one fix: prefer *explicit resolution* over a silent GE default).

---

## The proposed architecture (recommendation, not yet built)

### A. Per-brand manifest

One file per brand, e.g. `brands/<slug>/brand.yml` (or `<connected-folder>/brand-context.md`). Skills read it instead of hardcoding. Suggested contract — the union of what the roster actually needs:

```yaml
brand:
  slug: nami | gebeauty
  name: "NAMI Works"
  language: pt-BR
  tagline: "Opere seu negócio com inteligência, muito além do chat de IA."
  positioning: "…"
voice:
  guide: voice-tone.md          # the authoritative voice doc
  banned: ["em-dash", "hype punctuation", "hard pricing"]
  register: "operator-to-operator, nós/a gente, supervision always visible"
  lexicon: [...]                 # say-this-not-that
visual:
  tokens: site/src/styles/global.css
  guide: site/BRAND.md
  logo_rules: "two-mark rule: detailed ≥24px, simplified glyph below"
  icon_family: null              # gebeauty: viewBox 0 0 51 51
personas: [...]                  # gebeauty: Marcela · nami: the operator
economics:
  model: lead-gen | dtc-purchase
  profit_floor: null             # gebeauty: 0.10
  cac_ceiling: null              # gebeauty: R$68/new customer
  currency: BRL
  engine: null                   # gebeauty: growth/module-a/contribution.py
commerce:
  platform: none | shopify
  catalog: null
  erp: null                      # gebeauty: Omie
  env: null                      # gebeauty: gebeauty/.env
channels: { meta: …, canva: …, magnific: …, zoko: null }
design_system:
  profile: brand-tokens | shopify-polaris
  references: [...]              # per-property reference implementations
roster: [growth-analyst, growth-hacker, content-director, …]   # per brand
workspace: { state: …, output: …, knowledge: … }
```

**Key rule: `null` means "declared absent," not "unknown."** Skills must branch on it, never invent a value.

### B. Brand resolution (replaces the silent default)

Order, first hit wins:

1. Explicit `--brand <slug>` in the invocation.
2. Inferred from the connected folder / repo containing a `brand.yml`.
3. **Ask the user.** Never assume.

If a skill's required capability is absent for that brand, say so plainly and offer the brand-appropriate substitute (e.g. lead-gen gate instead of net-margin gate).

### C. Split each SKILL.md into method + bindings

- **SKILL.md** = method only, brand-neutral, references contract fields (`{{brand.tagline}}`, `{{economics.cac_ceiling}}`) rather than literals.
- **`references/<brand>-bindings.md`** = the per-brand paths, reference implementations, account names.

This keeps one skill (no forks, no drift) and makes adding brand #3 a matter of writing one manifest.

### D. Shared defaults, explicitly declared

Some rules are genuinely shared (both GE Beauty and NAMI ban em-dashes; both write idiomatic PT-BR, not calques). Put these in a shared default the manifest can inherit or override — but **declare them, don't assume them**.

---

## What's pending (all of it — nothing was built)

**No skill files were modified in the prior session.** The work is entirely ahead of you. Suggested order:

1. **Write the contract + two manifests.** Draft the field list above, then fill `brands/gebeauty/brand.yml` (extract every hardcoded number/path listed in Finding 3) and `brands/nami/brand.yml`. Get Lucas to confirm GE's real current numbers — **do not copy the values in this handoff as truth; they may be stale.**
2. **Pilot `/growth-office`.** Add brand resolution, replace Module A hardcoding with `economics.*`, make the roster read from `roster`, make the gate degrade to lead-gen when `profit_floor: null`.
3. **Pilot `/design-engineer`.** Swap Polaris-as-default for `design_system.profile`; move the Omnify route table into per-property bindings; **keep mockup-first, the state matrix and hide-don't-disable untouched** (that's the transferable IP).
4. **Validate both** (see acceptance test below) before touching the other nine.
5. **Roll out across the pilot roster:** growth-analyst, growth-hacker, crm-director, content-director, creative-producer, video-director, illustrator, iconographer, storefront-agent.
6. **Update `/setup`** — it onboards the toolset and currently assumes GE accounts.
7. **Write the migration template** so the rest of the set can be converted **on demand**. Once the pilot settles the pattern, capture it as a short, repeatable checklist (what to extract, what to leave alone, which contract fields to add, how to validate) so any future session can migrate a skill it happens to be using, in one pass, without re-deriving the architecture. Remaining candidates in rough priority: `integrations-engineer` (108 brand refs), `shopify-submission` (106), `b2b-proposta`, `product-developer`, `product-manager`, `dogfood`, `storefront-agent`, then the already-clean utilities (`docx`/`pdf`/`pptx`/`xlsx` need only light path work). **Do not migrate these preemptively** — convert when touched.

### Acceptance test (this is the definition of done)

For each refactored skill, run it twice:

- **`--brand gebeauty`** → behavior and numbers **identical to today** (pure regression; if GE output changes, the refactor is wrong).
- **`--brand nami`** → runs to completion **without inventing a single GE fact**, and explicitly names any capability NAMI lacks.
- **No brand specified** → **asks**; never silently defaults.

---

## How to actually edit skills in Cowork (read this before you start)

**Critical constraint:** in Cowork the skill directory is a **read-only cache**. Editing `SKILL.md` on disk does nothing to the user's saved skill. You must call **`mcp__cowork__save_skill` with `overwrite: true`**, passing the full new skill content, once per skill.

- Read-only cache path this session: `/sessions/<session>/mnt/.claude/skills/<name>/SKILL.md`
- You can freely **read** the current skills there to work from.
- There is no bulk/batch edit. **11 skills = 11 `save_skill` calls.**
- Because these skills are long (video-director's SKILL.md is ~1500 lines), a full-content rewrite per skill is heavy. **Recommend to Lucas that the bulk rollout (step 5) happen in a Claude Code session**, where files can be edited in place and committed. Cowork is fine for the pilot (steps 1–4).

---

## Current state

- **Nothing to verify** — no code or skill changes were made. This is a plan-only handoff.
- The **evidence** in Findings 1–6 was gathered empirically by grepping the skill cache; re-run the greps if you want to confirm counts before editing.
- Most brand-coupled skills by reference count: creative-producer (168), video-director (137), integrations-engineer (108), shopify-submission (106), growth-hacker (75). Cleanest already: skill-creator, session-merge, schedule, morning, handoff, consolidate-memory (all 0).

---

## Context you need (inlined — Cowork has no memory)

**NAMI Works, in brief.** A Brazilian B2B company that implements and operates AI *inside* companies' real systems (ERP, ecommerce, custom apps) and trains their people to work with it. Tagline: *"Opere seu negócio com inteligência, muito além do chat de IA."* Positioning: leads commercial (a buyable service) with operator empathy underneath ("we know this pain because we run operations too"). Audience is deliberately **broad** — any systems-heavy business, not a vertical. Proof lives in real Brazilian operations including an 8-figure ecommerce one, **kept anonymous publicly** ("uma marca de e-commerce de 8 dígitos"). Five messaging pillars: operating-not-chatting · **both sides merged** (train the AI *and* the people) · tailor-made-not-templated · proven-in-the-trenches · supervised autonomy.

**NAMI brand docs already exist** in the connected `nami/` folder and are the source of truth: `brand-foundation.md` (strategy/positioning/pillars), `voice-tone.md` (voice guide, **fully PT-BR**, edited by Lucas himself — treat his wording as final), `site/BRAND.md` (visual system), `site/brand-guide.html` (rendered visual companion), `creative-hooks.md` (two registered ad-hook ideas). NAMI's visual tokens live in `site/src/styles/global.css`; the site is **Astro, static, PT-BR only**.

**NAMI voice rules that differ from GE Beauty's** (both matter for content/creative skills): `nós / a gente` collective voice and never a named individual; **no travessão/em-dash anywhere**; sentence case except the uppercase kicker; **no hard pricing** (always "orçamento fechado, definido depois do intake"); supervision always visible when describing autonomy; if automation is mentioned, the people trained must be mentioned too; proprietary vocabulary is the **chatters → tweakers → operadores** framing.

**Things that look wrong but are intentional.** GE Beauty and NAMI *both* ban em-dashes — that's convergence, not a copy-paste error. `/design-engineer`'s state matrix and hide-don't-disable rules exist because of a real shipped bug (the local-delivery Confirm "ghost control"); **preserve them verbatim** — they are the skill's most valuable content and are entirely brand-neutral.

**Traps.** (1) Don't "fix" GE Beauty's numbers while refactoring — extract them as-is and have Lucas confirm; they're money assumptions and escalating beats guessing. (2) Don't fork a skill per brand; forks drift, which is the whole problem. (3) `/growth-office` explicitly forbids doing the specialists' work — keep that boundary. (4) The nami folder is **not a git repo**, so there's no branch/PR ceremony for the brand docs.

**Decision delegated to you: where manifests live.** Lucas explicitly handed this call to the session doing the work, so **decide it yourself, document the reasoning in the pilot, and move on** — do not bounce it back to him. The two candidates:

- **Central `brands/<slug>/brand.yml` in the monorepo** — one place, versioned together, easy to diff across brands, and a skill can enumerate all known brands. Weaker in Cowork, where only the connected folder is reachable, so a NAMI-only session may not see it.
- **Per-brand `brand-context.md` inside each brand's own folder** — travels with the brand, always reachable in Cowork, and brand-resolution-by-connected-folder falls out naturally. Costs you the central view and risks per-brand format drift.

A hybrid is legitimate: manifest lives with the brand, and the monorepo keeps the **contract/schema** plus a registry of known slugs. Whatever you pick, make brand resolution work in Cowork (folder-local discovery) since that's where these skills are increasingly used.

---

## Delivery note

This handoff was written **from a Cowork session against a non-git connected folder**, so it was **not committed or pushed to origin**. It lives at `nami/handoff-skill-multibrand.md` in the connected folder. If you want it in git history, a Claude Code session must commit it.
