# Polaris web-component migration audit

Generated 2026-05-02 during the marketing-admin split work. This document tracks every native HTML interactive element in `app/routes/` and `app/components/` that should be replaced with a Polaris web component (`<s-*>`) per CLAUDE.md "Shopify Web Components" conventions.

The codebase has **zero** imports from `@shopify/polaris` (the deprecated React-Polaris library) — all UI is already on web components. The migration target here is **hand-rolled HTML elements** that should be web components.

## Status legend

- ✅ **Migrated** — swapped + verified
- 🔧 **In progress** — partial migration on a branch
- 📋 **Pending high-confidence** — clear API map, ready to execute
- 🤔 **Pending review** — needs context check before swap (variant choice, custom styling, state coupling)
- ⛔ **Keep native** — no `<s-*>` equivalent or intentional native use

## Scope

In scope: `app/routes/*.tsx` (58 files) + `app/components/*` (3 files).
Out of scope: server modules (`*.server.ts`), tests, scripts, extensions, infra, the `site/` Astro project, marketing routes deleted in Phase 3 of the marketing-admin split (`_index/`, `_site.*.tsx`, `screencast.tsx`, `preview.tsx`, `app/components/site-layout/`, `app/components/cpglabs-layout/`).

---

## High-confidence swaps (📋 ready)

### Checkboxes (CLAUDE.md explicit mandate)
| File | Line | Element | Replacement |
|---|---|---|---|
| `app/routes/app.affiliates/attribution-queue.tsx` | 663 | `<input type="checkbox">` for processed-orders | `<s-checkbox>` |
| `app/routes/app.carrier-service.tsx` | 1082 | modal setting: dilate | `<s-checkbox>` |
| `app/routes/app.carrier-service.tsx` | 1116 | modal setting: optional location | `<s-checkbox>` |
| `app/routes/app.carrier-service.tsx` | 1313 | modal setting: exclude postal | `<s-checkbox>` |
| `app/routes/app.local-delivery.tsx` | 4683 | location form checkbox | `<s-checkbox>` |
| `app/routes/app.local-delivery.tsx` | 4698 | location form checkbox | `<s-checkbox>` |

API map: `<input type="checkbox" checked={x} onChange={(e) => set(e.target.checked)} />` → `<s-checkbox checked={x || undefined} onChange={() => set(prev => !prev)} />`. Note `<s-checkbox>` does NOT accept children — labels render outside as siblings (see CLAUDE.md "Shopify Web Components > `<s-checkbox>` does not accept children").

### Radio groups → choice-list
| File | Lines | Element | Replacement |
|---|---|---|---|
| `app/routes/app.carrier-service.tsx` | 985–1023 | `<input type="radio">` distance method (postal vs radius) | `<s-choice-list>` + `<s-choice>` |
| `app/routes/app.carrier-service.tsx` | 985–1023 | `<input type="radio">` unit (km vs mi) | `<s-choice-list>` + `<s-choice>` |
| `app/routes/app.local-delivery.tsx` | 4664 | radio group | `<s-choice-list>` |

API map: `<s-choice-list onChange={(event) => { const value = (event.currentTarget as { values?: string[] } | null)?.values?.[0]; ... }}>` per CLAUDE.md.

### Selects
| File | Line | Element | Replacement |
|---|---|---|---|
| `app/routes/app.affiliates/attribution-queue.tsx` | 353 | lookback days `<select>` | `<s-select>` + `<s-option>` |
| `app/routes/app.footprint-expansion.tsx` | 3069 | period `<select>` | `<s-select>` + `<s-option>` |

API map: `<select onChange={(e) => set(e.target.value)}>` → `<s-select onChange={(e) => set((e.currentTarget as HTMLSelectElement).value)}>` per CLAUDE.md.

### Text inputs
| File | Line | Element | Replacement |
|---|---|---|---|
| `app/routes/app.affiliates/attribution-queue.tsx` | 341 | search `<input type="text">` | `<s-text-field>` |
| `app/routes/app.affiliates.tsx` | 1699 | date-range text `<input>` | `<s-text-field>` |
| `app/routes/app.local-delivery.tsx` | 4614 | location form text `<input>` | `<s-text-field>` |
| `app/routes/app.retail-sales.tsx` | 3385, 3403, 3532 | price/discount text `<input>` (3×) | `<s-text-field>` |
| `app/routes/app.footprint-expansion.tsx` | 2158, 2604 | numeric `<input type="number">` (2×) | `<s-text-field type="number">` |

### Textareas
| File | Line | Element | Replacement |
|---|---|---|---|
| `app/routes/app.footprint-expansion.tsx` | 2133 | `<textarea>` for notes | `<s-text-field multiline>` (verify rows prop maps cleanly) |
| `app/routes/app.storytelling.alt-text.tsx` | 311 | `<textarea>` for alt-text edit | `<s-text-field multiline>` |

---

## Medium-confidence (🤔 review before swap)

