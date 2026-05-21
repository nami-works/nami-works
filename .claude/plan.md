# Retail Expansion Backlog — Implementation Plan

## Overview

Five issues to address, plus tab-related CSS. Data consolidation deferred to a separate effort.

---

## Issue #1 — Duplicated input in New/Edit Project modal

**Root cause**: Both the `new-project-modal` (line 1830) and `add-locations-modal` (line 1791) render two inputs side by side:
1. A Polaris `s-text-field` tracking `locationName` state
2. A `<div ref={...AutocompleteContainerRef}>` where Google Places creates its own `<input>` element

The user sees two text fields (as in the screenshot).

**Fix**: In each modal (`new-project-modal`, `add-locations-modal`, and `edit-project-modal`), remove the Polaris `s-text-field` and keep only the Google Places autocomplete container. Add a `<label>` element above the container styled to match Polaris label look (`font-size: 13px; color: #6d7175`). The Google Places widget already creates a fully functional input.

Ensure the `locationName` state is synced from the Google Places selection event (the `place_changed` listener should already do this). If the `s-text-field` was the only source of `locationName` text, wire the Google Places input's value into `locationName` state via an `input` event listener on the container's child input.

**Files**: `app/routes/app.retail-expansion.tsx` (lines ~1791, ~1830, edit-project-modal's add-location section)

---

## Issue #2 — Add Location delay with no feedback

**Root cause**: In the New Project modal, `handleAddLocation()` (line 1459) calls `addLocation()` which does `fetcher.submit("add-location")` — a server roundtrip. The location only appears in the list after the loader re-runs and returns updated data. No visual feedback during the wait.

In contrast, the Edit Project modal directly updates local state (`setEditingSetLocations`) — instant.

**Fix (Plan B — spinner)**: After the "Add locations" button, check `fetcher.state`. When `fetcher.state !== "idle"`, show an inline Polaris spinner or "Adding..." text next to the button. Use the existing `fetcher` object — no new state needed.

Implementation:
- Wrap the "Add locations" button area to conditionally show `<s-spinner size="small" />` when `fetcher.state === "submitting" || fetcher.state === "loading"`
- Apply to both `new-project-modal` and `add-locations-modal`

**Files**: `app/routes/app.retail-expansion.tsx` (lines ~1848, ~1815)

---

## Issue #3 — Tab navigation (Heatmap / Projects)

**Pattern**: Reuse the existing `TabBar` component from `app/components/tab-bar.tsx` and the tab CSS pattern from `app/routes/app.carrier-service/styles.module.css`.

### Step 3a: Add tab state and TabBar

- Import `TabBar` from `app/components/tab-bar.tsx`
- Add `useState<"heatmap" | "projects">("heatmap")` for active tab
- Define tabs array with emoji icons
- Render `<TabBar>` above the main content area (inside `s-page`, before the first section)
- Add i18n keys: `tabs.heatmap`, `tabs.projects` in both locale files

### Step 3b: Tab 1 — Heatmap

**Base slot** (map): No changes — current map block stays as-is.

**Aside slot** — Top Cities:
- Change `.slice(0, 15)` to `.slice(0, 10)` in the three `topCities*Monthly` useMemo hooks (lines 1023, 1030, 1036)
- Update label text from "Top 15" to "Top 10"
- Add a link-style "Force update" button at the bottom of the top cities box that submits `sync-analytics` action then reloads the page
- Show the cache timestamp below: "Last updated: {analytics.updatedAt}"

**Aside slot** — Get Started banner: stays in Heatmap tab (no change).

### Step 3c: Tab 2 — Projects

**Base slot** (map):
- Reuse the SAME map instance but adjust zoom/center when switching to Projects tab
- When a project is selected, compute bounding box of all its locations and call `map.fitBounds(bounds)` with padding
- If no project selected, show the default national view

**Aside slot** — Projects section:
- Move the projects select dropdown + project table into this tab's aside
- Project name in table is clickable -> opens `edit-project-modal` (fixes Issue #4)
- "New project" button stays

**Aside slot** — Location Comparison:
- Move the existing Location Comparison block from the current aside into the Projects tab aside
- Shows per-location metrics for the selected project's locations
- Remove from the Heatmap tab

### Step 3d: CSS

Add tab styles to `styles.module.css` — copy `.tabsRow`, `.tabItem`, `.tabActive`, `.tabContent`, `.tabIcon`, `.tabIconActive` from carrier-service styles.

---

## Issue #4 — Project name click does nothing

**Root cause**: The onClick handler IS correctly coded (finds location set, sets editing state, calls `el?.show?.()` on `edit-project-modal`). However, the projects table only exists inside the `isHeatmapExpanded` fullscreen layout. In the normal non-expanded view, there is NO projects table visible.

**Fix**: With Issue #3's tab restructuring, the projects table will be in the Projects tab's aside. The onClick handler will work identically. If `s-link` without `href` doesn't fire onClick reliably, replace with `<s-button variant="plain">`.

---

## Issue #5 — City totals inaccurate (missing non-geocoded orders + limited aliases)

**Root cause (data loss)**: `fetchAllOrders` (line 2915-2919) drops ALL orders without lat/lng coordinates:
```typescript
if (node.shippingAddress.latitude == null || node.shippingAddress.longitude == null) return;
```
Orders with a valid city name (e.g. "São Paulo") but no geocoded coordinates are never cached. The top cities chart (`cityMonthlyKpis`) groups by canonical city and would correctly aggregate these — but they're not in the data.

Result: ~R$150k actual revenue in São Paulo shows as ~R$31k because most orders lack coordinates.

**Root cause (limited aliases)**: `CITY_ALIASES` only covers 6 entries for SP and RJ. Colloquial names ("Sampa", "BH", "Floripa"), abbreviation patterns ("S. Paulo", "SP - Capital"), and state-suffixed entries ("Curitiba PR") are not canonicalized.

### Fix A: Include non-geocoded orders in fetchAllOrders

Remove the lat/lng guard. Store latitude/longitude as null for orders without coordinates.

Before:
```typescript
if (!node.shippingAddress?.city?.trim()) return;
if (node.shippingAddress.latitude == null || node.shippingAddress.longitude == null) return;
```

After:
```typescript
if (!node.shippingAddress?.city?.trim()) return;
// lat/lng stored as null — geocodedOrders filter handles heatmap/location-comparison
```

This single change makes all city-named orders available to `cityMonthlyKpis` and the top cities chart.

**Downstream impact**: None — `geocodedOrders` (line 701) already filters for non-null coordinates, so heatmap and location comparison continue to work with geocoded data only.

**Cache invalidation**: After deploy, users click the new "Force update" button (Issue #3b) to re-fetch with the expanded data set.

### Fix B: Expand CITY_ALIASES for top ~30 Brazilian metros

Following the geocommerce address_validation pattern (NFKD normalization + static alias map), expand `CITY_ALIASES` to cover:

- Colloquial: "sampa" -> "sao paulo", "bh" -> "belo horizonte", "floripa" -> "florianopolis", "cwb" -> "curitiba", "poa" -> "porto alegre", "ssa" -> "salvador", "bsb" -> "brasilia", "rec" -> "recife"
- Abbreviation: "s. paulo" -> "sao paulo", "s paulo" -> "sao paulo", "r. de janeiro" -> "rio de janeiro"
- State-suffixed: "curitiba pr" -> "curitiba", "belo horizonte mg" -> "belo horizonte", "porto alegre rs" -> "porto alegre", "salvador ba" -> "salvador", "brasilia df" -> "brasilia", "recife pe" -> "recife", "fortaleza ce" -> "fortaleza", "goiania go" -> "goiania", "manaus am" -> "manaus", "campinas sp" -> "campinas", "guarulhos sp" -> "guarulhos", "sao bernardo do campo sp" -> "sao bernardo do campo", "santo andre sp" -> "santo andre", "osasco sp" -> "osasco", "sorocaba sp" -> "sorocaba", "santos sp" -> "santos", "niteroi rj" -> "niteroi", "barueri sp" -> "barueri"
- Capital markers: "sp - capital" -> "sao paulo", "sp capital" -> "sao paulo"
- Misspellings: "brazilia" -> "brasilia"

The existing `normalizeCityKey` already strips accents via NFD, so "São Paulo" / "Sâo Paulo" / "Sao Paulo" all normalize to "sao paulo" automatically.

### Fix C: Update OrderGeo type in storage

Make `latitude` and `longitude` nullable (`number | null`) in the `OrderGeo` type within the AnalyticsCache type definition. This aligns with storing non-geocoded orders.

**Files**: `app/routes/app.retail-expansion.tsx` (fetchAllOrders, CITY_ALIASES), `app/retail-expansion/storage.server.ts` (OrderGeo type if defined there)

---

## Execution Order

1. **Issue #5** — Fix city totals: include non-geocoded orders + expand aliases (data accuracy, should go first)
2. **Issue #1** — Remove duplicate inputs in modals (quick, isolated)
3. **Issue #2** — Add spinner feedback to Add Location buttons (quick, isolated)
4. **Issue #3** — Tab navigation restructure (largest change — reorganizes the page)
5. **Issue #4** — Verified as part of Issue #3
6. **CSS + i18n** — Tab styles + new translation keys
7. **Typecheck** — Verify no regressions

## Files Modified

| File | Changes |
|---|---|
| `app/routes/app.retail-expansion.tsx` | All 4 issues |
| `app/routes/app.retail-expansion/styles.module.css` | Tab CSS classes |
| `app/i18n/locales/en/retail-expansion.json` | tabs.*, top10.* keys |
| `app/i18n/locales/pt-BR/retail-expansion.json` | Same keys in Portuguese |
