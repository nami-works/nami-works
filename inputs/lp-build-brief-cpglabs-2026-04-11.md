# LP Build Brief — cpg-labs.io refactor — 2026-04-11

Produced by `/growth-hacker` in `campaign-design` mode. This is a standalone handoff doc for `/product-developer`. Read it top to bottom before opening the codebase.

## Context (why this brief exists)

CPG Labs is running a `$1,000 / 3-month` paid validation campaign. Ops ceiling is 1–3 new merchant installs per month (solo capacity). At that volume, paid ads are a small probe and **the site refactor is ~90% of the campaign**. Every visitor to cpg-labs.io matters disproportionately, so the refactor has to convert warm organic + referral + small paid traffic at a rate well above a typical SaaS LP.

The current homepage at [app/routes/_index/cpglabs-home.tsx](../app/routes/_index/cpglabs-home.tsx) is a skeleton shipped on 2026-04-10 with placeholder copy and a structure built for a high-ticket agency model. It needs to be refactored in place to reflect the actual CPG Labs model: **bespoke Shopify micro-services built on demand, priced between $300–$500 setup + $30–$50/mo hosting per service.**

Brand voice rules are strict — see "Brand voice constraints" below. Any violation is a launch blocker.

---

## 1. Route + file scope

**Refactor in place** at [app/routes/_index/cpglabs-home.tsx](../app/routes/_index/cpglabs-home.tsx) + [app/routes/_index/cpglabs-home.module.css](../app/routes/_index/cpglabs-home.module.css).

**Do NOT touch** any of the following:
- [app/routes/_index/route.tsx](../app/routes/_index/route.tsx) — host-aware dispatcher (variant resolution stays as-is)
- [app/routes/_index/omnify-home.tsx](../app/routes/_index/omnify-home.tsx) — Omnify homepage (zero changes)
- [app/routes/_site.tsx](../app/routes/_site.tsx) — host guard (stays)
- [app/routes/_site.*](../app/routes/) — Omnify marketing pages (no changes)
- [app/components/cpglabs-layout/index.tsx](../app/components/cpglabs-layout/index.tsx) — nav + footer (small label updates only, see section 4)
- Anything under [app/routes/app.*](../app/routes/) — Shopify embedded app
- Any Terraform, Dockerfile, or deploy script

**Keep but rewrite** (existing bits that the wireframe reuses):
- The `<Form method="post">` pattern with `actionData` success/error handling — already wired. Extend to accept 5 new fields (see section 5).
- The existing `action` handler's `intent=lead` branch that writes to `waitlistSubscriber` with `source: "cpglabs-home"`. Keep the source value. Extend the accepted fields.
- The FAQ `<details>` pattern for collapsible Q&A.
- CSS module structure + the brand tokens already in [app/styles/site-theme.css](../app/styles/site-theme.css) (`--site-holo-gradient`, `--site-bg`, `--site-text`, `--site-border`, `--site-font`). No new root tokens.

**Remove outright:**
- `heroEyebrow` — "Build-to-suit software for CPG brands" — eats fold height, cut it
- The 4-step `HOW_IT_WORKS` array — collapse to 3 steps (see section 3)
- The 3-card `WHY_POINTS` "Why CPG Labs" section — redundant with the new Tech Credibility section
- The entire `#proof` section (6-slot logo grid + placeholder `<blockquote>`) — no named customers, no testimonials in the refactor
- The side-by-side `contactGrid` (Book a call + Form as equal cards) — demote Calendly to a text link below the form
- `heroVisual` / `appStack` JSX — replace with a single inline SVG, see section 6
- The placeholder `CALENDLY_URL` constant stays for now (still `https://calendly.com/cpg-labs/fit-call`) — will be updated in a separate step

---

## 2. Mobile-first wireframe (390px)

