# Making a Living on the AI Efficiency Wave — Business Case + Blueprint

**Prepared:** 2026-07-29 · **For:** Lucas Guimarães · **Vehicle:** NAMI Works / CPG Labs
**Question:** consultancy vs. AI-operated ecommerce vs. AI content — where and how to start?

---

## 0. The one-line answer

You are not choosing between three business ideas. They are three layers of **one business you have already built and are already running** — you just haven't been selling it to anyone but yourself.

- **AI-enabled operation of online businesses is the product.** GE Beauty is customer #0 and the proof. This repo — 17 active initiatives, ~30 custom skills, a growth office with margin-true measurement, legal review, ERP/logistics integrations, deployed production software — *is* the product.
- **Consulting is the packaging and the wedge.** It's how a brand pays you cash upfront before trusting you with operations.
- **Content is the distribution.** It's how brands find you, and the PT-BR practitioner niche is nearly empty. It is not, on the evidence, a livelihood by itself on any acceptable timeline.

**Recommended identity: "We run ecommerce brands on AI"** — an AI-native operating company for Brazilian DTC/CPG brands — not "AI consultant" (commoditizing) and not "AI creator" (power-law lottery).

---

## 1. What you actually have (asset inventory)

The honest business case starts from assets, not from zero. From this repo and memory:

| Asset | Evidence | Business meaning |
|---|---|---|
| **A working AI operations control center** | `gebeauty/**`: catalog, orders, local delivery routing, B2B channels, freight modeling, campaign builds via Meta API, LP production, CRM sends, legal contract review, OKR culture kit | The core product exists and is battle-tested on a real R$16M-revenue brand |
| **A codified playbook library** | ~30 custom skills: growth-office, growth-analyst, growth-hacker, crm-director, content-director, creative-producer, video-director, integrations-engineer, tenant-onboarding-engineer, legal-review, b2b-proposta, email-copilot, illustrator, iconographer… | This is the moat. Anyone can buy Claude; nobody else has these playbooks + your operating record |
| **Production software** | mcp.nami.works connector, Omnify Shopify app family (app/omnify/flywheel.cpg-labs.io), cpg-labs.io site | Multi-tenant-capable surfaces (single-tenant pivot is reversible); real deploys, real infra |
| **A corporate vehicle + brand architecture** | NAMI Works (parent) → CPG Labs (vertical brand) → per-tenant skins; MSA/legal playbook already exists | You can sign clients tomorrow; brand model was designed for exactly this |
| **A tenant #2 pipeline** | Bisyou diligence: conditional GO, licensing + royalty structure modeled (royalty ceiling math, break-even R$6.36M net, gates defined), advisor engaged | The expansion motion has already been rehearsed end-to-end |
| **Measurement discipline** | Module A (contribution/order, CAC ceilings, cohort payback, challenge loop vs. the media agency) | The single rarest capability in the agency market — margin-true accountability |
| **Operator credibility + bilingual reach** | GE Beauty COO; PT/EN | You can sell in Brazil and publish globally |
| **Multi-client operating system** | initiatives files, work-orders protocol, handoff/recap/board skills, deploy queue, worktree protocol | The coordination layer that makes 3–5 simultaneous clients feasible for one person |

**The gap is not product. The gap is that nothing here is packaged, priced, or visible to anyone but you.**

---

## 2. Market evidence (researched 2026-07)

### 2.1 Consulting / implementation

