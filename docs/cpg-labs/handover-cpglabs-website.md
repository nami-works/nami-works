# Session Handover — 2026-04-04

## How the agent team worked (methodology for next session)

This session pioneered a **multi-agent product development workflow** combining research agents, build agents, and a Figma-to-code design loop. Here's what worked, what didn't, and how to improve.

### What worked brilliantly

**1. Parallel research agents (Wave 1)**
Two agents launched simultaneously — Compliance Auditor + Competitive Intel. Each took ~2-3 minutes. Their output fed the Product Architect with real data instead of guesses. This pattern is ideal for any project that needs domain research before design.

**2. Plan mode for design feedback**
Using Plan mode with ASCII mockups let the user give precise, inline comments on specific sections. The plan file became a living design doc that both parties iterated on. The user could approve/reject individual elements before any code was written.

**3. Parallel build agents (Wave 3)**
4 agents built simultaneously in isolated worktrees: Layout+Theme, Home Page, Legal Pages, Pricing/About/Contact. Total build time ~3 minutes for 7 complete pages. The merge was clean because each agent had non-overlapping file ownership.

**4. Figma as the design iteration surface**
The Figma MCP + Playwright at 375px created a true visual feedback loop: code -> preview HTML -> Figma capture -> user edits in Figma -> sync back to code. The user could directly edit text and see the result without waiting for code changes.

### What didn't work well

**1. Figma text editability**
Captured HTML-to-Design frames produce read-only text nodes. The workaround (load fonts + re-write characters) works but is fragile and needs to be run after every recapture. **Next session should automate this** — create a utility function that runs after every Figma capture.

**2. Preview HTML drift**
The static preview HTML files quickly fell out of sync with the React component code. Every text change required updating both the `.tsx` file AND the `preview-*.html` file. **Next session should consider** either:
- Auto-generating preview HTMLs from the component code
- Or abandoning preview HTMLs entirely if `shopify app dev` can be made to work for public routes

**3. Figma recapture overhead**
Each Figma recapture cycle (generate ID -> navigate Playwright -> wait -> poll -> swap frame -> make text editable) takes ~45 seconds and produces massive tool output that fills the context window. This was the primary driver of context pressure. **Next session should**:
- Only recapture pages that actually changed (not all 5 every time)
- Batch text changes and recapture once at the end, not after every small edit
- Consider using `use_figma` (Plugin API) for text-only changes instead of recapturing

**4. Worktree conflicts**
Git worktree creation failed intermittently (`EEXIST` errors). One agent had to run directly on the main repo instead of in isolation. **Next session should** clean up `.claude/worktrees/` at the start.

### Recommended approach for next session

1. **Start with the handover** — read `docs/handover-cpglabs-website.md` and `memory/project_cpglabs_website.md`
2. **Use Plan mode** for any architectural decisions (deployment strategy, email capture approach)
3. **Deploy agents in parallel** for independent build tasks — assign each agent specific, non-overlapping files
4. **Minimize Figma recaptures** — batch visual changes, recapture only changed pages
5. **For text-only changes**, use `mcp__figma__use_figma` Plugin API to edit text directly instead of recapturing
6. **Commit incrementally** — don't let all changes pile up uncommitted

## What was done

### Research (Wave 1)
- **Compliance Auditor agent** produced a full Google GBP API agency approval checklist — mandatory pages, privacy policy language, OAuth consent screen requirements, 7-day disassociation clause, sensitive scope verification, demo account readiness
- **Competitive Intelligence agent** analyzed Yext, Uberall, Birdeye, Rio SEO, Moz Local, Synup — extracted trust signal patterns, pricing transparency as differentiator, "Shopify-native" as unique positioning angle

### Design (Wave 2)
- **Product Architect** (via product-development skill) designed full site spec through Plan mode with user feedback iterations — 7 pages, mobile-first, Apple-inspired aesthetic
- Plan approved with user feedback on: pillar names (Show Up / Go Local / Expand), pricing tiers (Start $25 / Grow $49 / Scale $99), rotating placeholder domains, "leveling the playing field" mission copy