```
┌───────────────────────────────┐
│ LOGO      [Tailored app btn]  │  NAV (sticky, 56px)
├───────────────────────────────┤
│ [HEADLINE Q1 + Q2 on 2 lines] │
│ [SUBHEAD 1-2 lines]           │
│                               │
│ ┌───────────────────────────┐ │
│ │  Get your tailored app →  │ │  HERO (CTA lands ≤480px)
│ └───────────────────────────┘ │
│  or book a call (text link)   │
│                               │
│ [HERO VISUAL: cost-stack SVG] │
├───────────────────────────────┤
│ [pain1]  [pain2]  [pain3]     │  WEDGE STRIP (chips)
├───────────────────────────────┤
│ How it works                  │
│ 01 Describe the pain          │
│ 02 Scoped quote in 48h        │  HOW (3 stacked)
│ 03 Shipped in days            │
├───────────────────────────────┤
│ Example builds                │
│ ┌───────────────────────────┐ │
│ │ [SHOT 1 — 16:10 blurred]  │ │
│ │ Example 1 title           │ │
│ │ Pain body                 │ │  GALLERY (2 tall cards)
│ │ Fix body                  │ │
│ │ Outcome                   │ │
│ │ Works for: a, b, c        │ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │ [SHOT 2 — 16:10 blurred]  │ │
│ │ Example 2 ...             │ │
│ └───────────────────────────┘ │
├───────────────────────────────┤
│ How we build                  │
│ [STACK ROW wraps]             │  TECH CREDIBILITY
│ [ARCH NOTE body]              │
├───────────────────────────────┤
│ Pricing                       │
│ Setup:   $300 to $500         │  PRICING (transparent)
│ Hosting: $30 to $50 /mo/svc   │
├───────────────────────────────┤
│ Start with one, add more      │
│ [Build1] → [+B2] → [+B3]      │  LTV timeline (horiz)
├───────────────────────────────┤
│ FAQ                           │
│ ▸ Q1                          │
│ ▸ Q2 (5 items, <details>)     │  FAQ
├───────────────────────────────┤
│ Tell us what's eating        │
│   your week.                  │
│ [store URL]                   │
│ [pain textarea]               │  FINAL CTA FORM
│ [current workaround]          │
│ [timeline select]             │
│ [email]                       │
│ [      Send it      ]         │
│ Prefer to talk? Book a call   │
├───────────────────────────────┤
│ Privacy · Terms · Omnify      │  FOOTER
└───────────────────────────────┘
```

**Above-the-fold check (390 × 600):**

| Element | Height | Running y |
|---|---:|---:|
| Nav sticky | 56 | 56 |
| Hero top pad | 24 | 80 |
| Headline (2 lines @ 32px/1.15) | ~76 | 156 |
| Gap | 12 | 168 |
| Subhead (1 line @ 16px/1.5) | ~24 | 192 |
| Gap | 20 | 212 |
| **Primary CTA (48px button)** | **48** | **260** |
| "or book a call" link | 20 | 280 |

CTA bottom edge at ~260px. Well under the 600px fold budget. Hero visual starts around 320px and extends past 600 — that's fine because CTA has already landed. **Constraint: the hero visual MUST be a single inline SVG, no raster image, no iframe, no third-party embed.** Raster hero = LCP blown.

## 3. Desktop wireframe (1280px)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ LOGO    How  Examples  Pricing  FAQ       [Get your tailored app]        │  NAV
├──────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────┐   ┌──────────────────────────────────────┐  │
│ │ [HEADLINE 2 lines]       │   │                                      │  │
│ │ [SUBHEAD]                │   │   [HERO VISUAL: cost-stack SVG]      │  │
│ │ [ Get your tailored app →]│   │                                      │  │
│ │   or book a call         │   │                                      │  │
│ └──────────────────────────┘   └──────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│         [pain1]        [pain2]        [pain3]                            │
├──────────────────────────────────────────────────────────────────────────┤
│ How it works                                                             │
│ ┌──────────┐  ┌──────────┐  ┌──────────┐                                 │
│ │ 01 Desc. │  │ 02 Quote │  │ 03 Ship  │                                 │
│ └──────────┘  └──────────┘  └──────────┘                                 │
├──────────────────────────────────────────────────────────────────────────┤
│ Example builds                                                           │
│ ┌───────────────────────────┐   ┌───────────────────────────┐            │
│ │ [SHOT 1]                  │   │ [SHOT 2]                  │            │
│ │ Example 1 title           │   │ Example 2 title           │            │
│ │ Pain + fix + outcome      │   │ Pain + fix + outcome      │            │
│ │ Works for: ...            │   │ Works for: ...            │            │
│ └───────────────────────────┘   └───────────────────────────┘            │
├──────────────────────────────────────────────────────────────────────────┤
│ How we build                                                             │
│ [STACK ROW]    │    [ARCH NOTE]    │    [3 bullet points]                │
├──────────────────────────────────────────────────────────────────────────┤
│ Pricing   Setup $300-$500         │    Hosting $30-$50 /mo/svc           │
├──────────────────────────────────────────────────────────────────────────┤
│ Start with one, add more                                                 │
│ [Build1] ───► [+Build2] ───► [+Build3] ───► ...                          │
├──────────────────────────────────────────────────────────────────────────┤
│ FAQ                                                                      │
│ ▸ Q1  ▸ Q2  ▸ Q3  ▸ Q4  ▸ Q5                                            │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────┐   ┌──────────────────────────────────────┐  │
│ │ Tell us what's eating    │   │ Prefer to talk it through?           │  │
│ │ [5 fields]               │   │ [ Book a call (Calendly text link) ] │  │
│ │ [    Send it    ]        │   │ 20 min, no pitch.                    │  │
│ └──────────────────────────┘   └──────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────────────┤
│ Privacy · Terms · Omnify                                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Copy — full text, section by section