- Solo/boutique AI consultant rates 2026: **$75–300/hr** independent; **SMB implementations $10–15k**; **retainers $5–15k/mo** (fractional-CAIO tier; broader range $2–50k/mo); strategy sprints $25–75k. ([nicolalazzari.ai](https://nicolalazzari.ai/guides/ai-consultant-pricing-us), [thecrunch.io](https://thecrunch.io/ai-consultant-cost/), [foundersworkshop.com](https://foundersworkshop.com/feeds/blog/ai-enterprise-consulting-rates-500))
- Brazil consulting rates: **R$200–1,000/h**; digital agency retainers **R$1.5k–25k/mo**. ([portalinsights](https://www.portalinsights.com.br/perguntas-frequentes/quanto-cobrar-por-uma-loja-na-shopify))
- **Brazil demand gap:** 72% of Brazilian companies are at beginner/experimental AI stage; only **22% of SMEs use AI in a structured way**; **53% say AI matters but they don't know how to implement**; 38% admit to spreadsheet-and-key-person operations. Marketing + customer service lead adoption (~24%). ([tiinside](https://tiinside.com.br/en/16/01/2026/72%25-of-Brazilian-companies-are-still-in-the-early-stages-of-adopting-AI./), [G4/ecommerceupdate](https://www.ecommerceupdate.com.br/en/so-22-das-pmes-usam-ia-de-forma-estruturada-no-brasil-aponta-estudo-do-g4/))
- **Claude Partner Network** (launched 2026-03, $100M commitment): free to join, explicitly open to boutique specialist firms with delivery capability (NAMI Works qualifies; individual freelancers do not — the entity matters). Benefits: Claude Certified Architect certification, partner directory listing, Applied-AI engineer support on live deals, co-selling. ([lowcode.agency](https://www.lowcode.agency/blog/claude-partner-network-worth-it), [Washington Post](https://www.washingtonpost.com/wp-intelligence/ai-tech-brief/2026/06/16/claude-partner-program-creates-an-ecosystem-around-anthropics-ai-models/))
- **Failure mode to avoid:** generic "AI consultant" is commoditizing fast (big firms moving down-market, tools getting easier). Survivors are niched by industry + own delivery playbooks.

### 2.2 AI-operated ecommerce

- Fractional executive retainers (US, DTC): **$5–15k/mo** (CFO/CMO scope). ([madrasaccountancy](https://madrasaccountancy.com/blog-posts/fractional-cfo-for-ecommerce-brands), [adverio](https://www.adverio.io/fcmo/))
- **Revenue-share operator models exist and work**, but only for brands with proven demand, healthy margins, and trackable data — agencies avoid them because they carry real risk. Ecommerce is the best-suited vertical (trackability). ([IMP Marketing](https://impmarketing.co/what-makes-a-revenue-share-ecommerce-growth-partner-work-long-term/), [gryt.global](https://gryt.global/what-is-revenue-share-marketing/)) → your Bisyou gates (royalty ≤5–8% net, standalone acquisition ≤35% of net, stabilizing base) are precisely the right filter.
- **Micro-PE angle:** small ecommerce brands trade at **2.5–3.5× SDE** post-aggregator-collapse; operator-buyers use seller notes/earnouts; **AI-driven operations is now a named value driver in M&A** — every R$1 of profit your stack adds is worth ~R$3–4 of enterprise value at exit. The operator captures value twice: fees while operating, multiple expansion if equity. ([FE International](https://www.feinternational.com/blog/shopify-ecommerce-brand-valuation), [CT Acquisitions](https://ctacquisitions.com/ecommerce-business-valuation/))
- AI-native agencies (e.g., Darkroom, $150M+ managed revenue) differentiate exactly on what Module A already does: contribution margin and incrementality instead of platform ROAS. ([darkroomagency](https://www.darkroomagency.com/observatory/best-dtc-marketing-agency-2026))

### 2.3 Content

- Creator income is a power law: **~49% of creators earn under $10k/yr**; only ~6% earn $100k+. ([Influencer Marketing Factory 2026 survey via search](https://www.ziprecruiter.com/Salaries/Ai-Content-Creator-Salary))
- Where it does pay: AI-niche newsletters at 5–10k engaged subs command **$500–3k per sponsorship slot**; course launches to an engaged 5k audience can spike $50k+ — but the audience takes 12–24 months to build.
- **For practitioner types, content converts best as a services funnel**, not as the product. One "how I run a beauty brand's operations with AI agents" case study is worth more than a year of tool-tip posts.
- **PT-BR gap is real:** Brazilian AI content is dominated by tool tutorials and platform courses (Alura, DIO/Santander scholarships). Practitioner-grade "run a business on agents" content in Portuguese is essentially unserved — and 53% of Brazilian SMEs are actively saying they don't know how to implement.

---

## 3. The business model — the Operator Ladder

Sell the same asset at four altitudes. Each rung funds and de-risks the next; each rung's deliverable is something you already produce for GE.

### Rung 1 — Diagnóstico de Operação IA (the wedge)
- **What:** 2-week AI-operations audit of a brand: where margin leaks, what agents can run, contribution-true economics of their channels (Module A methodology applied to their data), a prioritized automation map.
- **Price:** R$15–35k fixed (international clients: $5–10k). Benchmarked against strategy-sprint pricing; deliberately below US rates, above BR generalist rates.
- **Deliverable:** the defense-deck + analysis format you already master.
- **Purpose:** cash upfront, trust built, natural upsell into Rungs 2–3. Never free.

### Rung 2 — Implantação (the install)
- **What:** 4–8 weeks installing a control center on the client's business: Claude Code + tenant workspace + core skill pack (catalog ops, growth measurement, CRM authoring, content) + MCP wiring (Shopify, Meta, email, ERP) + team enablement.
- **Price:** R$40–90k project. (SMB implementation benchmark $10–15k ≈ R$55–80k; you're at market.)
- **Note:** this is `tenant-onboarding-engineer` pointed at an external client instead of an internal tenant.

### Rung 3 — Operação (the annuity — the core business)
- **What:** NAMI runs the brand's operations: growth office, catalog, CRM, content, measurement — the GE Beauty service level.
- **Price:** retainer **R$8–25k/mo** + performance kicker; or for turnaround/licensing deals, **royalty 4–8% of net** (the Bisyou structure) with the gates already defined.
- **Capacity:** the existing stack + multi-session operating system realistically supports **3–4 brands per operator** before hiring. That's the leverage the whole thesis rests on.

### Rung 4 — Equity (the compounding end-state, months 12+)
- **What:** license-with-option or outright acquisition of distressed-but-durable brands at 2.5–3.5× SDE, operated on the stack. Every point of margin the stack adds is multiplied at exit.
- **Bisyou is the template.** The diligence, impact model, and gates are already built.

### Content — the distribution layer (not a rung)
- **PT-BR:** weekly LinkedIn (operator lessons from real work), monthly long-form case study. Target audience: Brazilian DTC founders and ecommerce managers — your buyers.
- **EN:** the flagship "one operator + Claude runs a Brazilian beauty brand" story, published where the global AI-operator conversation happens. This is also the Claude Partner Network calling card.
- **Rule:** content documents real operations (sanitized); it never becomes a content business with its own production burden. Revenue expectation year 1: R$0 direct. Its job is inbound.

### Year-1 revenue sketch (conservative)
| Stream | Assumption | Annualized |
|---|---|---|
| GE Beauty (anchor — see D1 below) | formalized as paying client or equity | R$120–240k equiv. |
| Operating clients ×1–2 | R$10–20k/mo each, starting month 4–6 | R$100–250k |
| Diagnósticos ×4–6 | R$20k avg | R$80–120k |
| Implantações ×1–2 | R$60k avg | R$60–120k |
| **Total** | | **R$360–730k** |

Costs are AI subscriptions + infra (~R$3–5k/mo) + your time → software-like margins. The constraint is your calendar, not COGS.

---

## 4. The Claude Code arsenal, mapped to the business

### Already-built skills that ARE the product
| Skill / system | Role in the business |
|---|---|
| `tenant-onboarding-engineer` | Rung 2 delivery engine (contract → live, audits, migration, teardown) |
| `growth-office`, `growth-analyst`, `growth-hacker` | The fractional growth department (Rung 3 core) — incl. the agency challenge loop |
| `crm-director`, `content-director`, `creative-producer`, `video-director`, `illustrator`, `iconographer` | The fractional marketing/creative department |
| `integrations-engineer`, `observability-engineer`, `design-engineer`, `product-developer`, `product-manager`, `senior-engineer`, `shopify-submission` | The engineering bench (client integrations, reliability, app work) |
| `legal-review` + playbook | Client MSAs, licensing deals, vendor contracts (used on B4A, Boniteca) |
| `b2b-proposta` | Fork into the NAMI proposal generator (Rung 1/2 sales docs) |
| `email-copilot` | Client + prospect communications at scale |
| `handoff`, `recap`, `board` + work-orders + initiatives system | The multi-client operating system — what makes 3–4 brands per operator real |
| `skill-creator` | The meta-machine: every new client/vertical gets its own skill pack; playbooks compound |
| Excel conventions + `xlsx` skill | Client financial models (proven on the Bisyou impact model + GE BP) |
| `wrap-up`, `lessons-learned`, memory system | Institutionalizes learning across clients — the moat deepens with each engagement |

### Platform capabilities
- **MCP connectors in this session alone:** Shopify (via scripts + dev MCP), Meta Ads (full campaign build proven), Gmail, Monday.com, Canva, Figma, Magnific/Krea, Foreplay (ad intelligence), Nemu (attribution), Google Drive, Fireflies. Each one is a service line.
- **Agent/Workflow orchestration + scheduled tasks (cron):** recurring autonomous ops per client (the auto-delivery pipeline pattern, watchdogs, weekly sweeps).
- **The connector (mcp.nami.works) + Omnify apps:** the eventual software layer — clients graduate from "NAMI operates" to "NAMI's software + oversight," raising capacity per operator.

### To build (the short gap list — stealth-revised)
1. **The anonymized proof pack** — quantify what the stack replaces (agency fees, headcount, turnaround compression: campaign built in a day, LP in a session, contract review in hours) as method write-ups + redacted artifacts. No GE-identifiable data (D5). Sales asset #1.
2. **Brand-front offer one-pager + async Diagnóstico product** (b2b-proposta fork, new-brand skin; intake form + sample report + sales page).
3. **Generic tenant bootstrap kit** — `sandbox/<tenant>/` scaffold + core skill pack with GE-specific assumptions stripped (mostly exists; needs a de-GE pass).
4. **Claude Partner Network — join at Registered tier now** (free, NOT publicly listed — only Select+ appear in the partner directory) + take the free Claude Certified Architect path. Select tier (10 certified practitioners, 2 production customers, 1 public endorsement) is a post-reveal / post-hiring milestone.
5. **Persona voice + content pipeline** (content-director fork for the pseudonymous operator's publishing).

---

## 5. Decisions (revised 2026-07-29 under the stealth constraint)

**CONSTRAINT (Lucas, 2026-07-29):** GE will not be a client and cannot know about this venture. The business runs in stealth: the acquisition funnel must be anonymous at the first level; Lucas is revealed only when strictly necessary (closing calls onward).

**D1 — Stealth mode accepted; the operating consequence is a hard identity firewall.**
The venture runs behind a brand front with zero public links to Lucas, NAMI Works, or CPG Labs. Note: NAMI/CPG Labs are NOT safe fronts — Omnify (app.cpg-labs.io) sits inside GE's Shopify admin, visible to GE staff; lucas@nami.works owns GE-facing infra. A **new commercial brand** (new domain, private WHOIS, no shared analytics/infra fingerprints) is required.

**D2 — unchanged.** Lead with the operator identity, wedge with productized consulting; content is distribution. Stealth actually strengthens D2: anonymous content works when it's brand-voice or a pseudonymous operator persona — it fails when it's personal-brand-dependent (LinkedIn under your name is out at L1).

**D3 — REVISED: the niche must move off direct GE competitors.** Operating a competing Brazilian beauty brand's growth while COO of GE is a genuine conflict of interest, stealth or not — and it's also the single most likely way stealth breaks (small industry, shared vendors, Boniteca orbit). First clients: **adjacent CPG DTC verticals** (supplements, pet, home, personal care non-hair, food) in Brazil, or beauty **outside Brazil**. The playbooks port: Module A, CRM, catalog ops, and paid-media discipline are category-agnostic; only the voice/claims layer is beauty-specific.

**D4 — REVISED: tenant #2 must come from stealth-safe channels.** Bisyou is a GE-track deal (sourced and negotiated as GE/NAMI through the Boniteca/Edson orbit) — it lives on whatever track GE sanctions, but it is NOT the stealth venture's tenant #2. Stealth sourcing: brand-front inbound (content + paid), broker/marketplace listings (operator-buyer channel), and cold outbound signed by the brand.

**D5 — GE data firewall.** GE's raw numbers, customer data, and identifiable specifics never appear in the funnel. What's usable: the *methodology* (contribution-true measurement, offer economics, agent-run ops), anonymized ranges ("an 8-figure-BRL beauty DTC"), and redacted artifacts. The public proof asset becomes "the anonymous operator's track record," not "the GE Beauty case study."

---

## 6. Stealth go-to-market architecture

Three insulation layers, with identity exposure increasing only as commitment increases:

### Layer 1 — The brand front (fully anonymous)
- New commercial brand: fresh domain, private WHOIS, no shared infra/analytics/CDN fingerprints with nami.works or cpg-labs.io, brand-voice site ("we're a team of operators"), separate email domain and payment rails surfaced only at contract.
- Billing entity appears at contract signature — which is post-reveal anyway. NAMI Works can invoice, or a clean CNPJ if separation needs to be airtight (Lucas's call, legal-review skill drafts the MSA either way).
- **Claude Partner Network: DEFERRED.** The public partner directory would list the entity — a discoverability risk while stealth holds. Revisit at reveal-comfortable stage.

### Layer 2 — The persona (pseudonymous, the content engine)
- A pseudonymous operator account (X + newsletter; optional faceless YouTube) with the hook: *"opero uma marca DTC de 8 dígitos com agentes de IA — diário de bordo."* Anonymity becomes the differentiator, not a liability — the anonymous-operator genre has repeatedly built large followings, and curiosity converts.
- Content = documented real method (redacted screenshots, ranges, playbooks), never GE-identifiable data (D5).
- LinkedIn under Lucas's name: **out** at L1. A brand LinkedIn page is allowed but is a secondary channel (weak organic reach).

### Layer 3 — The reveal gate (closing only)
- Identity disclosed only at Rung-2/3 closing, under mutual NDA, after qualification passes a **conflict blacklist**: no direct GE competitors, no GE vendors/partners, no one in the Boniteca/agency/Bisyou orbit, no one socially adjacent to GE's team.
- Until then: async-first sales (see below), voice-only calls if needed, first name only.

### The funnel (anonymous at entry)
1. **Inbound:** pseudonymous content + SEO + a lead magnet (e.g., *"auto-diagnóstico: 20 sinais de que sua operação DTC está vazando margem"*) → newsletter → productized diagnostic sales page.
2. **Paid:** ads are inherently anonymous — brand LP + Meta/Google small-budget test (growth-hacker skill runs the whole motion).
3. **Outbound:** cold email signed by the brand ("time de operações da X"), never a fake person; referral partners who front the relationship where available.
4. **Rung 1 productized as an ASYNC product** — the key stealth adaptation: the Diagnóstico is delivered as a report, no live calls. Client fills an intake form, grants read-only access (Shopify collaborator account, Meta analyst role), pays upfront; deliverable is the defense-deck-grade report + prioritized automation map. Trust compensators for anonymity: redacted sample report on the LP, money-back guarantee, client testimonials (clients can be named even when you aren't), milestone payment on the bigger rungs.
5. Identity exposure begins only at the Rung-2/3 proposal call — by which point the prospect has already paid once and received value.

## 7. 90-day blueprint (stealth-revised)

### Weeks 1–2 — Foundation
- [ ] Name + register the brand front (domain, private WHOIS, mail, X handle, newsletter)
- [ ] Build the anonymized proof pack: "the operator's track record" — method write-ups + redacted artifacts (D5-compliant)
- [ ] Productize the Diagnóstico: intake form, access checklist, sample report, sales page, pricing
- [ ] Write the conflict blacklist (GE competitors/vendors/orbit) — checked before every deal advances

### Weeks 3–6 — Engine on
- [ ] Persona content cadence: 2–3 posts/week (PT) + first long-form method piece; newsletter live
- [ ] Paid test: R$1.5–3k on Meta → diagnostic LP (measure cost per qualified intake)
- [ ] De-GE the tenant bootstrap kit; dry-run the async diagnostic on a fictional brand end-to-end
- [ ] Source pipeline: 20 brand-signed cold outreaches into adjacent-CPG DTC (non-beauty) + broker/marketplace scan for operator-buyer targets

### Weeks 7–12 — Land + prove
- [ ] Close 2 paid async Diagnósticos (target R$25–50k booked)
- [ ] Advance 1 to the reveal gate → close 1 Implantação or Operação deal (tenant #2, stealth-sourced)
- [ ] Review content → intake conversion; kill or double channels on data

### Kill lines / checkpoints (day 90)
- **0 paid diagnósticos from 15+ qualified intakes/conversations** → offer, price, or trust compensators are wrong; rework before spending more
- **Intakes arriving but dying at payment** → anonymity trust gap is binding; add stronger compensators (guarantee, escrow, named testimonials) or move reveal earlier in the funnel
- **Any stealth leak vector detected** (GE-orbit inbound, identity connected publicly) → stop outbound, assess, decide reveal-vs-retreat deliberately — never improvise mid-leak

---

## 8. Risks

| Risk | Reality check | Mitigation |
|---|---|---|
| **Stealth leak** | Small industry; shared vendors; Omnify visible in GE's admin; WHOIS/analytics fingerprints | Hard identity firewall (new brand, no shared infra), conflict blacklist, D5 data firewall, leak protocol in kill lines |
| **Conflict of interest** | Operating GE competitors while GE COO is a real conflict, stealth or not — and the likeliest leak vector | Adjacent-CPG niche first (D3 revised); non-BR beauty only if fully firewalled |
| **Anonymity trust gap** | Services are trust businesses; anonymous funnels convert worse | Productized async Diagnóstico (pay-before-reveal), sample report, guarantee, named client testimonials, reveal at close under NDA |
| **Key-person = you** | The whole stack currently runs through one operator's judgment — and stealth caps your available hours further | Codify relentlessly (skills already do this); async-first sales; hire operator #2 only after 3 clients |
| **GE concentration** | Today: 100% of operating proof and most income — and now unusable as a named reference | Anonymized proof pack + stealth-sourced tenant #2 within 90 days |
| **Commoditization** | Claude gets easier; "AI setup" prices fall | Moat = domain playbooks + measurement discipline + operating record, priced on outcomes not hours; keep climbing to Rungs 3–4 where relationships and equity insulate |
| **Rev-share on dying brands** | The Bisyou lesson: revenue collapses with the spend cut | Apply the gates: proven durable base, royalty ≤5–8% net, standalone acquisition ≤35% of net, clean liability separation |
| **Content distraction** | Power-law odds; production burden grows | Content = documented real work only; zero standalone content bets year 1 |
| **Platform dependency (Anthropic)** | Stack is Claude-native | Playbooks are the asset and they port; Partner Network makes the dependency an advantage meanwhile |

---

*Research sources: consultant pricing ([nicolalazzari.ai](https://nicolalazzari.ai/guides/ai-consultant-pricing-us), [thecrunch.io](https://thecrunch.io/ai-consultant-cost/), [boomdevs](https://boomdevs.com/blog/ai-consulting-cost/), [layer3labs](https://www.layer3labs.io/guides/ai-consulting-rates-pricing)); Brazil adoption ([tiinside](https://tiinside.com.br/en/16/01/2026/72%25-of-Brazilian-companies-are-still-in-the-early-stages-of-adopting-AI./), [G4 study](https://www.ecommerceupdate.com.br/en/so-22-das-pmes-usam-ia-de-forma-estruturada-no-brasil-aponta-estudo-do-g4/), [ABES](https://abes.org.br/en/ia-e-o-principal-desafio-dos-cios-em-2026-aponta-pesquisa/)); Claude Partner Network ([lowcode.agency](https://www.lowcode.agency/blog/claude-partner-network-worth-it), [Washington Post](https://www.washingtonpost.com/wp-intelligence/ai-tech-brief/2026/06/16/claude-partner-program-creates-an-ecosystem-around-anthropics-ai-models/)); operator/M&A ([FE International](https://www.feinternational.com/blog/shopify-ecommerce-brand-valuation), [CT Acquisitions](https://ctacquisitions.com/ecommerce-business-valuation/), [IMP Marketing](https://impmarketing.co/what-makes-a-revenue-share-ecommerce-growth-partner-work-long-term/)); creator economy ([NeoReach/IMF surveys via search](https://www.ziprecruiter.com/Salaries/Ai-Content-Creator-Salary)).*
