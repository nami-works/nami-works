# Growth Campaign Deliverable — CPG Labs Validation v1 — 2026-04-11

Produced by `/growth-hacker` in `campaign-design` mode. This is the consolidated reference doc for the first CPG Labs paid acquisition campaign. Everything a future session (or a human operator) needs to understand, execute, review, and iterate on the campaign lives in this file.

Companion document: [lp-build-brief-cpglabs-2026-04-11.md](lp-build-brief-cpglabs-2026-04-11.md) — the LP refactor spec handed to `/product-developer`.

---

## Executive summary

**What this campaign is trying to prove:** that a refactored cpg-labs.io + a tiny paid Meta layer can produce 2–3 qualified first-install merchants per month at or below a $500 CAC ceiling, without disclosing CPG Labs to GE Beauty.

**What's being spent:** $1,000 USD over 3 months on Meta only. ~$11/day.

**What's being built:**
- Refactored cpg-labs.io with a new hero, 2 cross-cutting example builds, transparent pricing ($300–$500 setup + $30–$50/mo hosting), and a "describe your pain" form as the primary CTA
- 2 distinct ad concepts tested serially (Concept A weeks 1–6, Concept B weeks 7–12)
- Tracking stack (Pixel + CAPI + GA4 + UTMs) wired by `/integrations-engineer`

**What happens if it works:** CPG Labs validates that custom Shopify micro-services at app-store pricing has real pull with US merchants. Budget scales up *only* when ops capacity rises above 3 installs/month.

**What happens if it doesn't:** the campaign itself is designed to fail fast and cheap — kill criteria are written into every ad set, and the hardest-to-reverse assumption (that the wedge pulls at all) is tested in weeks 1–6 for <$500.

**Ops ceiling is the constraint, not the budget.** At 1–3 new installs/month (Lucas solo), paid ads are a probe, not a driver. The site refactor is doing ~90% of the work. Every visitor to cpg-labs.io matters disproportionately because absolute volume is small — which is why the LP build brief is a bigger document than this one.

---

## 1. Locked brief

### Product model

Bespoke Shopify micro-services built on demand per merchant pain. One embedded Shopify app per merchant that accumulates services over time (auto-tagger → inventory sync → custom reports → etc.). AI-accelerated development makes a 2-hour build economically viable at app-store prices.