Everything below goes on the page verbatim. No edits, no improvements, no "making it sound better." Brand voice is a hard constraint. If something reads wrong, flag it and I'll rewrite — don't rewrite yourself.

> **Post-ship revision note (2026-04-11):** This section was updated after the initial ship to reflect production reality. The original V1 hero (*"You're paying $29 a month..."*), the "Describe your pain" CTA, and the verbose Example/How-it-works/LTV/FAQ bodies have all been superseded by a question-based hero, a tightened copy pass, and a renamed CTA. The changes landed in v-lp-refactor-3 (tightening) and v-lp-refactor-4 (subhead pricing revert + CTA rename). The text below is what's actually live. Concept A / B ad creative in the growth deliverable still uses the V1 language — message match between ad hook and LP headline is now **thematic, not literal** (both hit the app-bloat pain but with different wording), and the campaign's copywriter output in `inputs/growth-cpglabs-validation-v1-2026-04-11.md` §6 has been left untouched because ad creative refresh is a separate operator decision.

### NAV

**Wordmark:** `CPG Labs`

**Desktop links** (anchor jumps, `href="#examples"` etc.):
- `How it works` → `#how-it-works`
- `Example builds` → `#examples`
- `Pricing` → `#pricing`
- `FAQ` → `#faq`

**Primary button (right side):** `Get your tailored app` → `#pain-form`

### HERO

**Headline (locked — this is the message-match foundation for the LP, paired with the SVG cost-stack visual):**

> How much do you spend on Shopify apps?
> And how much of it do you actually use?

The second line is rendered as a `<span class="heroEmphasis">` inside the same `<h1>`, with a hard `<br />` between the two sentences to force a clean line break regardless of viewport width.

**Subhead:**

> If the answer is "too much for features we half-use," we write the exact feature you'd rather have. Shipped inside your Shopify admin in days.

Pricing is NOT exposed in the subhead. The category-differentiation pricing anchor lives in the dedicated Pricing section below (§4 PRICING) and on the cost-stack SVG's highlighted `CPG Labs · $300 to $500 setup` row in the hero visual. Having the number in the SVG visual but NOT in the subhead was the operator's explicit call (see post-ship revision note above).

**Primary CTA button:** `Get your tailored app`

**Secondary link** (text, below the button): `or book 20 minutes to talk it through`

### WEDGE STRIP (after hero)

Three inline chips, each scrolls to the matching example or section:

- `App bloat tax`
- `Unmet feature`
- `Ship in days`

Style: small pill buttons, subtle border, no icons. Not primary interactive affordances — just visual anchors.

### HOW IT WORKS

**Section title:** `From pain to shipped, in three steps.`

**Step 1 — `01 Describe the pain`**

Five fields. No sales call.

**Step 2 — `02 Get a scoped quote`**

Written scope, fixed setup fee, monthly hosting, in 48 hours.

**Step 3 — `03 Ship in days`**

Built as an embedded app. Test on your store before you pay.

### EXAMPLE BUILDS