### Buttons (variant inference required)
| File | Line | Element | Reason for review |
|---|---|---|---|
| `app/routes/app.affiliates/attribution-queue.tsx` | 121 | copy-to-clipboard button | Icon + state-dependent styling (copied/uncopyable). Confirm `<s-button>` supports state-based class or use icon variant. |
| `app/routes/app.affiliates.tsx` | 1717, 1822, 1829, 1839, 1987, 2676 | 6× `<button>` | Need per-button context to choose variant (primary/secondary/critical) |
| `app/routes/app.carrier-service.tsx` | 1240, 1370, 1496 | 3× modal `<button>` (close, confirm, submit) | Confirm modal-button conventions vs. `<s-button>` placement |
| `app/routes/app.footprint-expansion.tsx` | 2338, 2592, 2621, 3481 | 4× `<button>` | Inspect styling + context for variant |
| `app/routes/app.local-delivery-mobile.tsx` | ~47 buttons across 1128–2290 | collapsible headers, chip buttons, action buttons | High-volume; mobile-optimized custom styling. Group by pattern: <br>• Collapsible headers — keep native (no `<s-collapsible>` exists; chevron pattern is intentional) <br>• Chip buttons (1149, 1152) — `<s-button variant="secondary">` <br>• Card-tap buttons (2326) — keep native (large hit area, custom CSS) |
| `app/routes/app.merchandising.sale._index.tsx` | 302 | filter button | Single button; inspect for variant |
| `app/routes/app.settings.tsx` | 782 | button | Native tab-bar button per CLAUDE.md tabs convention; might be intentional KEEP |
| `app/routes/app.storytelling.alt-text.tsx` | 240 | filter chip with active state | State-class toggle; confirm `<s-button>` supports active variant or refactor |

### Custom components
| File | Mimics | Action |
|---|---|---|
| `app/components/multi-select-input.tsx` | hybrid `<s-select>` + chips + autocomplete | Substantial keyboard logic coupled to DOM ref. Polaris has no direct multi-select primitive. Recommend **keep custom but upgrade nested `<button>` (line 97) to `<s-button>` and `<input>` (line 111) only if `<s-text-field>` exposes ref/onKeyDown** with full event handler support. |
| `app/components/tab-bar.tsx` | tab navigation | Already uses `<s-link>` where appropriate; no native HTML to migrate. ✅ |
| `app/components/tab-icons.tsx` | SVG icons | Pure SVG; no migration needed. ✅ |

---

## Keep native (⛔)

| File | Line | Element | Reason |
|---|---|---|---|
| `app/routes/app.brand-settings.tsx` | 198, 305, 315, 349, 350 | 5× `<input type="hidden">` | Form internals; not UI |
| `app/routes/app.storytelling.alt-text.tsx` | 216, 226, 337–369 | 10× `<input type="hidden">` | Form internals |
| `app/routes/app.storytelling_.review.tsx` | various | `<input type="hidden">` | Form internals |
| `app/routes/app.storytelling_.learnings.tsx` | various | `<input type="hidden">` | Form internals |
| `app/routes/app.local-delivery-mobile.tsx` | 1535 | `<input type="date">` | `<s-date-field>` exists — migrate when verifying mobile UX. Currently tagged ⛔ until confirmed mobile-friendly. |
| `app/routes/app.local-delivery.tsx` | 1618 | inline `<button>` in HTML string | Embedded in generated email/document, not JSX |

---

## Execution plan

The migration is best done in **per-file commits** so any regression is bisectable:

1. `chore(polaris): migrate carrier-service checkboxes + radios to s-checkbox + s-choice-list` — 5 swaps in one file, contained
2. `chore(polaris): migrate attribution-queue search, lookback, processed-checkbox` — 3 swaps in one file
3. `chore(polaris): migrate retail-sales price inputs to s-text-field` — 3 swaps in one file
4. `chore(polaris): migrate footprint-expansion select + numeric inputs + notes textarea` — 4 swaps
5. `chore(polaris): migrate local-delivery location form fields` — 3 swaps
6. `chore(polaris): migrate storytelling alt-text textarea` — 1 swap
7. `chore(polaris): migrate affiliates date-range input` — 1 swap

Total: ~7 commits, ~20 swaps in the high-confidence bucket. Each commit small enough to typecheck + visually verify before moving on.

The medium-confidence bucket should be a **second branch** after the high-confidence migration ships, since each swap there involves judgment.

## Open questions for the user

1. **`<s-text-field type="number">`** — does the Polaris web component spec expose a `type` prop for numeric inputs, or should numeric fields stay native `<input type="number">`? The CLAUDE.md examples don't show it. Verify before mass-migrating.
2. **`<s-text-field multiline>`** — does the rows config map cleanly from `<textarea rows={N}>`? Verify by migrating the alt-text textarea first as a probe.
3. **Mobile `<input type="date">`** — `<s-date-field>` exists in Polaris but mobile UX may differ from native browser pickers. Worth A/B confirming on the local-delivery-mobile route before swapping.