### Build (Wave 3 — 4 parallel agents)
- **Agent 1:** Shared layout (`_site.tsx`, `app/components/site-layout/`), theme system (`app/styles/site-theme.css`), anti-FOUC script in `root.tsx`
- **Agent 2:** Home page (`_index/route.tsx`) — hero with typing animation, 3 pillar cards, GBP health check with waitlist capture, Built With, final CTA
- **Agent 3:** Legal pages — Privacy (upgraded with Google Limited Use disclosure + 6 prohibitions), Terms (7-day disassociation), Security (6-card grid with SVG icons)
- **Agent 4:** Pricing (collapsible Start/Scale cards, 3D holographic border on Grow), About (mission + Omnify product card), Contact (4 items with SVG icons)

### CSS refactor
- All 8 CSS files refactored from desktop-first (`max-width: 768px`) to **mobile-first** (`min-width: 769px`)
- Section padding tightened for mobile: 120px -> 56px, hero 140px -> 100px, etc.

### Figma design loop
- Established bidirectional Figma-to-code workflow using Figma MCP + Playwright at 375px
- Created static preview HTML files served via http-server for Figma capture (can't run `shopify app dev` without env vars)
- Interactive prototype with hamburger menu overlay and cross-page navigation
- Multiple rounds of text iteration directly in Figma, synced back to code

### Text iterations (from Figma edits)
- Hero: "Your stores deserve to be found" -> "Make your store **IMPOSSIBLE** to miss!"
- Subtitle: added/removed bold emphasis through several rounds
- Pillar headings: "Be found where..." -> "Let your **customers find you**...", "Deliver on the promise" -> "Promise, and **deliver**", "Know where to open next" -> "Know exactly what door to **open next**"
- GBP section: "Free GBP Health Check" -> "Free Google Health Check"
- Built section: "Built on" -> "Built with", "Shopify/Integrated" -> "Your store/accurate data"
- Final CTA: "...store locations?" -> "...offline footprint?"
- About page: completely rewritten mission copy with bold/underline emphasis
- Pricing: added "Everything in Start, plus:" to Grow features, "See details" on collapsed cards

### Brand
- Nav logo changed from CPG Labs holographic box to **Omnify sticker** (`omnify_sticker.png`) + "Omnify"
- Footer: "Omnify is a product of [holographic box inline] CPG Labs."

## Key decisions

1. **Built inside existing React Router app** (not a separate static site) — public routes don't use Shopify auth, precedent exists with `privacy.tsx`. Keeps one codebase, one deployment.
2. **Mobile-first CSS** — base styles are mobile (375px), desktop enhancements via `@media (min-width: 769px)`. User explicitly requested this approach.
3. **GBP Health Check is Phase 1 (waitlist only)** — can't scan GBP without the API access we're applying for. "Scan Now" shows email capture. Phase 2 adds real scanning post-approval.
4. **Pricing: flat tier steps** — Start $25 (3 locations), Grow $49 (10 locations, +$7 each), Scale $99 (10 locations, +$10 each). No free tier. Start/Scale collapsed by default, Grow always expanded.
5. **Omnify branding in nav, CPG Labs in footer** — site is cpg-labs.io (company) but the product (Omnify) leads the nav. Footer establishes the company-product relationship for Google compliance.
6. **Preview HTML approach** — since `shopify app dev` needs tunnel + env vars, we created standalone HTML files (`preview-*.html`) served via `npx http-server` on port 3458 for Figma capture. These are NOT the production code — they mirror the React components.

## What's pending

1. **Desktop CSS** — `@media (min-width: 769px)` blocks exist but haven't been visually verified. Need to expand pillar grids to 3-col, pricing to 3-col, security to 2-col, show nav links, etc.
2. **Email capture backend** — the "Notify Me" waitlist flow has no server action. Needs a Prisma model or external service integration.
3. **Google Health Check backend** — Phase 2 implementation after GBP API approval.
4. **Deployment to cpg-labs.io** — public routes need to be served at the root domain. Currently the app is at omnify.cpg-labs.io. DNS/ALB routing decision needed.
5. **Google compliance checklist** — register CPG Labs GBP listing (60-day clock), verify cpg-labs.io in Search Console, configure OAuth consent screen, prepare YouTube walkthrough video.
6. **Privacy/Terms pages not in _site layout** — `privacy.tsx` is standalone (imports SiteNav/SiteFooter directly). Terms/Security are under `_site.tsx`. Consider unifying.
7. **Preview HTML cleanup** — 5 preview HTML files in project root are for Figma capture only. Should be gitignored or deleted before deploy.
8. **Dark mode** — theme toggle exists, CSS vars defined for dark, but not visually tested. The preview HTMLs only show light mode.

## Modified files

### New files (this session) — Complete
- `app/components/site-layout/index.tsx` — SiteNav, SiteFooter, ThemeToggle
- `app/components/site-layout/styles.module.css` — nav/footer styles
- `app/routes/_site.tsx` — shared layout with Outlet
- `app/routes/_site.pricing.tsx` + `_site.pricing/styles.module.css`
- `app/routes/_site.about.tsx` + `_site.about/styles.module.css`
- `app/routes/_site.contact.tsx` + `_site.contact/styles.module.css`
- `app/routes/_site.terms.tsx` + `_site.terms/styles.module.css`
- `app/routes/_site.security.tsx` + `_site.security/styles.module.css`
- `app/styles/site-theme.css` — CSS custom properties for light/dark

### Modified files (this session) — Complete
- `app/root.tsx` — added theme CSS import + anti-FOUC inline script
- `app/routes/_index/route.tsx` — complete rewrite from Shopify login to marketing landing page
- `app/routes/_index/styles.module.css` — complete rewrite, mobile-first
- `app/routes/privacy.tsx` — upgraded with Google compliance sections
- `app/routes/privacy/styles.module.css` — rewritten with CSS vars

### Scaffolding — Cleanup
- `preview-site.html`, `preview-pricing.html`, `preview-security.html`, `preview-about.html`, `preview-contact.html` — static HTML for Figma capture, not production code

## Current state

- **TypeScript:** 0 errors (`npx tsc --noEmit` passes)
- **ESLint:** 0 errors on all new/modified files
- **Not committed** — all changes are unstaged in the working tree
- **Figma file:** `figma.com/design/6pOJsqTLGVNOWFUzXXrS3e` — 5 mobile frames (Home, Pricing, Security, About, Contact) + Menu overlay, all with interactive prototype navigation
- **Local preview:** `http://localhost:3458/preview-*.html` (requires `npx http-server . -p 3458` from project root)
- **Cannot test with `shopify app dev`** — needs Shopify env vars + tunnel. Public routes work in production but not in local dev without the full Shopify setup.

## Recommended next steps

1. **Commit the website code** — all files are ready, typecheck passes. Commit message: "Add cpg-labs.io marketing website (7 pages, mobile-first)"
2. **Deploy and verify** — push to ECS, verify public routes work at the production URL
3. **Desktop CSS pass** — verify and refine the `@media (min-width: 769px)` breakpoints on the live site
4. **Wire email capture** — add server action for the waitlist "Notify Me" flow
5. **Google compliance** — start the 60-day GBP listing verification clock, verify domain in Search Console

## Context the next session needs

- **`_site.tsx` layout pattern:** Routes named `_site.{page}.tsx` are children of `_site.tsx` (shared nav + footer via Outlet). The index route (`_index/route.tsx`) is NOT a child of `_site` — it imports SiteNav/SiteFooter directly because React Router's file routing doesn't nest the index under pathless layouts.
- **Import paths:** Use `../../components/site-layout` from `_index/route.tsx` (two levels up from routes subdirectory). Use `../components/site-layout` from top-level route files.
- **Preview HTMLs are NOT the source of truth** — they mirror the React component text/styles for Figma capture. The actual code in `app/routes/` is the source of truth. Don't edit preview HTMLs expecting it to change the production site.
- **Figma text editability** requires font loading + character re-write trick (`node.characters = original + " "; node.characters = original;`). Just loading fonts isn't enough — the capture creates read-only nodes.
- **The `inputs/google-service.md` file** contains the original product vision for the Google Places service that motivated this website build. Reference it for the broader growth strategy.
- **Holographic gradient tokens** already existed in the codebase (`app/routes/app.retail-footprint/styles.module.css`) — the website reuses the same `#5ecece, #b09fda, #d4a8d4` palette.