**Section title:** `Example builds.`

**Subtitle (smaller, muted):** `Synthetic data. Your build is scoped to your store.`

#### Example 1 — Inventory sync with auto-reconciliation

**Pain.** Stock drift across Shopify, Amazon, and wholesale. Every Monday someone manually reconciles.

**Fix.** Webhook-driven sync inside your Shopify admin. Emails a summary only when a human is actually needed.

**Outcome.** 4 hours of weekly reconciliation, gone.

**Works for:** food and beverage, beauty, and supplements running multi-channel.

#### Example 2 — Conditional pricing with customer-tag logic

**Pain.** Wholesale tiers, subscriber discounts, and bundle rules stacking 3 or 4 apps that collide at checkout.

**Fix.** One embedded app reading customer tag, order history, and cart to apply the right rule at checkout.

**Outcome.** Zero stacked-discount incidents in 4 months.

**Works for:** food and beverage, beauty subscriptions, supplements with kits and bundles.

### HOW WE BUILD (technical credibility)

**Section title:** `Production code, not prototypes.`

**Body (single short paragraph):**

Built on the same stack Shopify uses for its own embedded apps. Real logging, real backups, real embedded apps. AI handles the boilerplate. A senior engineer reviews every line that touches your store.

**Stack row** (below the paragraph, horizontal list of small labels, no logos — just text):

`React Router  ·  TypeScript  ·  Prisma  ·  Shopify Admin API  ·  AWS`

### PRICING

**Section title:** `You pay for the service, not the feature count.`

**Two-column body:**

| Setup fee | Hosting |
|---|---|
| **$300 to $500** per service, one time | **$30 to $50** per month per service |
| Charged after you test it on your store and sign off. | Covers AWS, monitoring, and ongoing fixes. |

**Footnote below the table:**

No per-seat, no per-order, no usage tiers. One service, one line item. Cancel a service and the line item goes away. You own your data. We host the code.

### LTV EXPANSION

**Section title:** `One app. Add to it over time.`

**Body:**

Start with one service. Add more as new bottlenecks show up, all inside the same CPG Labs app. Same login, one monthly bill.

**Visual element:** horizontal timeline (on desktop) or horizontal-scroll card row (on mobile) showing three labeled nodes with arrows between them: `Build 1` → `+ Build 2` → `+ Build 3`. Each node is a small rounded card with placeholder text like "auto-tagger," "inventory sync," "custom report." Static SVG or CSS, no animation.

### FAQ

**Section title:** `Before you send the form.`

5 `<details>` items (closed by default):

**Q1 — `Is this actually reliable, or is it a two-hour hack?`**

Every build runs on AWS with logging, error alerts, and database backups, the same setup we would use for a production app. The two-hour number is how fast AI-assisted development lets us ship the first working version. It's reviewed, tested on your store, and monitored after launch.

**Q2 — `Who owns the code if I stop paying?`**

You own your data forever, exported on request in standard formats. The code itself stays with us so we can maintain it across merchants, but we will never hold your store hostage. If you cancel, the service turns off cleanly and your Shopify admin goes back to exactly how it was.

**Q3 — `Will this lock me into your platform?`**

The app is a standard Shopify embedded app. Uninstalling it removes it from your admin the same way any app does. We do not modify your theme files, your product data, or your checkout. Whatever we build sits alongside Shopify, not on top of it.

**Q4 — `What about maintenance when Shopify changes their API?`**

Hosting covers that. When Shopify deprecates an API version or ships a breaking change, we update your service before it breaks. You do not get a support ticket, you get a note that we already fixed it.

**Q5 — `How fast can you actually ship?`**

Most single-feature builds are scoped within 48 hours and shipped within 5 to 10 business days. Bigger builds take longer and we will tell you that in the scope. If we cannot ship something in a reasonable window, we say no instead of dragging it out.

### FINAL CTA

**Section title:** `Tell us what's eating your week.`

**Body (short paragraph above the form):**

Five fields, no call. Fixed price and timeline back in 48 hours. If it's not a fit, we say so.

**Form fields (see section 5 for the full spec).**

**Primary button:** `Send it`

**Secondary text link (below the form):** `Or book 20 minutes to talk it through`

### FOOTER