**Pricing:** $300–$500 setup per service, $30–$50/mo hosting per service (40% below Storetasker's $475 floor, 80%+ below typical retainer agencies).

### Unit economics

```
First engagement (6mo, 1 service):
  $400 setup (midpoint) + 6 × $40 hosting = $640 LTV

Blended LTV with repeat services over 12mo:
  $640 + ~1.5 additional engagements = ~$1,280 LTV

At 75% gross margin:                   ~$960 gross LTV
3:1 LTV:CAC → target CAC:              ~$320
Validation-phase CAC ceiling:          ~$500
```

### Decision being bought

"At this site + positioning + hook, can paid + organic produce 2–3 qualified first-install merchants per month that close into first-install merchants at or under $500 CAC, while operating under-the-radar from GE Beauty?"

### Ops ceiling (the single most important constraint)

**1–3 new merchant installs per month.** Lucas is building solo. Exceeding this queue damages the brand more than slow growth does.

### Under-the-radar constraint (hard)

CPG Labs operates without disclosure to GE Beauty for now. This means:
- **No named customer.** GE Beauty cannot be logoed, quoted, screenshotted, or referenced even obliquely.
- **No personal founder brand.** CPG Labs speaks as "we," never as "I/Lucas." No founder photo. No LinkedIn posts from Lucas's personal account about CPG Labs.
- **No public content marketing from Lucas's personal account.** CPG Labs organic posting happens from a brand-only account (Twitter/X company page, LinkedIn company page).
- **Proof strategy:** real features with synthetic demo data (spin up a local CPG Labs instance with fake data, screenshot the UI) + technical credibility (stack, architecture, "how we build"). No logo wall, no testimonials, no founder bio.
- **Disclosure timeline:** not part of this brief, but flagged as a recommended dated milestone (~month 3 or first 5 paying merchants, whichever sooner). Under-the-radar operation has an expiration date; GE Beauty will eventually notice CPG Labs as a vendor in their own Shopify admin.

### Conversion actions

- **Primary:** form submission on cpg-labs.io — button label `Get your tailored app`, form section heading "Tell us what's eating your week" — 5 fields: store URL, pain in their words, current workaround, timeline, email. Async 48h scoped-quote reply.
- **Secondary:** Calendly booking — "want to talk it through?" — demoted to a text link below the form. Not a co-equal CTA.
- **Tertiary (optimization signal only):** Link Click — this is what Meta optimizes against, because form submission volume is too low at $11/day for the algorithm to learn.

### Budget + channels

```
Budget (FINAL):     $1,000 USD over 12 weeks (~$11/day avg)
Platform:           Meta (Facebook + Instagram) only
                    Google Search killed for this round
                    TikTok killed for this round
                    LinkedIn killed for this round
Audiences:          Custom Audience (pre-GE contact list, filtered)
                    1% Lookalike from that Custom Audience seed
                    No cold broad targeting
                    No retargeting (not enough warm traffic in round 1)
Geo:                US only
Language:           English
```

### Pain concepts being tested

Serial test — Concept A runs weeks 1–6, Concept B runs weeks 7–12. NOT parallel. At $11/day the budget doesn't split meaningfully across parallel concepts.

1. **Concept A — App bloat tax.** "You're paying $29/mo for a Shopify app you half-use. We'll build the one you actually need for less."
2. **Concept B — Unmet feature / search failure.** "Searched the Shopify App Store and got zero useful results? We build that."

### Success criteria

- 3+ first-install merchant closes from paid in 12 weeks
- Paid CAC ≤$500 per close (relaxed from $320 target for validation phase)
- Site form CVR ≥3% on LP visits (paid + organic combined)
- Clear concept winner — ≥50% CTR gap between hook 1 and hook 2
- Custom Audience match rate ≥60% when uploaded to Meta

### Kill criteria

- **Per ad set:** pause if CPC > $3 after $80 spent
- **Per concept:** swap creative if link CTR < 1.2% (Concept A) or < 1.6% (Concept B) after $180 spent
- **Campaign-wide:** pause if form CVR on LP < 1% after 500 clicks → this is an **LP problem, not an ad problem**, rebuild the site before relaunching paid
- **Campaign-wide:** stop if zero closes after $800 spent AND >10 qualified leads → wrong audience or wrong offer, stop and reframe the brief

### Brand voice (hard constraints — any violation is a launch blocker)

- **No em dashes** in customer-facing copy. Use commas or periods.
- **No hype verbs:** no "10x," "scale," "transform," "unlock," "revolutionize," "supercharge," "game-changer," "boost," "drive growth," "skyrocket."
- **No earnings or revenue-lift claims.** No "increase your revenue," "boost sales," "grow your store."
- **No superlatives:** no "best," "top," "#1," "leading."
- **Never imply Shopify endorsement.** "Custom software for Shopify stores" ✅. "Shopify Partner," "Shopify-certified" ❌.
- **No named customers, no testimonials, no founder bio.**
- **Concrete over abstract.** Every claim paired with a specific example.
- **English only.**

### Hard dependencies before launch

- `/integrations-engineer` wires Pixel + CAPI + GA4 + UTM passthrough on cpg-labs.io (NOTHING is wired today)
- `/product-developer` ships the refactored cpg-labs.io against [lp-build-brief-cpglabs-2026-04-11.md](lp-build-brief-cpglabs-2026-04-11.md)
- Synthetic data screenshots produced (see section 7.2)
- Contact list filtered, LGPD-compliant, uploaded to Meta
- Real-device mobile test + Core Web Vitals pass before any paid traffic
- Visual assets (hero SVG + 2 example screenshots + ad creative) generated
- Calendly event created at `https://calendly.com/cpg-labs/fit-call` (currently a dead URL)

---

## 2. Audience research

### Persona 1 — The Food & Beverage Founder

- **Company profile:** $800k–$3M annual revenue, 4–10 person team, 18–24 months into Shopify. Categories: specialty coffee, craft beverages, functional nutrition, prepared meals, gourmet snacks. Often DTC-first before retail.
- **Psychographics:** comfortable with tech but not a developer. Values speed over perfect code. Has failed sequentially at inventory sync (Stocky + custom workaround + 3rd party). Zero tolerance for vendor lock-in. Sees custom dev as inevitable, just wants it affordable.
- **Where they hang out:** DTC Fam Slack, Limited Supply community, r/FoodBusiness. Podcasts: Ecommerce Influence, The Unofficial Shopify Podcast (Kurt Elster), Limited Supply podcast. Events: Insider's Ecommerce Summit.
- **Purchase trigger:** just hired a 3rd party for multi-warehouse inventory sync + wholesale pricing parity, received a $200+ monthly invoice for layered apps, realized "$2,000 custom tool pays for itself in 2 months."
- **Top objections:** (1) "Can you maintain it if your developer leaves?" (2) "Will this integrate with my warehouse system?" (3) "How long will this take — I need it in 2–4 weeks, not 2–3 months."
- **Meta detailed targeting interests:** eCommerce food brands, DTC brands, subscription box services, Shopify merchants, food/beverage fulfillment, supply chain automation, inventory management software, founder/entrepreneur communities.
- **Google keyword themes:** "shopify inventory sync multiple warehouses," "custom shopify app cost," "DTC food brand scaling logistics," "shopify app bloat alternatives."

### Persona 2 — The Beauty Brand Operator

- **Company profile:** $1.2M–$5M revenue, 8–15 person team, 2–3 years into DTC, heavy subscription model (40%+ of revenue). Multi-channel: DTC + Amazon + Sephora wholesale. Shopify Plus aspirant or recent upgrade.
- **Psychographics:** technically savvy, hands-on. Treats Shopify as a growth lever, not a storefront. Strong UX/CRO opinions. Burned out running 6–8 apps for subscriptions, discounts, loyalty, skin quizzes. Sees custom dev as competitive advantage.
- **Where they hang out:** DTC Nation Slack, Club CPG (paid), Shopify Plus Slack partners, Kristen LaFrance on LinkedIn, GoPillar YouTube, Unofficial Shopify Podcast. Conferences: Shopify Plus Acceleration, Shopify Unite.
- **Purchase trigger:** launched a new subscription tier with conditional pricing, existing subscription app can't handle it, built a Zapier workaround that breaks every 2 weeks, heard competitor launched a custom "build-your-own routine" feature driving 22% higher AOV.
- **Top objections:** (1) "I need this to sync with Klaviyo/ReCharge." (2) "What if you change pricing mid-contract?" (3) "Can I monitor how this is performing — no black box."
- **Meta detailed targeting interests:** Beauty DTC brands, subscription box ecommerce, Shopify merchants, skincare brands, eCommerce optimization, CRO, subscription software, marketing automation, customer retention.
- **Google keyword themes:** "shopify subscription app limitations," "custom shopify checkout extension," "DTC beauty brand bundling," "subscription pricing shopify."

### Persona 3 — The Supplements/Wellness Operator

- **Company profile:** $600k–$2M revenue, 6–12 person team, 18–30 months into Shopify. Manages 1–3 fulfillment partners (3PL + drop-ship). Heavy bundling/kitting (supplements ship in variety packs, subscription stacks). Shopify standard or Plus.
- **Psychographics:** operations-focused, non-technical but data-driven. Obsessed with inventory accuracy because of regulatory risk (lot codes, expiration dates, recalls). Sees app fatigue as a compliance risk. Open to custom dev if it reduces 10+ manual hours/week. Risk-averse — needs data integrity guarantees.
- **Where they hang out:** Startup CPG Slack (20k+ members, free), Limited Supply (paid), Shopify Partners blog on CPG/fulfillment, LinkedIn ops community. Rarely attends conferences — prefers recorded content + async.
- **Purchase trigger:** received first customer complaint about wrong lot code in a batch order. Realized bundling orders are manually assembled. Current workflow: manual CSV export → 3PL coordinator reconciles → 4 hours/week. Competitor launched automated kitting. "I need custom code to scale safely or I hire a full-time ops person."
- **Top objections:** (1) "Will this break my 3PL integration?" (2) "Is lot code tracking audit-ready?" (3) "What's the SLA during peak windows (viral TikToks, holidays)?"
- **Meta detailed targeting interests:** Supplement brands, wellness ecommerce, CPG brands, 3PL integration, inventory management software, kitting/bundling automation, regulatory compliance.
- **Google keyword themes:** "shopify kitting bundling automation," "multi-warehouse inventory sync shopify," "3PL integration shopify," "supplement brand packaging automation."

### Shared entry points across all 3 personas

- **Communities:** DTC Fam, Limited Supply, Startup CPG, DTC Nation (all Slack-first)
- **Podcasts:** The Unofficial Shopify Podcast, Ecommerce Influence, Limited Supply
- **Pain trigger:** tried 3+ overlapping apps for the same problem, paying $100–$200/mo in app fees + significant operational labor, custom dev suddenly looks economical at $300–$500 for a 48h–10 day build
- **Key targeting caveat:** all 3 personas live on **Slack communities, not open social.** Meta's detailed interests are weak for Slack-dwellers. This is why the Custom Audience from Lucas's pre-GE contact list is so load-bearing — it's the only reliable way to reach these merchants at warm-audience CPM.

---

## 3. Competitive intelligence

### Category pricing (the biggest finding)

CPG Labs's $300–$500 setup + $30–$50/mo hosting is **dramatically cheaper than every credible alternative**, but no longer in the "suspiciously cheap" zone after the pricing revision:

| Category | Typical pricing | CPG Labs position |
|---|---|---|
| Freelance (Upwork) | $15–$150/hr | Lower (fixed model) |
| Storetasker projects | $475–$2,000+ per project | 37% below floor, 75% below mid-tier |
| Toptal vetted devs | $60–$200+/hr | Fixed vs hourly |
| Retainer agencies | $1,000–$8,000/mo | 95%+ below |
| Mechanic (SaaS) | $16–$199/mo | Equivalent SaaS tier |
| Shopify Flow | Free (Plus only) | Direct competitor, no setup fee |

**Positioning interpretation:** CPG Labs is the "Mechanic-priced alternative with real custom code behind it, for merchants who don't want to code their own automations and don't want to pay agency rates."

### Saturated hooks (don't use these)

Every competitor scouted uses variations of these. Avoid:
- *"Hire a vetted expert fast"* (Storetasker, Toptal, Upwork all use this)
- *"Top 3% of developers"* / *"Hand-selected talent"* (Storetasker, Toptal)
- *"No-code, drag & drop automation"* (Mechanic, Shopify Flow, MESA, Alloy)
- *"Agency quality at freelancer prices"* (Storetasker flagship)
- *"Custom Shopify development"* with no further differentiation

### Underused angles (CPG Labs can own)

- **"One install, many services"** — the super-app LTV mechanic. Nobody in the category talks about the accumulating-services angle.
- **"CPG-native language"** — nobody speaks directly to CPG merchant pains (multi-SKU variants, wholesale tiers, compliance labeling, kitting).
- **Anti-app-store positioning** — app fatigue is universal, nobody owns "the antidote to app creep."
- **"AI-accelerated custom utilities"** — competitors (Toptal, agencies) don't emphasize AI speed. Why 2-hour builds are economically viable. Must be framed carefully — "AI-assisted with senior review," not "AI wrote your code."
- **Transparent pricing** — every competitor hides pricing behind "book a call." Showing $300–$500 openly is a category first.

### Competitor LP teardown — patterns to borrow + avoid

Pages analyzed: storetasker.com, electriceye.io, domaineworldwide.com, creatuity.com, rocketcode.io.

**What every LP does (saturated — boring but expected):**
- "Book a call" primary CTA (all 5)
- Logo walls 40% down the page
- 3–5 testimonial quotes, case studies buried below fold
- Zero pricing transparency — 100% quote-based
- Vague hero promises ("strategic design," "AI-powered," "purpose-built")
- 2–3 field contact forms minimum

**What few or none do (gaps):**
- **Transparent pricing** — not one page shows a price range
- **Time-lapse or live build gallery** — all show static case studies
- **"Get a quote in 2 minutes" CTAs** — everyone pushes calendar booking
- **Specific problem matching** in the hero — nobody ties headline directly to merchant pain

**Strongest message match seen:** Storetasker — *"Hire the top freelance Shopify talent" → "Get introduced to elite e-commerce freelancers" → CTA "hire an expert."* Direct problem-to-solution language, zero ambiguity. Worth studying.

**Worst friction seen:** Domaine, Creatuity — both force email capture + form submission to reach contact, then redirect to Calendly. Multi-gate funnels.

**3 patterns CPG Labs should borrow:**
1. Storetasker's *speed & flexibility* messaging ("introductions within hours") creates urgency without hype
2. Creatuity's *operations-first positioning* (lead with problem-outcome, not feature list)
3. Domaine's *"unified stack"* angle — position CPG Labs as the single source for stacked utilities vs. patchwork app ecosystem

**3 patterns CPG Labs should avoid:**
1. Generic "book a call" CTAs
2. Logo walls of clients without metrics
3. Buried pricing behind "contact for pricing"

---

## 4. LP refactor

The full LP Build Brief lives at [lp-build-brief-cpglabs-2026-04-11.md](lp-build-brief-cpglabs-2026-04-11.md). It contains:

- Mobile-first wireframe (390px) + desktop wireframe (1280px)
- Section-by-section copy with V1 hero locked and 2 cross-cutting example builds
- Transparent pricing block ($300–$500 setup, $30–$50/mo hosting)
- 5-field "describe your pain" form spec
- Visual asset slots (hero SVG + 2 example screenshots)
- Core Web Vitals budget (LCP <2.5s, CLS <0.1, INP <200ms, <1MB above fold)
- CSS conventions
- Keep-rewrite-remove list against the existing skeleton
- Success criteria + review checkpoints
- Out-of-scope list

### Key LP decisions (for quick reference)

> **Post-ship revision note (2026-04-11):** After the initial ship, the LP hero, the CTA label, and the copy density across all body sections were all revised. The details below reflect **what is currently live in production**, not the original V1 brief. Ad creative in §5 and §6 still references the original V1 language because it's a separate operator decision whether to refresh the ad hooks to match the new LP hero — for now message match between ad and LP is **thematic, not literal**, and the ad copy matrix in §6 has been left intact. See Appendix B for the full revision history.

**Hero headline (locked):**

> *"How much do you spend on Shopify apps?
> And how much of it do you actually use?"*

The second line renders in the holo-gradient emphasis span inside the same `<h1>`, with a forced `<br />` between the two sentences.

**Hero subhead:**

> *"If the answer is 'too much for features we half-use,' we write the exact feature you'd rather have. Shipped inside your Shopify admin in days."*

No specific dollar amounts in the subhead. Pricing exposure above the fold is limited to the cost-stack SVG's highlighted `CPG Labs · $300 to $500 setup` row. The dedicated Pricing section below the fold retains both setup and hosting numbers as the category-differentiation anchor.

**Primary CTA:** `Get your tailored app` → scrolls to `#pain-form` → form → async 48h quote reply.

**Secondary CTA:** `or book 20 minutes to talk it through` → Calendly text link (not embed).

**Section order (mobile-first):**
1. Nav (sticky)
2. Hero
3. Wedge strip (3 pain chips)
4. How it works (3 steps)
5. Example builds gallery (2 cards, cross-cutting across personas)
6. How we build (technical credibility)
7. Pricing (transparent)
8. LTV expansion story
9. FAQ (5 objections)
10. Final CTA (form + Calendly text link)
11. Footer

### Invocation command for the build

```
/product-developer app/routes/_index/cpglabs-home.tsx inputs/lp-build-brief-cpglabs-2026-04-11.md
```

The `/growth-hacker` skill does NOT invoke `/product-developer` directly. The user decides when to kick off the build.

---

## 5. Creative concepts

Both concepts are built to echo the LP hero headline (message match foundation). Both are tested *serially*, not in parallel — at $11/day average spend, Meta's algorithm can't learn on multiple concepts simultaneously. Concept A runs weeks 1–6, Concept B runs weeks 7–12.

### Concept A — App bloat tax (receipt-style)

**Hook:** *"Open your Shopify billing page. Count the apps you half-use. We'll stop."*

**Pain activated:** resignation. The merchant knows the monthly spend is bloated but hasn't pictured a way out.

**Frame:** receipt-style, problem-first. A literal stacked receipt is the most concrete visual for a cost pain, cuts through feed noise without motion or narration.

**Format:**
- **Primary:** static feed 1:1
- **Secondary:** carousel 1:1 (3 slides — receipt, math, offer)
- Why static: rewards a long stare in-feed, near-zero production cost at $11/day spend

**Temperature + audience:** cold/warm. Runs on **1% Lookalike first**, widens to **Custom Audience** if CTR holds. Skip retargeting — the pain framing is too broad for warm viewers who already know CPG Labs.

**Visual anchor:** long white thermal-paper receipt shot top-down on matte grey desk, slight curl at edges. Line items read "Bulk Editor $29/mo, Product Reviews $19/mo, Inventory Sync $39/mo, Shipping Rules $49/mo." Subtotal "$136/mo" circled in red pen. Beside the receipt: one small white card, black text, "One service. Built for you. $30 to $50/mo." No logos, no people, no screens.

**Carousel slide breakdown (backup format):**
- Slide 1: receipt hero, overlay *"Monthly Shopify app tax."*
- Slide 2: same receipt with 3 apps struck through in red, overlay *"You use 20% of each."*
- Slide 3: white card, overlay *"We build the one service you actually need. $300 to $500 once. $30 to $50 a month."*

**Kill criterion:** link CTR < 1.2% after $180 spent → swap concept.

### Concept B — Unmet feature (search-failure)

**Hook:** *"40 results. Zero of them do what you asked."*

**Pain activated:** active frustration. The merchant just closed a browser tab on a failed search and is still annoyed.

**Frame:** curiosity-gap, search-failure. A mock Shopify App Store screen with a visible "no matches" state is an immediately recognizable moment for any merchant who has lived it.

**Format:**
- **Primary:** Reel 9:16, 12 seconds
- **Secondary:** static feed 4:5 using the "no results" frame as hero
- Why Reel: search-to-build pivot needs one cut to work; static as fallback for low-attention placements

**Temperature + audience:** warm only. Runs on **Custom Audience seed + 1% Lookalike**. **Not cold** — the frame assumes the viewer has tried and failed in the last 30 days.

**Visual anchor:** laptop screen mock of a Shopify App Store search bar reading "bundle upsell by location," results grid showing 6 unrelated app icons greyed out with "None match" in red overlay. Cut at 0:03 to plain text card on off-white: *"We build it. 48h quote."* Frame final at 0:10: form hero from cpg-labs.io with cursor hovering the first field. Soft click SFX on the cut. No voiceover.

**Script beat sheet:**
- Beat 1 (0–3s): "no results" search screen, red overlay
- Beat 2 (3–6s): cut to text card, *"Built in 10 days. $300 to $500 once."*
- Beat 3 (6–10s): cursor lands on form field, overlay *"Get your tailored app."*
- Beat 4 (10–12s): URL card *"cpg-labs.io."*

> **Post-ship note (2026-04-11):** The LP hero has been updated from the V1 *"You're paying $29 a month..."* to *"How much do you spend on Shopify apps? And how much of it do you actually use?"* and the CTA has been renamed to `Get your tailored app`. The Concept A/B ad copy in §6 still uses the V1 language, so message match between the Meta ad and the LP headline is now **thematic rather than literal** — both hit the app-bloat pain but via different wording. Accepted for round 1 validation; if Concept A form CVR on the LP drops below 3%, that's the signal to refresh the ad copy to echo the new hero directly. No action required until the data says otherwise.

**Kill criterion:** link CTR < 1.6% after $180 spent → swap concept. (Higher bar than Concept A because warmer audience should convert better.)

### Why the 2 concepts are distinct

Concept A sells a **price reframe** to a passive merchant who has already accepted the cost of app bloat. Concept B sells a **build capability** to a merchant mid-search who just hit a wall and is still annoyed. Same wedge, different emotional state, different audience layer — clean CTR-gap reading.

### Message match verdict

| Check | Verdict | Notes |
|---|---|---|
| Concept A primary text → LP hero | ✅ Perfect verbatim match | A1 opens with exact LP headline language |
| Concept A headline → LP hero | ✅ Strong literal echo | "Build the app you actually need" ↔ "the one you actually need" |
| Concept B primary text → LP hero | ⚠️ Thematic match only | Different hook ("searched and failed"), same promise ("we build that") |
| Concept B headline → LP hero | ⚠️ Thematic only | "The app that doesn't exist yet" reinforces wedge but not literal match |

**Risk on Concept B:** post-click LP CVR may drop if viewers re-read the hero and wonder if they're in the right place. **Mitigation:** accept and monitor. If Concept B form CVR on the LP stays ≥3%, thematic match is holding. If it collapses below 1%, swap Concept B for another Concept A execution (carousel variant). At $1k budget, building a second LP variant is over-engineering.

---

## 6. Ad copy matrix

### Concept A — App bloat tax

**Primary text variants (Meta primary text, mobile truncates at ~125 chars):**

⭐ **A1** — pick this first (124 chars hook, 318 total) — hook mirrors LP hero verbatim, concrete pain stack

> *You're paying $29/mo for a Shopify app you half-use. We'll build the one you actually need for less, one time. Stacking 3 apps to auto-tag orders, sync inventory, and gate wholesale pricing gets expensive fast. We write the exact micro-service your store needs, $300 to $500 setup, $30 to $50/mo hosting. Describe your pain, get a quote in 48h.*

**A2** (123 chars hook, 289 total)

> *Three stacked Shopify apps, $174/mo, and two of them still don't do what you hired them for. There's a cheaper fix. We build one custom micro-service per merchant, replacing the app duct-tape with code you own the logic of. $300 to $500 setup, $30 to $50/mo. Tell us what's broken, quote in 48h.*

**A3** (122 chars hook, 276 total)

> *Audit your Shopify app bill this month. If you're over $150/mo on apps you half-use, you're overpaying for features. We replace the top offender with a custom micro-service built for your exact workflow. $300 to $500 setup, $30 to $50/mo hosting. Describe the pain, async quote in 48h.*

**Headline variants (Meta headline — mobile truncates at ~27 chars, 40 max):**

- ⭐ **A-H1** — pick this first: *"Build the app you actually need"* (31 chars) — echoes LP "one you actually need"
- **A-H2** *"Stop paying $29/mo for half a tool"* (34 chars)
- **A-H3** *"Custom, not subscribed"* (22 chars)

**Description variants (max 30 chars, optional placement):**

- ⭐ **A-D1** — pick this first: *"$300 setup, $30/mo hosting"* (26 chars) — price anchor kills objection pre-click
- **A-D2** *"One build. One time."* (20 chars)

**CTA button picks (from Meta's canned list):**

- ⭐ **Get Quote** — matches the async 48h quote flow on the LP exactly, reinforces price-anchored primary text
- **Learn More** — safer fallback for cold audiences who need LP context before committing to a quote form

### Concept B — Unmet feature / search failure

**Primary text variants:**

⭐ **B1** — pick this first (124 chars hook, 312 total) — names the exact search-failure moment, concrete example, soft CTA

> *Searched the Shopify App Store for "auto-tag discounted products" and got zero useful results? We build that. One custom micro-service per merchant pain, not another subscription. $300 to $500 setup, $30 to $50/mo hosting. If you're already on a workaround you hate, describe it and we'll quote a real fix in 48h.*

**B2** (121 chars hook, 283 total)

> *The app you need doesn't exist in the Shopify App Store. We checked too. Custom software for Shopify stores, built for one merchant's exact workflow, not 10,000. $300 to $500 setup, $30 to $50/mo. Tell us the feature you couldn't find, quote back in 48h.*

**B3** (123 chars hook, 297 total)

> *Still running that workaround in a spreadsheet because no app does the thing? That's what we build. One micro-service, one merchant pain, one flat setup fee from $300. $30 to $50/mo hosting, no seat tax. Describe the workaround, get an async quote in 48h.*

**Headline variants:**

- ⭐ **B-H1** — pick this first: *"The app that doesn't exist yet"* (30 chars) — names search-failure insight in plain language
- **B-H2** *"Built for one store. Yours."* (27 chars)
- **B-H3** *"Your workaround, rebuilt"* (24 chars)

**Description variants:**

- ⭐ **B-D1** — pick this first: *"From $300. 48h quote."* (21 chars) — price + speed anchor in one line
- **B-D2** *"Custom micro-service"* (20 chars)

**CTA button picks:**

- ⭐ **Get Quote** — merchant is solution-hunting, matches async quote promise
- **Contact Us** — fits the "describe the workaround" framing when a merchant wants a conversation first

### Brand voice compliance check

All variants audited against hard constraints:
- ✅ Zero em dashes
- ✅ Zero hype verbs (no "10x/scale/transform/unlock/boost")
- ✅ Zero earnings or revenue claims
- ✅ Zero superlatives ("best/top/#1")
- ✅ Zero named customers
- ✅ No Shopify endorsement implication
- ✅ Concrete examples throughout (auto-tag, inventory sync, wholesale gating, bundle upsell)
- ✅ English only
- ✅ Every hook lands inside 125-char mobile truncation
- ✅ Every headline under 40-char mobile truncation risk line

---

## 7. Visual assets

### 7.1 Ad creative visual prompts

Full prompt sheet below — paste-ready into Midjourney v7, Flux Pro, or Ideogram v2.

**⭐ Start here: Concept A Execution 1 (Receipt Flat-Lay) at 4:5 on Ideogram v2.** Receipt metaphor is the strongest scroll-stopper (concrete + numeric), 4:5 is the dominant cold-traffic Feed format, Ideogram is the only model that renders receipt line-items legibly. Test whether readable prices beat clean blank-receipt versions before committing to the full matrix. If readable text wins → route the rest of Concept A through Ideogram. If not → default to Flux/Midjourney for texture and overlay text in post.

#### Concept A Execution 1 — Receipt Flat-Lay — Feed 4:5

```
Model: midjourney v7
Format: 4:5 1080x1350
Subject: stack of six printed subscription receipts fanned slightly on a matte concrete desk, each receipt on thermal paper showing faint app-name and dollar amounts, one smaller crisp white invoice card resting on top labeled clearly different in weight and texture
Action: top invoice catches a sliver of highlight while the stack below sits in soft shadow
Setting: modern minimalist founder desk, late morning in a Brooklyn studio office
Lighting: soft directional north-facing window light from upper-left, gentle falloff into warm shadow on the right
Camera: overhead flat-lay, 90-degree top-down, 50mm macro feel, shallow depth of field on receipt edges
Style: editorial still life, documentary product photography
Color palette: warm neutrals, off-white paper, muted concrete grey, single soft amber accent
Text-in-image: none, leave blank receipt lines for post overlay
Negative: plastic look, stock photo vibe, oversaturated, CGI render, fake fonts, perfect symmetry, glossy paper
```

```
Model: ideogram v2
Format: 4:5 1080x1350
Subject: overhead flat lay of six thermal printed receipts stacked, each showing readable app names and prices, one small white invoice card on top
Action: still
Setting: matte concrete founder desk
Lighting: soft north window light, upper-left
Camera: overhead 90-degree flat-lay, macro feel
Style: editorial still life photography
Color palette: warm neutrals
Text-in-image: receipt 1 reads "LOYALTY APP $29/mo", receipt 2 "REVIEWS PRO $49/mo", receipt 3 "BUNDLES+ $39/mo", receipt 4 "UPSELL KIT $19/mo", receipt 5 "SHIP RULES $29/mo", receipt 6 "TAG SYNC $9/mo", top card reads "CPG LABS · $300 ONE-TIME" in clean sans-serif
Negative: plastic look, CGI, blurred text, garbled letters, fake fonts
```

```
Model: flux pro
Format: 4:5 1080x1350
Subject: same receipt stack and single invoice card
Action: still
Setting: same desk
Lighting: diffused overcast daylight, flat even illumination with soft cool tone
Camera: overhead flat-lay, 90-degree top-down, 50mm macro
Style: editorial still life
Color palette: cool neutrals, pale grey, bone white
Text-in-image: none
Negative: plastic, stock, oversaturated, CGI, weird proportions
```

#### Concept A Execution 1 — Vertical 9:16

```
Model: midjourney v7
Format: 9:16 1080x1920
Subject: tall vertical arrangement of six thermal receipts stacked lengthwise on a concrete desk with a single crisp white invoice card resting on top
Action: still, subtle curl at paper edges
Setting: minimalist founder desk studio
Lighting: soft window light from upper-left, gentle gradient to shadow bottom-right
Camera: overhead 90-degree, vertical composition, 50mm macro
Style: editorial still life
Color palette: warm neutrals, off-white, muted concrete
Text-in-image: none
Negative: plastic, stock, CGI, oversaturated, weird proportions
```

```
Model: ideogram v2
Format: 9:16 1080x1920
Subject: vertical overhead flat lay of six readable thermal receipts stacked with small white invoice card on top
Action: still
Setting: matte concrete desk
Lighting: soft north window light upper-left
Camera: overhead 90-degree, vertical
Style: editorial still life
Color palette: warm neutrals
Text-in-image: same six receipt labels as 4:5 prompt, top card "CPG LABS · $300 ONE-TIME"
Negative: garbled text, CGI, plastic
```

#### Concept A Execution 2 — Founder Desk Scene — Feed 4:5

```
Model: midjourney v7
Format: 4:5 1080x1350
Subject: open laptop on wooden desk showing a Shopify admin subscriptions tab with six faint rows, small stack of printed receipts beside laptop, ceramic coffee mug, a trailing pothos plant, phone face-down, no hands no people
Action: still workspace scene
Setting: sunlit home office, mid-morning
Lighting: soft natural window light from left, warm highlights on mug and laptop edge
Camera: 3/4 angle medium shot, 35mm lens, shallow depth of field on laptop screen
Style: lifestyle commercial documentary
Color palette: warm neutrals, walnut wood, muted green plant
Text-in-image: none, screen content left as suggestive blur for overlay
Negative: plastic, stock photo, generic office, CGI, oversaturated, people, faces, hands
```

```
Model: flux pro
Format: 4:5 1080x1350
Subject: same desk scene
Action: still
Setting: same office
Lighting: overcast diffused daylight, cool even tone
Camera: eye-level medium, 35mm, shallow focus on receipt stack
Style: documentary workspace
Color palette: cool neutrals, pale wood
Text-in-image: none
Negative: plastic, stock, CGI, people
```

#### Concept B Execution 1 — Shopify App Store Screenshot Style — Feed 4:5

```
Model: ideogram v2
Format: 4:5 1080x1350
Subject: clean Shopify App Store style search interface, search bar upper-third with query typed, empty-state results area below with small handwritten sticker annotation
Action: still interface screenshot
Setting: minimalist off-white UI background
Lighting: flat clean UI render
Camera: straight-on flat interface
Style: minimalist product UI
Color palette: Shopify off-white and soft green accent
Text-in-image: search bar reads "auto-tag discounted products", below shows "0 results found", small yellow sticky note overlay on empty area reads "CPG Labs built this" in handwritten font
Negative: garbled text, CGI, cluttered UI, photo realism
```

```
Model: ideogram v2
Format: 4:5 1080x1350
Subject: same Shopify App Store search UI
Action: still
Setting: same off-white UI background
Lighting: flat clean
Camera: straight-on
Style: minimalist UI
Color palette: same
Text-in-image: query "bulk price tag campaigns", "0 results found", sticky note "CPG Labs built this"
Negative: garbled text, CGI
```

```
Model: ideogram v2
Format: 4:5 1080x1350
Subject: same UI layout
Action: still
Setting: same
Lighting: flat
Camera: straight-on
Style: minimalist UI
Color palette: same
Text-in-image: query "sync inventory across pop-ups", "0 results found", sticky note "CPG Labs built this"
Negative: garbled text, CGI
```

#### Concept B Execution 1 — Vertical 9:16

```
Model: ideogram v2
Format: 9:16 1080x1920
Subject: vertical Shopify App Store search interface, search bar in upper third, empty state mid-frame, sticky note lower
Action: still
Setting: off-white UI background
Lighting: flat clean
Camera: straight-on vertical
Style: minimalist UI
Color palette: Shopify off-white, soft green
Text-in-image: "auto-tag discounted products", "0 results found", sticky note "CPG Labs built this"
Negative: garbled text, CGI
```

#### Concept B Execution 2 — Physical Metaphor (Magnifier) — Feed 4:5

```
Model: midjourney v7
Format: 4:5 1080x1350
Subject: printed Shopify App Store page lying on wooden desk, brass magnifying glass resting on top over empty results area, small leather notebook open beside it listing five app names with red X marks
Action: still, magnifier lens catching a soft highlight
Setting: warm wooden desk, natural daylight
Lighting: soft window light from upper-left, gentle highlight on brass
Camera: overhead 3/4 angle, 50mm, shallow depth on magnifier
Style: editorial still life, documentary
Color palette: warm neutrals, walnut wood, brass accent, ink black
Text-in-image: none
Negative: plastic, stock, CGI, oversaturated, cartoon, fake fonts, people, faces
```

**Cost + time estimate for full matrix:** ~$10–$15 on Flux + Ideogram credits, ~1 hour Midjourney, ~2–3 hours total including selection and re-rolls. Budget 3 hours of Lucas-time to run the sheet end-to-end.

**Generation priority order:**
1. ⭐ Concept A Exec 1 Feed 4:5 (Ideogram) — test readable text hypothesis first
2. Concept A Exec 1 Vertical 9:16 (best winner from step 1)
3. Concept A Exec 1 Feed 1:1 (for square placements)
4. Concept B Exec 1 Feed 4:5 (Ideogram — text is load-bearing for this concept too)
5. Concept B Exec 1 Vertical 9:16
6. Concept A Exec 2 (founder desk scene) — backup option
7. Concept B Exec 2 (physical magnifier) — backup option

### 7.2 LP synthetic screenshots (separate task)

The LP build brief reserves 2 screenshot slots for the Example builds gallery. These are **different from ad creative** — they're real CPG Labs UI populated with synthetic demo data.

**Process:**
1. Spin up a local CPG Labs instance (Omnify stack via `npm run dev` or similar)
2. Populate the database with synthetic data (fake products, fake cities, fake merchants, fake metrics)
3. Screenshot the app UI in a real browser at laptop resolution
4. Export to `.webp` at 1600×1000, compress to <200KB each
5. Save to `public/images/cpglabs/examples/`:
   - `example-1-inventory-sync.webp` — shows the fictional multi-channel inventory reconciliation UI
   - `example-2-conditional-pricing.webp` — shows the fictional customer-tag pricing rule UI

**Who produces them:** Lucas, 1–2 hours of work. Can be deferred until after `/product-developer` finishes the LP refactor — gradient placeholders ship first, real assets swap in later without a rebuild.

**Why not a subagent:** the feature doesn't exist in a way a subagent can screenshot. Lucas has access to the actual codebase and can populate it with fake data in a way nobody else can replicate.

### 7.3 LP hero cost-stack SVG

The LP build brief specifies a single inline SVG for the hero visual. 60KB max, no raster, no animation. Shows the same "6 subscription receipts vs 1 CPG Labs invoice" visual metaphor as the ad creative, but as vector. Lucas or `/product-developer` produces this during the LP build phase — can be a simple hand-coded SVG with `<rect>` and `<text>` elements, or exported from a quick Figma/Illustrator draft.

---

## 8. Strategy + channel mix (Phase 3)

### Funnel shape

Single collapsed funnel — no TOFU/MOFU/BOFU split at this budget. The budget is too small to meaningfully layer funnel stages. Everything flows through a single campaign optimizing on Link Click, with warm-audience-first targeting.

### Channel mix (final)

| Channel | Budget share | Role | Why |
|---|---|---|---|
| **Meta (Facebook + Instagram)** | 100% | Primary + only | Custom Audience from pre-GE contact list is the only viable warm seed. CPMs manageable at $11/day. Creative-heavy vs search-heavy wedge. |
| Google Search | 0% | Killed | Min viable daily budget ($10–20) eats the whole spend with no volume. Revisit in round 2. |
| TikTok | 0% | Killed | Audience (B2B CPG merchants) doesn't live there for business intent. Consumer-social mismatch. |
| LinkedIn | 0% | Killed | ICP matches but CPCs ($20–$40) obliterate the budget in 30 ad clicks. Revisit in round 2 after winners are known. |

### Audience layering

```
Ring 1 (warmest):  Custom Audience from pre-GE contact list
                   - Uploaded to Meta, match rate verified ≥60%
                   - Size ~300-2000 merchants depending on list
                   - Estimated CPM: $15-25 (warm seed)
                   - Budget: 50% of daily spend

Ring 2 (warm):     1% Lookalike from the Custom Audience seed, US
                   - Estimated audience size: ~2M people
                   - Estimated CPM: $30-45 (moderate)
                   - Budget: 50% of daily spend

Ring 3 (cold):     SKIPPED for round 1
Ring 4 (retarget): SKIPPED for round 1
```

### Test structure (serial, not parallel)

```
Weeks 1-2:  Concept A launches on both audience rings simultaneously.
            Creative variant: A1 primary text + A-H1 headline + A-D1 description
                              + Get Quote CTA + Receipt Flat-Lay 4:5 visual.
            Goal: 7-day warm-up, CPC stabilization, first CTR signal.

Weeks 3-4:  Concept A continues. If CTR <1.2% after $180 spent on Concept A,
            swap to Concept A Execution 2 (Founder Desk Scene) keeping audience constant.
            Goal: creative refresh inside the same concept angle.

Weeks 5-6:  Concept A final verdict window. By end of week 6, ~$462 spent on Concept A.
            Compare CTR, CPC, form CVR across the 6-week window.
            Decision: continue Concept A into weeks 7-12, OR swap to Concept B as planned.

Weeks 7-8:  Concept B launches (Reel 9:16 primary, static 4:5 fallback).
            Creative variant: B1 primary text + B-H1 headline + B-D1 description
                              + Get Quote CTA + Shopify App Store search-failure visual.
            Runs on same 2 audience rings.

Weeks 9-10: Concept B continues. If CTR <1.6% after $180 spent, swap creative.

Weeks 11-12: Concept B final verdict window. By end of week 12, ~$462 spent on Concept B.
             Total campaign spend: ~$924 + $76 buffer.
```

### Test grid (what we're isolating)

| Variable | Holding constant | Varying |
|---|---|---|
| Concept angle | Audience, LP, brand voice, pricing | Concept A vs Concept B (serial, not parallel) |
| Creative refresh within concept | Concept angle, audience | Execution 1 vs Execution 2 (if Execution 1 fails kill criterion) |
| Audience ring | Concept, creative | Custom Audience vs 1% Lookalike (parallel, same budget) |

### Why serial, not parallel

At $11/day total spend, running both concepts in parallel means each concept gets ~$5.50/day, which is below Meta's minimum viable daily budget for a single ad set and produces too-small a daily sample for the algorithm to learn or the human operator to draw conclusions. Serial testing is the only statistically honest read at this spend level. The trade-off: the campaign timeline is 12 weeks instead of 6, and we can't isolate the interaction effect between concepts. For a validation v1, that's acceptable.

### Optimization event — Link Click, not Lead

Meta normally wants conversion-event optimization (Lead = form submit), but at $11/day we'll never hit the ~50 conversions/7 days needed for algorithm learning on a sparse event. Link Click is high-volume, stabilizes fast, and gives us a clean CTR/CPC scoreboard. We validate form CVR and downstream close rate manually via Shopify order tags and the LP's `waitlistSubscriber` table.

### Bid strategy — Cost Cap, not automated ROAS

Automated bidding (Lowest Cost, Cost Cap, Target ROAS) all assume learning-phase exit. We won't exit. Cost Cap at **$1.50 target per link click** ($2.00 kill ceiling) gives the operator control and prevents Meta from bidding us into the stratosphere trying to hit an unhittable optimization target.

### Placements — Automatic

Let Meta pick Feed / Reels / Stories / Marketplace / in-stream. At our spend level, manual placement selection adds operational burden without material CPA improvement. Creative is already produced in multiple formats (1:1, 4:5, 9:16) so Meta can optimize delivery across placements natively.

---

## 9. Deployment plan (Phase 8)

This is the paste-ready spec for Meta Ads Manager. Every field listed here needs to be set exactly before the campaign launches.

### Campaign level

| Field | Value |
|---|---|
| **Campaign name** | `CPGLabs_ValidationV1` |
| **Objective** | `Traffic` (Link Clicks) |
| **Buying type** | `Auction` |
| **Budget type** | `Ad-set level (ABO)` — NOT campaign budget optimization (CBO) |
| **Campaign spending limit** | `$1,050 USD lifetime` (hard stop, $50 buffer over plan) |
| **Start date** | Week 1 (after all pre-launch checklist items clear) |
| **End date** | Week 12 |
| **Special ad category** | `None` (CPG Labs is B2B software — not credit/housing/employment/political) |
| **A/B test** | Off |

### Ad sets — Weeks 1-6 (Concept A)

**Ad set 1: `A-CustomAudience_W1-6`**

| Field | Value |
|---|---|
| Audience | Custom Audience from filtered pre-GE contact list |
| Audience size (expected) | ~300–2,000 merchants |
| Match rate (required ≥60%) | Verified at upload |
| Optimization event | `Link Click` |
| Bid strategy | `Cost cap` — target `$1.50` per link click |
| Daily budget | `$5.50 USD` |
| Placements | `Automatic` |
| Geography | `United States` |
| Age | `25–55` |
| Language | `English` |
| Detailed targeting expansion | `Off` |
| Start | Week 1, day 1 |
| End | Week 6, day 7 |

**Ad set 2: `A-Lookalike1pct_W1-6`**

| Field | Value |
|---|---|
| Audience | `1% Lookalike of Custom Audience seed`, US |
| Audience size (expected) | ~2.3M |
| Optimization event | `Link Click` |
| Bid strategy | `Cost cap` — target `$1.50` per link click |
| Daily budget | `$5.50 USD` |
| Placements | `Automatic` |
| Geography | `United States` |
| Age | `25–55` |
| Language | `English` |
| Detailed targeting expansion | `Off` |
| Start | Week 1, day 1 |
| End | Week 6, day 7 |

### Ad sets — Weeks 7-12 (Concept B)

**Ad set 3: `B-CustomAudience_W7-12`** — duplicate of ad set 1 with Concept B creative, fresh start date week 7.

**Ad set 4: `B-Lookalike1pct_W7-12`** — duplicate of ad set 2 with Concept B creative, fresh start date week 7.

**Important:** create these as *duplicates* at the ad-set-level via Meta's duplicate button, not edits to the Week 1–6 ad sets. Duplication preserves the learning on the originals and lets you compare head-to-head if needed.

### Ads per ad set

Each ad set runs **1 primary ad** (the ⭐ creative pick) at a time. Rotation happens by pausing + duplicating, not by running multiple ads simultaneously in one ad set — at this budget, multi-ad rotation splits the daily budget too thin.

**Primary ad for Concept A (weeks 1–6):**

| Field | Value |
|---|---|
| Ad name | `CPGLabs_A1_Receipt_4x5_CustomAudience` (duplicate with `_Lookalike1pct` for ad set 2) |
| Format | `Single image` |
| Creative | Concept A Execution 1 Receipt Flat-Lay, 4:5, generated via Ideogram v2 |
| Primary text | ⭐ A1 — `"You're paying $29/mo for a Shopify app you half-use..."` |
| Headline | ⭐ A-H1 — `"Build the app you actually need"` |
| Description | ⭐ A-D1 — `"$300 setup, $30/mo hosting"` |
| Call to action | `Get Quote` |
| Destination URL | `https://cpg-labs.io/?utm_source=meta&utm_medium=paid&utm_campaign=cpglabs-v1&utm_content=A1-receipt-4x5&utm_term=custom-audience` |
| Pixel | `Pixel fires on landing page load` |
| Tracking | Meta CAPI (server-side) mirrors Pixel, dedup by event_id |

**Primary ad for Concept B (weeks 7–12):**

| Field | Value |
|---|---|
| Ad name | `CPGLabs_B1_SearchFail_9x16_CustomAudience` (and `_Lookalike1pct`) |
| Format | `Single video` (Reel 9:16, 12s) |
| Creative | Concept B Execution 1 Shopify App Store search-failure cut, generated via Ideogram v2 + post-production edit |
| Primary text | ⭐ B1 — `"Searched the Shopify App Store for 'auto-tag discounted products'..."` |
| Headline | ⭐ B-H1 — `"The app that doesn't exist yet"` |
| Description | ⭐ B-D1 — `"From $300. 48h quote."` |
| Call to action | `Get Quote` |
| Destination URL | `https://cpg-labs.io/?utm_source=meta&utm_medium=paid&utm_campaign=cpglabs-v1&utm_content=B1-searchfail-9x16&utm_term=custom-audience` |
| Pixel | `Pixel fires on landing page load` |
| Tracking | Meta CAPI server-side mirror |

### UTM convention

All destination URLs use this parameter pattern:

```
?utm_source=meta
&utm_medium=paid
&utm_campaign=cpglabs-v1
&utm_content=<creative-id>
&utm_term=<audience-name>
```

**Examples:**
- `?utm_source=meta&utm_medium=paid&utm_campaign=cpglabs-v1&utm_content=A1-receipt-4x5&utm_term=custom-audience`
- `?utm_source=meta&utm_medium=paid&utm_campaign=cpglabs-v1&utm_content=A1-receipt-4x5&utm_term=lookalike-1pct`
- `?utm_source=meta&utm_medium=paid&utm_campaign=cpglabs-v1&utm_content=B1-searchfail-9x16&utm_term=custom-audience`

Every ad must carry a unique `utm_content` value so the post-campaign analysis can identify which creative-audience combination produced each form submit.

### Tracking events (to be wired by /integrations-engineer)

The LP Tracking Brief will be produced by `/growth-hacker` after the LP ships Phase 7F review. It names these required events:

**Client-side Meta Pixel events:**
- `PageView` — fires on LP load, every URL
- `ViewContent` — fires when hero section scrolls into view (scroll depth >50%)
- `Lead` — fires on form submit success

**Server-side Meta CAPI events (mirrored with event_id dedup):**
- Same 3 events, server-side, with matching `event_id` on each pair so Meta deduplicates Pixel + CAPI correctly

**GA4 events:**
- `page_view` — standard
- `form_submit` — custom, on success
- `calendly_link_click` — custom, on the secondary text link

**UTM passthrough:**
- UTM params preserved across SPA navigation (React Router client-side routing must not strip them)
- UTM params forwarded to Shopify order attribution if the form submission leads to a merchant closing in future flows

**Verification required before launch:**
- Events Manager shows Pixel firing within 30s of LP load
- Events Manager shows CAPI dedup working (same `event_id` on client + server events)
- UTM params survive SPA navigation end-to-end on a real mobile device
- GA4 `form_submit` event fires and lands in the `form_submit` custom event report

### Kill rules (restated, enforced in the ad-set descriptions)

| Trigger | Action |
|---|---|
| Ad set CPC > $3 after $80 spent | **Pause the ad set** — Meta's delivery is broken, not the creative |
| Concept A link CTR < 1.2% after $180 spent on Concept A | **Swap creative** within Concept A (Execution 1 → Execution 2), same audience |
| Concept B link CTR < 1.6% after $180 spent on Concept B | **Swap creative** within Concept B (Execution 1 → Execution 2), same audience |
| Campaign-wide form CVR on LP < 1% after 500 LP visits | **Pause campaign.** Rebuild the site before relaunching. LP is broken, not the ad. |
| Zero closes after $800 total campaign spend AND >10 qualified form submits | **Stop campaign.** Wrong audience or wrong offer. Reframe the brief before relaunching. |

### Scale rules

- Only scale an ad set after it clears its kill floor AND 7+ days have elapsed
- Scale = **duplicate** the winning ad set at +50% daily budget (NOT edit in place — editing resets any learning Meta has accumulated, even at our spend level)
- Never scale >20% within a rolling 48h window
- Expected scale trigger at this budget: unlikely to hit in round 1 because total budget is the binding constraint, but if both Concept A and Concept B perform inside target, round 2 of the campaign doubles budget at week 13 with the scale-decision mode of `/growth-hacker`

### Pre-launch checklist (ALL must be checked before Phase 9 launch)

- [ ] Contact list uploaded to Meta Custom Audiences, match rate verified ≥60%
- [ ] 1% Lookalike built from the Custom Audience seed and ready
- [ ] LP shipped and passed `/growth-hacker` Phase 7F review (mobile device, 4G, real UTM params)
- [ ] Meta Pixel + CAPI wired and firing — verified in Events Manager
- [ ] CAPI dedup working (matching `event_id` on Pixel + CAPI pairs)
- [ ] GA4 events wired and landing in reports
- [ ] UTM passthrough verified end-to-end on a real mobile device
- [ ] Every ad's destination URL has a complete UTM set (`source`, `medium`, `campaign`, `content`, `term`)
- [ ] Every ad's copy re-read against brand voice rules (no em dashes, no hype verbs)
- [ ] Kill criteria written into every ad set's description field so the operator sees them at glance
- [ ] Daily budget cap set to $5.50/day per ad set ($11/day campaign total)
- [ ] Campaign lifetime spending limit set to $1,050 (hard stop with $50 buffer)
- [ ] Audience exclusions in place (exclude pre-GE list *from* the Lookalike audience to avoid overlap)
- [ ] Creative assets generated, reviewed, and uploaded to the correct Meta ad library
- [ ] Calendly event at `https://calendly.com/cpg-labs/fit-call` exists and loads (currently a placeholder URL — fix before launch)
- [ ] Form submit success state tested locally AND on the deployed LP
- [ ] `waitlistSubscriber` table ready to receive submissions with `source: "cpglabs-home"`

Once all 16 items clear, Phase 9 can proceed with an explicit launch approval from the user.

---

## 10. Launch sequence

Parallel streams that need to land before paid traffic starts:

```
[Brief locked — Phase 1 complete] ✅ 2026-04-11
         │
         ▼
┌────────────────┬─────────────────┬─────────────────┐
│                │                 │                 │
▼                ▼                 ▼                 ▼
Site refactor    Tracking wire-up  Creative assets   Contact list prep
(/product-dev    (/integrations    (Midjourney/      (Lucas filters
on LP Build      -engineer on      Flux/Ideogram,    pre-GE list for
Brief)           Tracking Brief)   from §7)          LGPD compliance)
│                │                 │                 │
~2 weeks          ~2-3 days         ~2-3 hours        ~1 day
│                │                 │                 │
▼                ▼                 ▼                 ▼
LP live          Pixel firing      Ad creatives      Audience uploaded
                 CAPI dedup        ready in Meta     Match rate verified
                 UTM passthrough   library           Lookalike built
                 GA4 events
         │                │                 │                 │
         └────────────────┴─────────────────┴─────────────────┘
                          │
                          ▼
          Phase 7F LP review pass
                          │
                          ▼
          Pre-launch checklist (§9)
                          │
                          ▼
          Explicit user approval → PHASE 9 LAUNCH
                          │
                          ▼
                  Week 1 Concept A live
```

**Critical path:** site refactor (`/product-developer`). Everything else can run in parallel behind it. If `/product-developer` takes 2 weeks, the full launch happens ~week 3. If faster, parallelism shortens the timeline.

---

## 11. First review schedule

| Review | Week | Mode | What it checks |
|---|---:|---|---|
| **Smoke test** | 1, day 3 | `scale-decision` (informal) | Is Pixel firing? Are clicks flowing? Is form CVR reasonable? Kill anything broken. |
| **Concept A mid-flight** | 3 | `performance-review` | Is Concept A CTR trending toward or away from the kill criterion (1.2%)? Do we refresh creative? |
| **Concept A end** | 6 | `performance-review` + `scale-decision` | Final Concept A verdict. Clean numbers. Decision: swap to Concept B as planned, or extend Concept A if it's winning? |
| **Concept B mid-flight** | 9 | `performance-review` | Same as week 3 but for Concept B. |
| **Campaign close** | 12 | `performance-review` (full) | Full attribution triangle: Shopify paid-attributed closes vs Meta platform metrics vs GA4 vs UTM Shopify traffic. Winner verdict. Scale/kill decision for round 2. |

---

## 12. What needs to happen next (immediate actions)

In priority order:

1. **User invokes `/product-developer app/routes/_index/cpglabs-home.tsx inputs/lp-build-brief-cpglabs-2026-04-11.md`** in a separate session to start the LP refactor. This is the critical path — everything else parallelizes behind it.
2. **User generates ad creative** from the visual prompt sheet in §7.1. Starting with Concept A Execution 1 Receipt Flat-Lay at 4:5 on Ideogram v2. ~2–3 hours of Lucas-time end-to-end.
3. **Lucas filters the pre-GE contact list** for LGPD compliance (personal contacts with implied marketing consent only, no GE Beauty overlap, no GE competitors, no GE suppliers). Exports to CSV for Meta Custom Audience upload.
4. **Lucas spins up local CPG Labs** with synthetic demo data and captures 2 screenshots for the Example builds gallery (§7.2). These can ship after the LP does — use gradient placeholders in the meantime.
5. **Lucas creates the Calendly fit-call event** at `https://calendly.com/cpg-labs/fit-call` so the secondary CTA link works.
6. **Once `/product-developer` finishes the LP build**, user returns to `/growth-hacker` for Phase 7F review.
7. **After Phase 7F passes**, `/growth-hacker` produces the LP Tracking Brief and hands it to `/integrations-engineer` for Pixel + CAPI + GA4 + UTM wire-up.
8. **After tracking verified**, user returns to `/growth-hacker` for Phase 9 launch approval.

---

## 13. Viral psychology hooks (Phase 4+ enhancement)

Most viral persuasion frameworks were built for broad consumer audiences, not for sophisticated founder/operator B2B buyers. Many of the classic "1 weird trick" moves that work on DTC audiences actively BACKFIRE on a CPG merchant who has seen the same hooks 400 times. This section lists 12 hooks that survive CPG Labs's three filtering constraints — **(1) anti-hype brand voice**, **(2) no named customers or founder bio**, **(3) under-the-radar from GE Beauty** — and which can be layered into ad copy, ad creative, or LP sections without rewriting the campaign.

Each hook lists its source, mechanism, concrete application for CPG Labs, honest risk, and category.

### 13.1 The 12 hooks

#### Hook 1 — Loss aversion (amplified)

- **Source:** Kahneman & Tversky, *Prospect Theory* (1979)
- **Mechanism:** Losses are psychologically ~2x more motivating than equivalent gains. Framing a status quo as active loss of money/time activates stronger behavioral response than framing an alternative as a gain.
- **Application for CPG Labs:** Already live in Concept A's primary text. Amplify by making the cumulative loss visible over time on the LP: *"$174/mo across 6 half-used apps. That's $2,088 a year on features you're not using."* Place as a subhead below the pricing section on cpg-labs.io.
- **Risk:** Specific dollar claims (`$174/mo`) aren't universally true and Meta may flag as misleading if the numbers read as a promise. Mitigate by framing as hypothetical: *"If you're running 6 stacked apps, that's roughly..."* — not a guarantee.
- **Category:** Click driver, Conversion lever

#### Hook 2 — Anchoring

- **Source:** Tversky & Kahneman, *Judgment under Uncertainty* (1974)
- **Mechanism:** First numbers a reader sees set the reference point for all subsequent price judgments. High anchors make lower prices feel cheap, even if the anchors are irrelevant.
- **Application for CPG Labs:** On the LP pricing section, render the category anchors visually next to CPG Labs's price: *"Freelance agency: $475+ per project. Shopify retainer shop: $1,000+/mo. CPG Labs: $300–$500 setup + $30–$50/mo hosting."* Do NOT name specific competitors (reads as defensive). Use category labels.
- **Risk:** Overt anchoring reads as defensive positioning if the competitor labels are too specific. Keep anchors categorical, not branded.
- **Category:** Conversion lever, Trust builder

#### Hook 3 — Specificity bias

- **Source:** Eugene Schwartz, *Breakthrough Advertising* (1966); David Ogilvy, *Confessions of an Advertising Man* (1963)
- **Mechanism:** Specific numbers are significantly more credible than round numbers or vague claims. *"$173.47/mo"* reads as real; *"~$175"* reads as estimated; *"a lot"* reads as fluff.
- **Application for CPG Labs:** Already live in Concept A ($29/mo, $300–$500, 48h). Extend to the LP example builds — replace *"hours saved"* with specific numbers whenever honest: *"Reconciliation time cut from 4 hours per week to zero"* ✅. Extend to the FAQ — *"Most single-feature builds are scoped within 48 hours and shipped within 5 to 10 business days"* is already doing this well. Audit every number on the LP and make sure nothing is vague.
- **Risk:** None. Pure win as long as the specifics are honest.
- **Category:** Comprehension aid, Trust builder

#### Hook 4 — Curiosity gap (Zeigarnik effect)

- **Source:** Bluma Zeigarnik (1927); George Loewenstein, *The Psychology of Curiosity* (1994)
- **Mechanism:** Incomplete information creates a cognitive itch the brain wants to resolve. Open loops and unresolved questions hold attention longer than complete statements.
- **Application for CPG Labs:** Already live in Concept B's hook ("40 results. Zero of them do what you asked."). Extend by ending every LP section on a bridge sentence that creates a small loop for the next section. Example: after the pricing section, *"So how do we actually build these things fast enough to charge this?"* leads into the "How we build" technical credibility section. The reader scrolls to resolve the loop.
- **Risk:** Overused, curiosity gaps read as clickbait and lose the founder audience instantly. One major gap per ad, 2–3 minor gaps per LP, max.
- **Category:** Attention-capture, Click driver

#### Hook 5 — Pattern interrupt

- **Source:** Direct-response copywriting tradition; Gary Halbert, *Boron Letters* (1984); Ogilvy
- **Mechanism:** The brain's visual attention system is tuned to detect anomalies. Scrolling through a feed of polished product shots and smiling faces, a mundane workspace scene or a "broken UI" screenshot captures attention precisely because it doesn't look like an ad.
- **Application for CPG Labs:** Already live in both ad concepts — Concept A (thermal receipts on a concrete desk, no faces, no product glamour) and Concept B (Shopify App Store "0 results" state, error-looking screenshot). Amplify by ensuring the creative refresh (every ~2 weeks) preserves the pattern-interrupt aesthetic. If a new visual starts looking "designed," it has decayed. Keep it looking like something photographed or screenshot-captured, not illustrated.
- **Risk:** Pattern interrupts decay faster than any other hook. Creative fatigue is ~2 weeks at scale. Budget for creative refresh from day 1.
- **Category:** Attention-capture

#### Hook 6 — Honest scarcity

- **Source:** Robert Cialdini, *Influence: The Psychology of Persuasion* (1984) — Scarcity principle
- **Mechanism:** Items perceived as limited in availability become more valuable. Scarcity only works when it's honest — sophisticated buyers detect fake scarcity instantly and discount the brand accordingly.
- **Application for CPG Labs:** *"We onboard 3 merchants per month. Tell us what's broken and we'll reply in 48h."* This is TRUE at Lucas's current ops ceiling (1–3 installs/month). Place in the final CTA block on the LP, and as a single line in the FAQ under "How fast can you ship?" — do NOT put it in the hero (reads as urgency-hype when it's actually a capacity constraint).
- **Risk:** Scarcity copy reads as cringe if even slightly overdone. One mention in the FAQ, one mention in the final CTA. Never in the hero. Never in ads.
- **Category:** Conversion lever, Trust builder

#### Hook 7 — Authority via stack visibility

- **Source:** Cialdini, *Influence* — Authority principle (adapted for anonymous/no-founder-bio context)
- **Mechanism:** People defer to credentialed experts. In contexts where credentials can't be shown (no founder bio, no case studies, no client logos), **technical artifacts** become the credential — architecture diagrams, code snippets, stack names, framework mentions.
- **Application for CPG Labs:** Already live in the LP "How we build" section. Amplify by including a **small code snippet** on the LP — not a full component, just 4–6 lines showing a real CPG Labs webhook handler or a Prisma query with good naming. Signals "we ship production code, not prototypes" to technical buyers. Non-technical buyers skip past it without damage.
- **Risk:** Over-nerdy reads as gatekeeping for non-technical buyers. Keep the snippet short and in a collapsed `<details>` block so it's optional viewing.
- **Category:** Trust builder

#### Hook 8 — Social proof without names

- **Source:** Cialdini, *Influence* — Social Proof principle (adapted for under-the-radar constraint)
- **Mechanism:** Behavior others are engaging in becomes a reference for correct action. The canonical form is testimonials and logo walls — which CPG Labs cannot use. The uncanonical form is **anonymized behavioral counters** that show activity without naming participants.
- **Application for CPG Labs:** A small rotating stat line below the LP hero: *"Last 30 days: 14 merchants described their pain. 9 got a scoped quote within 48 hours."* Numbers must be real and maintained (refresh weekly at minimum). Place above the fold on mobile if it fits without pushing the CTA below the fold, otherwise immediately after the hero.
- **Risk:** Requires operational discipline to keep numbers fresh. Stale counters (same number unchanged for 3 weeks) actively damage credibility. If Lucas won't commit to a weekly refresh, skip this hook — a missing hook is better than a stale one.
- **Category:** Trust builder, Conversion lever

#### Hook 9 — Commitment / consistency (micro-commitment ladder)

- **Source:** Cialdini, *Influence* — Commitment & Consistency principle; Leon Festinger, *A Theory of Cognitive Dissonance* (1957)
- **Mechanism:** Small initial commitments make larger subsequent commitments more likely. A reader who fills one form field has already "committed" and is more likely to complete the full form than one who sees all 5 fields at once.
- **Application for CPG Labs:** Keep the form single-page (not multi-step) for V1 to avoid drop-off risk, BUT start the visual hierarchy with ONE highlighted field: the `pain` textarea. Make it ~60% of the visual weight of the form. The other 4 fields render smaller, below it. Reader types the pain first (the hard part), then trivially fills out the store URL, workaround, timeline, and email to finish.
- **Risk:** Multi-step forms usually decrease completion in B2B contexts. Keep single-page, just bias the visual weight toward the first action.
- **Category:** Conversion lever

#### Hook 10 — Market sophistication (Schwartz stage 4/5 mechanism-led copy)

- **Source:** Eugene Schwartz, *Breakthrough Advertising* (1966) — The 5 Stages of Market Sophistication
- **Mechanism:** Markets cycle through sophistication stages. Stage 1 = "What" (product name). Stage 2 = "What + bigger promise." Stage 3 = "What + bigger promise + unique mechanism." Stage 4 = "Enlarged mechanism + proof." Stage 5 = "You, the prospect, are the mechanism." CPG Shopify merchants are at **Stage 4**: they've seen every basic agency pitch 100 times and need to understand **how** something works differently to believe it.
- **Application for CPG Labs:** The LP's "How we build" section and Concept B's copy already do this ("AI-assisted development + senior review is why a $300 build is real"). Amplify by making the mechanism explicit in ad copy: *"A 2-hour feature is viable because AI handles the boilerplate and a senior engineer reviews every line."* That's the mechanism-led version of "we're cheap." Mechanism-led copy is what wins at Stage 4.
- **Risk:** Mechanism explanations can slide into technical smugness. Keep the mechanism concrete and benefit-tied, not a monologue.
- **Category:** Comprehension aid, Trust builder

#### Hook 11 — Enter the conversation already in their head

- **Source:** Eugene Schwartz, *Breakthrough Advertising* — the "enter the conversation" principle
- **Mechanism:** Effective ads don't start from zero. They pick up mid-thought on the reader's own internal monologue. A founder who just tried to reconcile inventory for the fourth Monday in a row is already mid-sentence in their own head: *"I need to fix this inventory thing."* An ad that opens *"Monday morning inventory reconciliation — still doing it by hand?"* slots directly into that monologue.
- **Application for CPG Labs:** Test **time-of-day delivery** via Meta ad scheduling. Concept B (search-failure frame) should be scheduled to deliver heavier on **Monday mornings 8am–11am local US time**, when merchants are hitting their weekly ops pain. Concept A (app bloat frame) should deliver heavier on **end-of-month days** when merchants are reviewing Shopify app bills. This is not a creative change — it's a delivery-timing change. Free to implement.
- **Risk:** Timing alone doesn't guarantee the ad is in the prospect's head. If the creative is generic, timing won't save it. Assume timing amplifies good creative, doesn't rescue bad creative.
- **Category:** Attention-capture, Click driver

#### Hook 12 — Identity framing

- **Source:** Self-signaling / identity-based decision-making research (summarized well in James Clear's *Atomic Habits* via Bénabou & Tirole, 2006)
- **Mechanism:** Readers identify with categories that match their self-image and resist categories that don't. *"For the kind of founder who..."* invites the reader into a tribe they want to belong to.
- **Application for CPG Labs:** One line on the LP final CTA block: *"For the kind of CPG founder who'd rather fix the problem than file another support ticket."* Places the reader on a side (the builders, not the complainers) and makes saying yes to the form submit feel consistent with who they already think they are.
- **Risk:** Identity framing reads as exclusionary if overused. One instance on the LP. Never in ads (too subtle for cold/warm traffic that hasn't yet identified with the brand).
- **Category:** Conversion lever

### 13.2 Top 3 to layer in first

If Lucas only has time for three hook upgrades to the locked campaign, these are the ones with the best leverage-to-effort ratio:

1. **Honest scarcity** (Hook 6) — solves the "too cheap to be real" credibility risk we flagged in Phase 2 AND is free to implement (one line in the LP FAQ + one line in the final CTA). Single biggest trust-building move available given the under-the-radar constraint.

2. **Pattern interrupt creative refresh cadence** (Hook 5) — the visual prompt sheet in §7.1 already produces pattern-interrupt creative, but Meta creative fatigue is ~2 weeks at scale. Plan a creative-refresh batch at week 3 and week 9 using the alternate executions (Founder Desk Scene, Physical Magnifier) from the same prompt sheet. Zero new creative production, just rotation discipline.

3. **Kairos / time-of-day scheduling** (Hook 11) — free to implement in Meta Ads Manager via ad scheduling. Concept A weights end-of-month mornings (when merchants review Shopify app bills). Concept B weights Monday mornings 8am–11am local US time (when merchants hit weekly ops pain). Single largest amplification of existing creative at zero creative cost.

### 13.3 Hooks deliberately NOT used (and why)

Several canonical viral psychology hooks are OFF-LIMITS for CPG Labs under its constraints. Listing them explicitly so no future session accidentally layers them in:

- **Fake urgency** (*"Only 24 hours left!"*) — violates anti-hype brand voice. Readable as manipulation to a founder audience. Honest scarcity (Hook 6) is the only survivable version.
- **Named customer social proof** (logo wall, *"Trusted by GE Beauty, Warby Parker..."*) — violates under-the-radar constraint. Hook 8 (anonymized behavioral counters) is the only survivable version.
- **Authority via personal credentials** (*"Built by a former Shopify engineer"* or *"Founded by the COO of GE Beauty"*) — violates under-the-radar + no-founder-bio constraints. Hook 7 (technical stack authority) is the only survivable version.
- **Hyperbolic promise** (*"10x your operations"*, *"Transform your Shopify store"*, *"The last tool you'll ever need"*) — violates anti-hype brand voice AND Meta ad policy. Permanently banned.
- **Before/after transformation stories with real numbers** (*"Customer X went from $500k to $5M in 12 months"*) — violates earnings-claim restriction AND requires named customers we can't use. Permanently banned.
- **Reciprocity via free audit / lead magnet** (*"Free Shopify audit — no obligation"*) — not strictly banned but high operational cost. Lucas doesn't have capacity to process free audits at ops ceiling of 1–3/mo. Would dilute the form CTA AND eat ops time. Skip.
- **Variable reward loops** (Nir Eyal's Hook Model applied to the product) — genuinely applicable to the retention/LTV story (the LTV expansion section on the LP) but requires product-side work, not campaign-side work. Flagged for Phase 2 expansion, not Phase 1 validation.
- **Controversy / contrarian hot takes** (*"Stop buying Shopify apps. Here's why."*) — tempting and attention-grabbing but risks angering the Shopify ecosystem CPG Labs will need to be embedded in long-term. One-time reach bump, long-term positioning damage. Skip.

### 13.4 Where each hook lands in the campaign

Quick mapping of which hooks touch which campaign artifact, for the operator running the changes:

| Hook | Ad copy | Ad visual | LP hero | LP body | LP FAQ | LP form | Ad scheduling |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 1. Loss aversion | ✅ | — | — | ✅ | — | — | — |
| 2. Anchoring | — | — | — | ✅ (pricing) | — | — | — |
| 3. Specificity bias | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| 4. Curiosity gap | ✅ | ✅ | — | ✅ (bridges) | — | — | — |
| 5. Pattern interrupt | — | ✅ | — | — | — | — | — |
| 6. Honest scarcity | — | — | — | — | ✅ | ✅ (final CTA) | — |
| 7. Authority (stack) | — | — | — | ✅ (how we build) | — | — | — |
| 8. Social proof (anon) | — | — | — | ✅ (sub-hero) | — | — | — |
| 9. Commitment ladder | — | — | — | — | — | ✅ | — |
| 10. Mechanism-led copy | ✅ | — | — | ✅ | ✅ | — | — |
| 11. Enter the conversation | ✅ | — | — | — | — | — | ✅ |
| 12. Identity framing | — | — | — | — | — | ✅ (final CTA) | — |

---

## Appendix A — Locked facts for future sessions

Any future session picking this up needs these facts loaded:

- **Campaign:** CPG Labs Validation v1 — 2026-04-11
- **Operator:** Lucas Guimarães (COO of GE Beauty, builder of CPG Labs)
- **Mode:** `/growth-hacker campaign-design`, site-refactor-primary
- **Constraint:** under-the-radar from GE Beauty until at least 5 closes or month 3
- **Product:** bespoke Shopify micro-services on demand, $300–$500 setup + $30–$50/mo hosting per service
- **Ops ceiling:** 1–3 new installs/month, Lucas solo
- **Budget:** $1,000 USD over 12 weeks (~$11/day), Meta only
- **Channels killed for this round:** Google Search, TikTok, LinkedIn
- **Hero headline (locked, v5):** *"How much do you spend on Shopify apps? And how much of it do you actually use?"* (question-pair. V1 was *"You're paying $29 a month for a Shopify app you half-use..."* — updated post-ship per operator request to a curiosity-gap hook that pairs with the cost-stack SVG visual as its answer.)
- **Hero subhead:** *"If the answer is 'too much for features we half-use,' we write the exact feature you'd rather have. Shipped inside your Shopify admin in days."* (No specific dollar amounts — pricing exposure above the fold is limited to the cost-stack SVG highlighted row.)
- **Primary CTA (v5):** `Get your tailored app` — scrolls to 5-field form, async 48h quote reply. (V1 was "Describe your pain" — renamed post-ship to outcome-led verb-first copy. The form field label for the pain textarea is still "What's broken in your own words" and step 1 of How-it-works is still "Describe the pain" — those are process steps that stayed pain-framed.)
- **Proof strategy:** real features + synthetic demo data + technical credibility. No named customers. No founder bio.
- **Concept A:** App bloat tax (receipt-style, weeks 1–6)
- **Concept B:** Unmet feature / search-failure (Reel, weeks 7–12)
- **Optimization event:** Link Click (not Lead — budget too low for algo to learn on conversions)
- **Target CAC:** $500 per close (validation-phase ceiling), $320 healthy
- **Companion brief:** [lp-build-brief-cpglabs-2026-04-11.md](lp-build-brief-cpglabs-2026-04-11.md)

## Appendix B — Session history

- **Phase 1 — Brief intake:** completed 2026-04-11. Iterated through 5+ pricing models before locking on $300–$500 setup + $30–$50/mo hosting (40% below Storetasker floor). Ops ceiling answer (1–3/mo) reshaped the entire campaign from "paid-primary" to "site-refactor-primary with small paid probe." Under-the-radar constraint from GE Beauty stripped out named-customer proof strategy.
- **Phase 2 — Audience + competitive scout:** completed 2026-04-11 via parallel subagents. 3 ICP personas, category pricing intel (CPG Labs 40% below Storetasker floor), 5-competitor LP teardown, pricing-transparency gap identified as category-wide opportunity.
- **Phase 7 — LP orchestration:** wireframe + copy + build brief produced 2026-04-11. LP Build Brief at [lp-build-brief-cpglabs-2026-04-11.md](lp-build-brief-cpglabs-2026-04-11.md) handed off for `/product-developer` execution.
- **Phase 4–6 — Creative sprint:** completed 2026-04-11 via parallel subagents. 2 distinct concepts (app bloat tax, search failure), full Meta copy matrix, ~50 visual prompts for Midjourney/Flux/Ideogram, message-match verdict inline.
- **Phase 3 + 8 — Strategy + deployment:** produced inline 2026-04-11 (sections 8 + 9).
- **Viral psychology hooks (section 13):** appended 2026-04-11 on operator request. 12 hooks filtered against CPG Labs's constraints, with a top-3 priority list for immediate layering and an explicit "do not use" list for future sessions.
- **LP build + first production ship (v-lp-refactor-1):** 2026-04-11. Agent-built refactor of `app/routes/_index/cpglabs-home.tsx` per the LP Build Brief, followed by a surgical commit (only LP files, excluding in-progress affiliates/storytelling work from other sessions). Deploy via `scripts/deploy-omnify.ps1` to `omnify-task:23`. Zombie ALB target deregistered manually post-deploy (IAM trust issue on `AWSServiceRoleForECS` unfixed — zombies keep recurring on most deploys).
- **White-strip hotfix (v-lp-refactor-2):** 2026-04-11. Added global `html, body { margin: 0; padding: 0; background: var(--site-bg); }` reset to `app/styles/site-theme.css` to kill the browser-default 8px body margin that was leaking through as white strips around the dark page background on mobile Safari dark mode. `omnify-task:24`.
- **Copy tightening + question-based hero (v-lp-refactor-3):** 2026-04-11. Operator pivoted the LP hero to a question-pair (*"How much do you spend on Shopify apps? And how much of it do you actually use?"*) and flagged "too much text on sections" — tightened How-it-works step bodies (~70% shorter), example cards (4 paragraphs → 4 tight lines per card, same pain/fix/outcome/works-for framework), "How we build" body, LTV body, FAQ section title (*"Before you send the form."*), final CTA body. `omnify-task:25`. Briefly exposed specific dollar amounts (*"$300 to $500 setup, $30 to $50 a month hosting"*) in the hero subhead — lived in production for ~10 minutes before operator pushback pulled it out.
- **Subhead pricing revert + CTA rename (v-lp-refactor-4):** 2026-04-11. Operator pulled pricing out of the hero subhead (kept it in the dedicated pricing section + cost-stack SVG). Primary CTA renamed from `Describe your pain` to `Get your tailored app` on both the nav button and hero CTA (outcome-led, verb-first). Step 1 title stays "Describe the pain" because that's the process step. `omnify-task:26`.
- **Even section padding + nav-hero clearance (v-lp-refactor-5):** 2026-04-11. Operator flagged nav overlapping hero on iPhone and uneven section padding. Hero top padding 48→96 mobile / 120→140 desktop to clear the 60px fixed nav. All content-section vertical padding normalized to 48px mobile / 80px desktop (down from 64 mobile / 96 desktop), producing a consistent 96px mobile / 160px desktop gap between adjacent content sections. Wedge strip stays at 24/32 as an intentional divider. `omnify-task:27`.
- **Deliverable doc sync (2026-04-11):** Both [lp-build-brief-cpglabs-2026-04-11.md](lp-build-brief-cpglabs-2026-04-11.md) §4 and this deliverable's §4/§5/§13/Appendix A were updated post-ship to reflect production reality after v3/v4/v5. Concept A/B ad copy in §6 was deliberately NOT updated — ad creative still uses the original V1 language ("$29/mo for a Shopify app you half-use") and message match to the new LP hero is now thematic, not literal. Refresh only if Concept A form CVR drops below 3% in the live campaign.
- **Phase 9 — Launch:** pending, gated on LP ship (✅ done v5) + tracking wire-up (pending `/integrations-engineer`) + pre-launch checklist.
