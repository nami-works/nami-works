# GE Beauty — Theme / Storefront Backlog

Enhancement ideas for the GE Beauty storefront theme (growth, merchandising, UX). Bigger than a quick fix, not yet scheduled. Distinct from `gebeauty/pending-fixes.md` (which is for operational defects). Read `docs/gebeauty-theme-customization.md` before implementing any of these.

Status legend: 🔵 idea · 🟡 scoped · 🟢 in progress · ✅ done

---

## 🔵 Site-wide quiz CTA — "não sabe o que comprar? faça o quiz"
- **What:** A persistent, site-wide call-to-action that routes undecided visitors to the Octane AI quiz. Copy (GE voice, lowercase): *"não sabe o que comprar? faça o quiz"*. Present on all pages, not just the homepage.
- **Why:** Don't lose the traffic. Visitors who land without a clear intent (ads, SEO, direct) currently have no nudge toward a guided path — the quiz converts "just browsing" into a qualified recommendation.
- **Where / how (to scope):** Options — a slim CTA near the floating WhatsApp widget, a dismissible strip, a footer module, or reuse the header `quiz-modal-trigger` (`data-quiz-modal="toggle"`) so it opens the existing quiz modal from anywhere. Quiz = Octane AI (see `gebeauty/quiz/`; trigger class `quiz-modal-trigger` already in the header).
- **Added:** 2026-07-05

## 🔵 Show discounted kits on the progressive-discounts page (and similar)
- **What:** Add a "kits / bundles" section at the **bottom of the *descontos progressivos* page** surfacing the already-discounted bundles (`kits` / `bundle` / `dupla` tagged products). Consider replicating on other discount-seeking pages/collections.
- **Why:** Visitors on that page are explicitly hunting for discounts — so show them the pre-discounted bundles we already sell. Meets intent, lifts AOV, and moves kit inventory.
- **Where / how (to scope):** Find the *descontos progressivos* page/collection handle; append a featured-collection (or kits) section pointing at the kits collection. Evaluate which other promo pages warrant the same (e.g. campaign / sale collections).
- **Added:** 2026-07-05

## 🔵 Reduce desktop menu (header) height
- **What:** Trim the vertical height of the desktop header/navigation — it currently takes up a lot of above-the-fold space.
- **Why:** Reclaim viewport for content; a shorter header pushes the hero/products higher on first paint.
- **Where / how (to scope):** `sections/header-group.json` + the header section/CSS; reduce padding/logo/nav-row height on the desktop breakpoint only (leave mobile as-is).
- **Added:** 2026-07-08

## 🔵 Recreate the boosters landing page
- **What:** Rebuild / redesign the boosters landing page.
- **Why:** (to confirm with Lucas — refresh design / conversion / content.)
- **Where / how (to scope):** existing templates `templates/page.lp-boosters.json` and/or `templates/page.guia-boosters.json` (`/collections/guia-pratico-dos-boosters` is linked in the header). Decide rebuild-in-place vs new template; confirm target URL and scope before starting.
- **Added:** 2026-07-08

---