**Tagline:** `Custom software for Shopify stores. Priced like an app.`

**Links:** `How it works · Example builds · Pricing · FAQ · Privacy · Terms · Omnify`

**Copyright line:** `© CPG Labs`

The `Omnify` link goes to `https://omnify.cpg-labs.io` (absolute, hard browser navigation across hosts — not a `<Link>`).

---

## 5. Form spec

The form is a single `<Form method="post">` that posts to the `_index` `action` with `intent=lead`. Extend the existing action to accept and persist these 5 fields.

| Field | Type | Required | Validation | Autocomplete |
|---|---|:-:|---|---|
| `store_url` | `<input type="url">` | yes | starts with `http://` or `https://`, has a `.` in the host | `url` |
| `pain` | `<textarea rows={4}>` | yes | min 20 chars, max 1000 chars | `off` |
| `workaround` | `<textarea rows={2}>` | no | max 500 chars | `off` |
| `timeline` | `<select>` | yes | one of: `asap`, `this_month`, `this_quarter`, `exploring` | `off` |
| `email` | `<input type="email">` | yes | standard email regex | `email` |

**Validation:**
- Inline (as the user types), not on submit
- Error messages name the fix, not the problem: `"We need an email with an @ so we can reply"` ✅, `"Invalid email"` ❌
- No reCAPTCHA, no Turnstile. Honeypot only (hidden `website` field — if populated, reject silently).

**Timeline `<select>` options (labels the user sees):**
- `ASAP — it's breaking something now`
- `This month`
- `This quarter`
- `Just exploring for now`

**Action handler extension:**

The existing `action` already handles `intent=lead` and writes to `waitlistSubscriber` with `source: "cpglabs-home"`. Extend it:

```ts
if (intent === "lead") {
  const store_url = formData.get("store_url");
  const pain = formData.get("pain");
  const workaround = formData.get("workaround") ?? null;
  const timeline = formData.get("timeline");
  const email = formData.get("email");
  const honeypot = formData.get("website");

  if (honeypot) return json({ ok: true }); // silent reject
  // validate + persist
  // existing waitlistSubscriber.create with expanded metadata
}
```

The 4 new fields (store_url, pain, workaround, timeline) can be persisted as a JSON blob on `waitlistSubscriber` — or as discrete columns if the schema gets expanded. Confirm with [prisma/schema.prisma](../prisma/schema.prisma) before choosing. Keep `source: "cpglabs-home"` for attribution.

**Success state:** replace the form with a short message, not a redirect: `"Thanks. We'll read this and reply within 48 hours."` No auto-opening of Calendly.

**Error state:** inline above the submit button. Preserve field values.

---

## 6. Visual assets

### 6.1 Hero visual — cost-stack SVG

One inline SVG, served directly in the JSX (not an `<img src>`). Shows a "stack of app subscriptions" next to "one CPG Labs app." Visual metaphor: 6 stacked rows labeled with fake app names and prices summing to ~$174, crossed out, next to 1 row labeled "CPG Labs · $300–$500 setup."

Design notes:
- Max 60KB SVG weight
- Uses the site's holo gradient token for the CPG Labs row
- Labels are `<text>` elements, not raster (stay crisp at any zoom)
- No animation — LCP must be clean
- Mobile: takes ~60vw width, scales proportionally

This replaces the current `appStack` JSX structure. **Do not render it via `<img>` or lazy-load it** — the LCP element should be the headline text, and the SVG can be inline after.

### 6.2 Example build screenshots (×2)

Two blurred screenshots of real CPG Labs embedded app UI populated with **synthetic demo data**. `/growth-hacker` will produce a separate Visual Asset Brief for these after this document is approved — but the build brief reserves two slots with the following spec:

- **Format:** `.webp`, 16:10 aspect ratio, max 200KB each
- **Dimensions:** 1600×1000 source, served at 800×500 for mobile 2x retina
- **Placement:** inside each example card, above the text
- **Alt text:** `"Example screenshot, synthetic demo data"`
- **Placeholder while assets are being produced:** use a gradient-filled `<div>` with the `CPG Labs` wordmark centered, so the layout ships without waiting for assets

Store the real files under `public/images/cpglabs/examples/example-1-inventory-sync.webp` and `public/images/cpglabs/examples/example-2-conditional-pricing.webp` when available.

### 6.3 LTV timeline illustration

CSS-only (no image asset). Three rounded cards in a row with `→` arrows between them using inline SVG or Unicode. Each card has a small rounded icon placeholder and a label.

---

## 7. CSS + layout conventions

- **CSS module at route level:** extend [app/routes/_index/cpglabs-home.module.css](../app/routes/_index/cpglabs-home.module.css). No inline styles except for runtime-computed values.
- **Mobile-first:** primary breakpoint at `768px`. Desktop styles inside `@media (min-width: 768px)`.
- **Tokens:** use existing `--site-holo-gradient`, `--site-bg`, `--site-text`, `--site-border`, `--site-font`. No new root tokens.
- **Nav sticky:** `position: sticky; top: 0; z-index: 10;` on the nav container.
- **Card border radius:** match existing site tokens.
- **Body font size mobile:** minimum `16px` (prevents iOS auto-zoom on form inputs).
- **Hero headline:** ~32px mobile, ~48px desktop, line height 1.15. Do NOT use a font larger than this on mobile — it will push the CTA below the fold.

---

## 8. Brand voice constraints (hard)

Any violation is a launch-blocker. Re-read the final file against this list before marking the task complete.

- **No em dashes** in customer-facing copy. Use commas or periods. (Yes, also in the FAQ answers. Yes, also in the footer tagline.)
- **No hype verbs:** no "10x," "scale," "transform," "revolutionize," "unlock," "supercharge," "game-changer," "boost," "drive growth."
- **No earnings or revenue-lift claims.** No "increase your revenue," "grow your store," "more sales." FTC-adjacent risk, Meta disapproval risk.
- **Never imply Shopify endorsement.** "Custom software for Shopify stores" ✅. "Shopify Partner" / "Shopify-certified" / any use of the Shopify logomark ❌.
- **No named customers.** No "built by the team behind GE Beauty." No real store logos. No testimonial quotes attributed to a real person.
- **No founder bio or personal branding.** CPG Labs speaks as "we," never as "I" or "Lucas."
- **English only.** No mixed PT/EN.
- **Concrete over abstract.** Every claim paired with a specific example where possible. This is already done in the copy above — preserve it.

---

## 9. Core Web Vitals budget (mobile 4G)

| Metric | Budget | Launch blocker if |
|---|---|---|
| LCP (Largest Contentful Paint) | `< 2.5s` | `> 2.5s` on mobile 4G |
| CLS (Cumulative Layout Shift) | `< 0.1` | `> 0.1` |
| INP (Interaction to Next Paint) | `< 200ms` | `> 200ms` |
| Page weight above the fold | `< 1MB` | `> 1MB` |

**Rules to hit the budget:**
- Hero visual is inline SVG, not raster
- All example screenshots lazy-loaded with `loading="lazy" decoding="async"` (they are below the fold)
- No third-party scripts above the fold
- No web fonts that block render — use system fonts or `font-display: swap` with a subset
- No Calendly embed — it is a text link only
- The LCP element should be the hero headline text, not any visual
- No hero carousel, no hero video, no hero animation

**Verification (after build):**
- Run PageSpeed Insights on the deployed URL (not just localhost)
- Check mobile Lighthouse score — target 90+ on Performance
- Check the real-device mobile test (`/growth-hacker` will run this in Phase 7F review)

---

## 10. Tracking (out of scope for this brief — separate handoff)

This brief does NOT include Pixel / CAPI / GA4 / UTM wire-up. That goes to `/integrations-engineer` via a separate **LP Tracking Brief** produced by `/growth-hacker` after the build ships. The reason: tracking must be wired against the final, shipped DOM — not against a wireframe that might drift during build.

**What the build can pre-wire to make tracking easier later:**
- Every CTA button should have a stable `id` attribute (`id="hero-cta"`, `id="form-submit"`, `id="footer-cta"` etc.) so tracking selectors don't break on class renames
- The form submit should emit a `submit` event on the `<form>`, not swallow it before tracking can fire
- Keep the existing `intent=lead` pattern intact so server-side attribution works

**Do NOT add** any analytics, Pixel, GA4, or tracking script in this refactor. `/integrations-engineer` handles all of that post-build.

---

## 11. Out of scope (explicit)

Things that are NOT part of this task:

- `app/routes/_index/omnify-home.tsx` — zero changes
- `app/routes/_index/route.tsx` dispatcher — zero changes
- `app/routes/_site.*` routes — zero changes
- `app/components/cpglabs-layout/index.tsx` — **small exception**: update the footer link labels if the current ones drift from the "Privacy · Terms · Omnify" set. Otherwise no changes.
- The `CALENDLY_URL` constant value — keep as-is. `/growth-hacker` will update it in a follow-up step once the Calendly event exists.
- Pixel, CAPI, GA4, Meta tracking — `/integrations-engineer` handles post-build
- Visual assets (hero SVG content, example screenshots) — use gradient placeholders, real assets delivered separately
- Any i18n / localization — English only, single locale
- Any Shopify config changes (`shopify.app.*.toml`) — no scope changes
- Any Terraform or infra changes — no infra changes
- Any deploy — `/growth-hacker` will trigger the deploy after review

---

## 12. Success criteria

Mark this task complete only when ALL of the following are true:

- [ ] All 11 sections from section 2/3 render per the wireframe on 390px mobile AND 1280px desktop
- [ ] Primary CTA (`Get your tailored app`) is visible above the fold on 390px mobile — verified on a real iPhone, not just Chrome DevTools
- [ ] Hero headline matches the locked V1 text exactly (section 4, Hero)
- [ ] All 5 form fields present with autofill attributes, inline validation, and honeypot
- [ ] Existing `action` handler extended to accept and persist the 5 fields under `source: "cpglabs-home"`
- [ ] Success + error states on the form work (tested locally)
- [ ] All copy in section 4 is on the page verbatim — no edits, no "improvements"
- [ ] Zero em dashes in any customer-facing string
- [ ] No named customers, no founder bio, no testimonials
- [ ] LCP < 2.5s on mobile Lighthouse
- [ ] CLS < 0.1, INP < 200ms
- [ ] Page weight above the fold < 1MB
- [ ] No console errors or warnings on page load
- [ ] No console errors or warnings on form submit
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] The existing `/site.*` routes still 200 (host-guard still works)
- [ ] The Omnify homepage at `omnify.cpg-labs.io` is unchanged (same bytes as before)

## 13. Review checkpoint

After `/product-developer` marks the build complete, `/growth-hacker` runs a **Phase 7F post-build review** before any tracking wire-up or paid traffic:

1. Load the URL in a real mobile browser on real 4G (not dev server)
2. Verify wireframe match — headline, subhead, hero, primary CTA all above the fold
3. Verify copy match — no "helpful" rewrites
4. Verify brand voice — no em dashes, no clinical claims, no hype verbs
5. Run PageSpeed Insights on the mobile URL
6. Verify form submit writes to `waitlistSubscriber` with `source="cpglabs-home"` and all 5 fields
7. Check primary CTA is fat-finger-friendly (min 44px tap target)

If any check fails: fix list goes back to `/product-developer`, tracking wire-up does NOT start until the list is cleared.

If all checks pass: `/growth-hacker` produces the **LP Tracking Brief** and hands it to `/integrations-engineer`.

---

## 14. Kickoff

When you're ready to start, read:
1. This brief top to bottom
2. [app/routes/_index/cpglabs-home.tsx](../app/routes/_index/cpglabs-home.tsx) (current state)
3. [app/routes/_index/cpglabs-home.module.css](../app/routes/_index/cpglabs-home.module.css) (current state)
4. [CLAUDE.md](../CLAUDE.md) (project conventions)

Then execute in this order:
1. Replace the copy strings in the existing component with the locked copy from section 4
2. Restructure the JSX to match the wireframe (cut the sections in "Remove outright," add the new ones)
3. Update the CSS module to match the new section layout
4. Extend the form + action handler for the 5 new fields
5. Ship the hero cost-stack SVG inline
6. Run lint + typecheck
7. Local mobile test at 390px viewport
8. Report back to `/growth-hacker` for Phase 7F review

If anything in this brief is unclear, ask `/growth-hacker` before building — do not make creative judgment calls on copy, layout, or pricing numbers. Those are all locked.
