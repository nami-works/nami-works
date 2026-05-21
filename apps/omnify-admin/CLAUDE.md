# Omnify Shopify Admin — Per-App Rules

The embedded Shopify app behind `app.cpg-labs.io` (CPG Labs full) + `omnify.cpg-labs.io` (Omnify focused) + `flywheel.cpg-labs.io` (Flywheel — Affiliates + Loyalty). One codebase, route-gated by the `APP_IDENTITY` env var (`cpg-labs` / `omnify` / `flywheel` / `storytelling` / `storefront`). The shopify.app.*.toml files at the app root each ship to one of those identities.

For cross-cutting monorepo rules (parallel sessions, deploy queue, brand model, shell compatibility), see the root [/CLAUDE.md](../../CLAUDE.md).

## Stack

React Router 7 + Shopify App React Router + Polaris **web components** (`<s-page>`, `<s-section>`, etc., NOT the legacy `@shopify/polaris` React components) + Prisma (default `@prisma/client` from `prisma/omnify/schema.prisma`) + Vite + AWS Lightsail. TypeScript strict.

Local dev: `npm run dev` from the workspace dir runs `shopify app dev` with the tunnel. `npm run build` runs React Router build. `npm run typecheck` runs `react-router typegen && tsc --noEmit && npm run check:basepath && check:site-deps && check:order-update-tags`.

## Core features & routes

- **Local Delivery** — `/app/local-delivery` — Route planning, map, order tags
- **Retail sales** — `/app/retail-sales` — Monthly sales targets, KPI dashboard
- **Footprint expansion** — `/app/footprint-expansion` — Location ranking
- **Sales (merchandising)** — `/app/merchandising/sales` — Bulk price campaigns + price tags
- **Story-telling** — `/app/storytelling` — AI blog content generation
- **Affiliates** — `/app/affiliates` — Discount-code attribution + commission tracking
- **Settings** — `/app/settings` — Per-location delivery, retail sales filters, carrier providers

## Deployment

Live state (2026-05-11 cutover): production runs on Amazon Lightsail, not ECS Fargate.

- **Host:** Lightsail instance `cpg-labs-prod` at `54.221.23.142` (Ubuntu 22.04 + Docker + Caddy). Containers `omnify-app:full-…` on :3000, `omnify-app:omnify-…` on :3001, Flywheel TBD. Caddy fronts with Let's Encrypt.
- **DB:** Lightsail managed Postgres `cpg-labs-db`.
- **Secrets:** env files at `/etc/cpg-labs/{full,omnify,cron}.env` (root-owned, 600). SSM `/omnify/` is legacy/preserved.
- **DNS:** GoDaddy A records → `54.221.23.142`, TTL 600.
- **Crons:** Linux `crontab` on the box. 4 active lines: `lalamove-watchdog` (*/5), `retail-goals-sync` (0 * * * *), `shop-ingest-reconcile` (15 * * * *), `weekly-tone-and-diff` (0 3 * * MON UTC).
- **Deploy:** `scripts/deploy-omnify-admin.ps1 -App {full|omnify|flywheel|both}` from the repo root. Builds image, pushes to ECR, SSHs into Lightsail, updates compose, polls `/health`. Options: `-Tag <date-sha>`, `-SkipBuild`, `-SkipHealthCheck`.
- **Shopify scopes:** `shopify app deploy --config shopify.app.<identity>.toml` per app — six configs at the workspace root (`cpg-labs`, `omnify`, `storytelling`, `storefront`, `flywheel`, `web`).

---

## Polaris Components Reference

**This is the canonical registry of UI primitives in this app. Before adding any new interactive element — button, modal, banner, badge, input, link, icon — find the Polaris equivalent here first. NEVER write custom CSS to mimic a Polaris primitive. NEVER use emoji as icons. NEVER use raw HTML `<button>` / `<a>` / `<input>` in route files.**

If you find yourself styling a `<span>` to look like a badge, or building a `<div>` that behaves like a modal, or pasting an emoji as a status indicator — STOP. Go back to this table. The right primitive almost certainly exists.

Catalog: https://shopify.dev/docs/api/app-home/web-components

### Layout primitives

| Component | When to use | Notes |
|---|---|---|
| `<s-page>` | Single top-level container per route. One per route, no exceptions. | Use `inlineSize="base"` on Settings/config pages. Omit on data-heavy pages (Local Delivery, Footprint) so the map/table gets full viewport. Slots: `primary-action`, `secondary-actions`, `back-action`. |
| `<s-section>` | Card-style content container. | All content lives inside `<s-section>` or `<s-box>`. Never render text on the bare admin background. `heading="..."` attribute for section title. |
| `<s-box>` | Padding/border/spacing wrapper inside a section, or standalone box. | Use `padding="tight" / "base" / "loose"` (see Block Padding Tokens). Use `borderWidth="base" borderRadius="base"` for inset cards. |
| `<s-stack>` | Flex layout container. | `direction="block" / "inline"`, `gap="tight" / "base" / "loose"`. Replaces hand-rolled `display: flex` blocks. |
| `<s-app-nav>` | Top-level app navigation. **Required** — Built for Shopify hard requirement. | Max 7 top-level items. Never use the legacy `NavMenu` from `@shopify/app-bridge-react`. |

### Actions

| Component | When to use | Notes |
|---|---|---|
| `<s-button>` | Every clickable action. **Never use raw `<button>` in route files.** | Variants: `primary` / `secondary` (default) / `tertiary` (text-only). Tones: `critical` (destructive) / `auto`. Use `loading disabled` together for in-progress state — swap via key-based conditional rendering. **One `variant="primary"` per card.** Never primary inside table rows. |
| `<s-link>` | Text links. **Never use raw `<a href>` in route files.** | For external/static links use `href`. For SPA navigation use React Router's `<Link to>` (NOT `<s-link>` to internal routes — plain anchors trigger full page loads which 404 inside the embedded iframe). |
| `<s-menu>` | Dropdown action menus. | Pair with a trigger button. |
| `<s-popover>` | Floating UI panel anchored to a trigger. | Used in filter UIs, inline pickers. |

### Forms

| Component | When to use | Notes |
|---|---|---|
| `<s-text-field>` | Single-line text input. | `label` prop is required (a11y). For external label patterns use `labelAccessibilityVisibility="exclusive"`. |
| `<s-text-area>` | Multi-line text input. | Same label rules as text-field. |
| `<s-select>` | Dropdown select. | Children must be `<s-option value="...">label</s-option>` — NEVER raw HTML `<option>`. onChange: `(e.currentTarget as HTMLSelectElement).value`. |
| `<s-option>` | Option inside `<s-select>`. | Web-component option, not HTML. |
| `<s-checkbox>` | Boolean toggle. **Never use raw `<input type="checkbox">`.** | Does NOT accept children — put label text as a sibling. Wrap with a `<div onClick role="button" user-select: none>` for click-to-toggle (HTML `<label>` doesn't auto-toggle web components). See "Checkbox + label pattern" in Layout Patterns. |
| `<s-choice-list>` | Radio button group. | Children: `<s-choice value="...">Label</s-choice>`. onChange: cast `(event.currentTarget as { values?: string[] } | null)?.values?.[0]`. |
| `<s-choice>` | Option inside `<s-choice-list>`. | |
| `<s-date-field>` | Date input (typing). | |
| `<s-date-picker>` | Date input (calendar UI). | |
| `<s-save-bar>` | Contextual save bar at page bottom for unsaved-changes flow. | **Required** on any page with editable persisted state (Settings, Brand, Goals). Inline submit buttons alone are non-compliant for form-heavy routes. |

### Feedback / status

| Component | When to use | Notes |
|---|---|---|
| `<s-banner>` | Page-level alert above content. | Tones: `info` / `success` / `warning` / `critical`. **Critical** for whole-form failures (network, auth). Field-level errors render in red next to the field, NOT in a banner. **Max one banner stacked per viewport area** — multiple banners = BFS rejection signal. |
| `<s-badge>` | Status pill. **Never style a `<span>` to mimic a badge.** | Always pair with a label — never rely on color alone (colorblind merchants). |
| `<s-spinner>` | Loading indicator. | Only when there's no inline alternative. Prefer `<s-button loading>` for action-level feedback. |
| `<s-modal>` | Overlay dialog. | Declare near the triggering code for readability. **Never combine `commandFor="modal-id" command="--hide"` with `onClick` on the same button** — races. Close programmatically: `document.getElementById("modal-id")?.removeAttribute("open")`. |

### Content

| Component | When to use | Notes |
|---|---|---|
| `<s-heading>` | Headings inside sections. | |
| `<s-text>` | Inline text rendering. | Use the right semantic over hardcoded `<span>`. |
| `<s-paragraph>` | Block paragraph text. | |
| `<s-list-item>` / `<s-unordered-list>` | Lists. | |
| `<s-icon>` | Icons. **Never use emoji as icons.** | `type="search" / "bolt" / "receipt-dollar" / "truck"` etc. — 600+ named icons. Pass `tone` (`info` / `success` / `warning` / `critical` / `auto` / `neutral` / `caution`) and `size` (`small` / `base`). NEVER hand-roll SVG paths or import from `@shopify/polaris-icons`. Existing inline SVGs and `app/components/tab-icons.tsx` predate this rule — migrate opportunistically when touching. |

### Block padding tokens (the 4px grid in practice)

| Token | Polaris prop | Pixel value | Use case |
|---|---|---|---|
| Tight | `padding="tight"` | 12px | Aside cards, table cells, compact filter rows |
| Base | `padding="base"` | 16px | Default — main content blocks, KPI cards, forms |
| Loose | `padding="loose"` | 20px | Wide hero blocks, modal bodies, full-width feature blocks |

**Prefer the Polaris prop, not custom CSS.** `<s-box padding="base">` is correct; `.myBlock { padding: 16px }` is a regression. No hardcoded `padding: 12px / 16px / 20px` in `app/routes/**/*.module.css`. Audit by `git grep -nE 'padding: ?[0-9]+px|padding-(top|bottom|left|right): ?[0-9]+px' -- 'app/routes/**/*.module.css'`.

### Common violation greps — run before opening a PR

```bash
# Raw <button> in route files (use <s-button>)
git grep -nE '<button(\s|>)' -- 'app/routes/**/*.tsx'

# Raw <a href=...> in route files (use <Link to> or <s-link href>)
git grep -nE '<a [^>]*href=' -- 'app/routes/**/*.tsx'

# Emoji literal in JSX likely-icon contexts
git grep -nE '🟡|🚫|🚨|⏰|⏳|🕒|🏬|🥕|🏆|🟢|⚠|✓|✗' -- 'app/**/*.tsx'

# Hardcoded hex color outside CSS modules
git grep -nE 'color: ?#[0-9a-fA-F]{3,6}|background: ?#[0-9a-fA-F]{3,6}' -- 'app/**/*.tsx'
```

Justified exceptions (emoji inside user-facing copy, not as an icon) get a one-line ESLint suppress with reason: `{/* eslint-disable-next-line no-restricted-syntax */}`.

---

## Hard Rules

- Keep the app embedded and aligned with Shopify Admin UX.
- **One top-level `<s-page>` per route.** No extra wrappers.
- Use **CSS modules** at route level: `app/routes/<route-name>/styles.module.css`, camelCase class names.
- All layout in CSS modules; inline styles only for runtime-computed values.
- **Native form elements inherit fonts globally.** `app/root.tsx` applies `font-family: inherit; font-weight: inherit` to `select, input, textarea, button`. Do not add per-element font overrides.
- Keep selection state in React, de-duped by IDs.
- Disable actions when prerequisites are missing.
- **Never hardcode secrets;** use environment variables.
- **Never hardcode store-specific values** (metaobject types, field names, metafield keys, colors). All configuration comes from UI → database.
- All Shopify mutations go through React Router **`action` handlers.**
- Use `redirect` from `authenticate.admin` for auth-protected flows.
- **No idle UI elements.** Every button, modal, input, or control must have a real effect on the process. Never add decorative or placeholder UI that doesn't do anything.
- **New UI elements require clarification.** Before adding any new button, modal, form field, or interactive element, ask the user: (a) how is it triggered, (b) what does it affect, (c) how should it behave (loading, errors, success).
- **Reuse before creating.** If the requested behavior or logic resembles something already in the system, find the existing implementation and propose reusing it for consistency.

## Shopify Design Compliance

This app is judged against Shopify's official **App design** guidelines and **Built for Shopify** design requirements. When local convention and Shopify guideline conflict, the Shopify guideline wins. Re-read canonical sources when in doubt:

- App design: https://shopify.dev/docs/apps/design
- Layout: https://shopify.dev/docs/apps/design/layout
- Visual design: https://shopify.dev/docs/apps/design/visual-design
- Content: https://shopify.dev/docs/apps/design/content
- Navigation: https://shopify.dev/docs/apps/design/navigation
- Built for Shopify: https://shopify.dev/docs/apps/launch/built-for-shopify/requirements#design
- Polaris web components: https://shopify.dev/docs/api/app-home/web-components

### Information architecture & navigation
- Use `<s-app-nav>` (Required). Max 7 top-level items.
- Nav labels: noun-based, short, scannable. App name ≤ 20 characters.
- Sub-pages must highlight their parent nav item.
- No app-nav duplication in page body.
- Back button on every sub-page (Polaris `back-action` slot or breadcrumbs).
- Tabs are secondary navigation only — never wrap, never reposition during navigation, never modify the header above them.

### Page structure
- One purpose per page. Title is action-focused.
- `<s-page>` is the single top-level container.
- Page header carries page-specific actions only.
- Content lives inside containers.
- Cards have at most one primary action.

### Forms & save semantics
- Use the Contextual Save Bar (`<s-save-bar>`) on any page with editable persisted state.
- Error messages render in red, contextually next to the field. Page-top `<s-banner tone="critical">` is for whole-form failures.
- Max one banner stacked per viewport area.
- Input labels must be precise ("Customer name" not "Name").

### Visual design
- Polaris primitives first, hand-rolled UI never.
- **Color semantics are reserved.** Green = success. Yellow = paused. Orange = in-progress. **Red = blocked/error only — never anything else.** Blue = informational, primary action — Shopify's blue `#005bd3` family.
- Never rely on color alone. Pair every status color with iconography or text.
- Contrast ≥ 4.5:1 for body text.
- Typography: sans-serif only. Body text and interactive elements ≥ 13px; captions/subheadings ≥ 12px. Headings differ by weight/size, never by underline or color alone.
- 4px spacing grid. Multiples of 4 only.
- Density stays uniform per page.
- Brand-specific colors stay out of admin chrome.

### Tables in admin context
- **Table row actions use secondary styling only.** Never `variant="primary"` inside a table row.

### Mobile & embedded behavior
- No horizontal page scroll on mobile (`max-width: 768px` breakpoint).
- Stack aside above main on mobile (`order: -1`).
- Don't auto-launch modals, popovers, animations, or fullscreen on page load.

### Content & copy
- Plain language, US grade-7 reading level. Short sentences, scannable bullets.
- Action labels: verb + noun ("Create order", "Save changes", "Delete route") — never "OK", "Submit", "Go".
- Same word for the same concept everywhere.
- First reference uses the proper name; subsequent in the same section use "we".
- No idioms, sarcasm, irony, or culture-specific phrasing.
- **No em dashes in customer-facing copy.**
- All user-facing strings come from `app/i18n/locales/`. Hardcoded English in JSX is a regression.

### Deceptive-pattern bans (BFS)
- No auto-launching anything on load. No false guarantees. No animations that obstruct content. No promotional/upsell content that isn't dismissible.

---

## Layout patterns

### General layout

- Aside/config blocks on the **right** on desktop; aside renders **first** (above main content) on mobile via `order: -1`.
- Two-column flex layout with `gap: 20px`, stacks vertically on mobile.
- Data-heavy pages: full-width `<s-page>`, no `inlineSize`.
- Settings/config pages: use `inlineSize="base"` on `<s-page>`.
- Header: primary actions in `primary-action` slot; back/cancel on left.
- Form layout: responsive grid `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;`.

### Tabs

Flat/underline style. No emojis. No `<s-link>` for tabs (its shadow DOM forces blue text). Route-level CSS classes (not shared). The `TabBar` component is deprecated.

When adding tabs to a page, ask the user: "Will these tabs become standalone pages in a future app split, or always live here?"
- `<Link to>` — tabs that navigate between Outlet child routes. Placed **outside** `<s-section>`, directly under `<s-page>`, above `<Outlet />`. Never use plain `<a href>` (404s in iframe).
- `<button onClick>` — tabs that switch in-place. Placed **inside** `<s-section>`, above content. Add `border: none; border-radius: 0;` to reset.

CSS spec:
```css
.tabsRow { display: flex; align-items: center; gap: 7px; border-bottom: 1px solid #e1e3e5; }
.tab { padding: 8px 16px; border-bottom: 2px solid transparent; color: #6d7175;
       font-weight: 400; font-size: 13px; text-decoration: none; background: none;
       cursor: pointer; margin-bottom: -1px; }
.tab:hover { color: #303030; border-bottom-color: #8c9196; }
.tabActive { color: #303030; font-weight: 500; border-bottom-color: #303030; }
```

### Collapsible Sections

Bottom-right chevron toggle — a real clickable `<div>`, not a CSS `::after`. Only the chevron area toggles; heading is not clickable. Chevron lives **inside** `<s-section>`. See Local Delivery Fulfillment Details and Retail Footprint Cities Ranking for reference.

### Aside Card Blocks

Cards inside aside panels (Route Manager, Expansion Projects):
```
┌─────────────────────────────────┐
│  [Badge]          [Destructive] │  ← cardHeader
│  stat line 1                    │  ← cardInfo (gap: 4px)
│  stat line 2                    │
│          [Secondary] [Primary]  │  ← cardActions (flex-end, gap: 12px)
└─────────────────────────────────┘
```
- Wrapper: `<s-box padding="base" borderWidth="base" borderRadius="base">`
- Card gap: `16px` between cards in a list.
- **Destructive action lives top-right** in the header — exception to the "Delete bottom-left" rule for compact cards.

### Form Inputs — external label pattern

Wrap each control in `.filterControl`, place the label as a sibling `<span>` above. Use `labelAccessibilityVisibility="exclusive"` on the Polaris control.

```tsx
<div className={styles.filterControl}>
  <span className={styles.filterLabel}>{t("filters.period")}</span>
  <s-select label={t("filters.period")} labelAccessibilityVisibility="exclusive" value={value} onChange={onChange}>
    {/* options */}
  </s-select>
</div>
```
```css
.filterControl { display: flex; flex-direction: column; gap: 4px; }
.filterLabel { font-size: 12px; font-weight: 600; color: #6d7175; }
```

Mobile: filter controls stack one per row, full viewport width. **Pack additional actions into the same row when space allows** — don't spawn a near-empty row.

Reference: `app/routes/app.retail-sales.tsx` and `app/routes/app.local-delivery.tsx`.

### Buttons

- **All button rows right-aligned** (`justify-content: flex-end`). No exceptions.
- `<s-button>` removing `disabled` dynamically may not re-enable it — use key-based conditional rendering.
- **Processing state:** `<s-button loading disabled>`. Optionally change label ("Applying…"). Do not use external spinners below buttons.
- **Delete buttons:** always confirm via a separate modal.
  - Delete is the expected action: `<s-button variant="primary" tone="critical">` right-aligned, order Cancel → Delete (rightmost).
  - Delete is NOT the expected action (edit modals, settings): place Delete **bottom-left** with `variant="secondary" tone="critical"`, isolated from primary cluster: `[Delete] ... [Cancel] [Save]`.
  - Aside Card Blocks: destructive sits top-right (compact card exception).
- **Button order (LTR):** Cancel/Dismiss (secondary, leftmost) → Save/Confirm/Load (primary, rightmost).

### Tables

- No zebra striping. White rows with subtle borders.
- Header rows: `background: #f6f6f7; font-weight: 600; color: #6d7175; text-align: center;`.
- Data row borders: `1px solid #f1f1f1`.
- Row hover: `background: #f6f6f7`.
- Column group separators: `border-left: 2px solid #e1e3e5` on first sub-column.
- Wrap in container with `overflow-x: auto` for mobile.
- Sort arrow glued to last word with ` `, never wraps.
- Currency: compact format `R$6.5k`, `R$1.2M`, `R$950`. Always prefix symbol. See `formatCurrencyCompact` in `app/routes/app.affiliates.tsx`.

### Search & Modals

- Inline search field beside an action that opens a modal: field captures text only, no inline dropdown.
- Inline search beside same-block results: dropdown expander expected.
- Modal search input: bordered container with SVG search icon.
- Clicking "Add" closes modal and clears search.
- Radio-button options in modals: `<s-choice-list>` with `<s-choice>` children, not `<input type="radio">`.
- Draft/applied pattern for modal settings: keep `draft` and `applied` state. On open, copy applied → draft. On cancel, reset draft → applied. On confirm, copy draft → applied + persist.

### Control panels & state-driven visibility

Compact control panels (selection bars, batch toolbars): **hide, don't disable**, when an action is non-actionable in the current context. Disabled is for "this is the panel's purpose, just not usable yet" (Save with validation errors). Every interactive panel needs a state matrix at design time — enumerate states (no selection / partial / staged / mixed-dirty / error / loading), list which controls are visible/hidden/enabled/disabled per state. The state matrix lives in the mockup file, not in code comments.

### Inserted elements spacing

- Never render an inserted element flush against the next one.
- Between stacked elements inside a section: `margin-bottom: 12px` (or parent `gap: 12px`).
- Between cards: `gap: 16px`.
- Between page-level sections: `gap: 20px`.
- Page-top banners above first card: `margin-bottom: 16px`.
- Sync-progress / loading strips above content: `margin-bottom: 12px`.

---

## Design Validation (mockup-first)

For any non-trivial UI refactor — charts, dashboards, new patterns, anything where visual language matters — **always build an HTML mockup before touching production React code.**

- Start from `inputs/mockups/_template.html`; copy to `inputs/mockups/<feature>-v1.html`.
- Iterate in the mockup until visual language is settled.
- Open questions go in the CLI via `AskUserQuestion`, not in the mockup HTML.
- In-session iterations edit the same file in place. No `-v2`, `-v3-final` per round.
- Iterate to a final clean version — no Before/After columns or "REMOVED" callouts in the final.
- Commit the final mockup alongside the production change.
- Register in `inputs/mockups/INDEX.md` in the same commit. Read INDEX.md before starting any UI work.
- Invoke `/design-engineer` skill to bootstrap the mockup-first + state-matrix workflow.

---

## Drilldown Charts (Shopify-native)

All KPI drilldown charts follow a single frame so the dashboard reads as one instrument panel. Reference: `KpiDrilldownBars` in `app/routes/app.retail-sales.tsx`.

- Frame: `grid-template-columns: 44px 1fr` — y-axis 5 ticks left, plot area right.
- Scale: `niceCeil(maxValue)` — rounds to 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 × 10ⁿ. Pad ~15% when labels render outside the bar.
- **Bars — flat fills only.** No gradients, no shadows. Shopify blue `#005bd3` (current), pastel `#b3d1ff` (projection), light gray `#d9e3ef` (PY).
- **No labels above bars.** Values in tooltip on hover/focus.
- Goal marker: dotted horizontal line, 2px dotted `#b8350f`, with compact value label to the right.
- Same-store YoY: dynamic baseline (all-positive / all-negative / mixed). Green up, red down.
- Achievement ranking: horizontal sorted list, NOT bars. Tiers: green `#067647` (≥80%), yellow `#d99a0a` (60-79%), red `#d72c0d` (<60%).
- Subtitle carries date context.
- Tooltip: dark bg `#1f1f1f`, white 11px text, rounded 6px. Row order: MTD → Projected → Goal → vs. Goal → Prior year → YoY (absolute numbers first, variances after). Absolute values in `R$16,000` form (not compact). On-dark variance colors: green `#7ee0a1`, red `#ff9b85`.

### UI Tokens

| Token | Value | Use |
|---|---|---|
| Subdued text | `#6d7175` | Secondary labels, helper text |
| Border | `#e1e3e5` | Cards, rows, dividers |
| Light border | `#f1f1f1` | Table data row separators |
| Subtle border | `#eceeef` | Grid-based table row separators |
| Shopify green | `#008060` | Active states, primary indicators |
| Critical red | `#d72c0d` | Delete buttons, error states |
| Light gray bg | `#f6f6f7` | Map canvas, empty states, table headers, hover |
| Header text | `#3a3a3a` | Stronger header labels (bordered tables) |

---

## Navigation — Subpath (BASE_PATH)

When deployed under a subpath (e.g. `BASE_PATH=/full`), **every URL-handling layer already prepends the basename**. Never add `basePath` manually to nav links — double-prefix produces 404s.

- React Router `<Link>` / `<form>` / `useSubmit`: plain absolute paths. `to="/app/foo"`.
- Shopify App Bridge `<s-link>`: plain absolute paths. `href="/app/foo"`.
- Static assets (`<img>`, `<link rel>`): DO prepend `basePath` — these are direct HTTP fetches.

Enforced by `scripts/check-no-basepath-in-nav-links.ts` (wired into typecheck). Standalone: `npm run check:basepath`.

`BASE_PATH` is baked at Docker build time, not runtime. Changing the env var on the task definition alone will NOT update the basename — image must be rebuilt with `--build-arg BASE_PATH=...`. Use `--no-cache` if basename is wrong after deploy.

---

## Shopify API gotchas

- `discountNodesCount` caps at 10,000. Paginate + count manually for exact above-cap counts.
- Pagination without `sortKey` is unstable. Use `sortKey: ID` or `sortKey: CREATED_AT`.
- Bulk discount updates must be idempotent. Check current state per code; loop-until-zero-remaining.
- Theme settings split across files: announcement bar → `sections/header-group.json`; PDP banners → `config/settings_data.json`; promo logic → `snippets/*.liquid`.
- Classifying locations store vs warehouse: use `localPickupSettingsV2`. Non-null = physical store, null = warehouse.
- **Order tags persist until explicitly removed.** Tags (`ld_address-confirm`, `ld_failed-delivery`, `ld_rota-*`) are the source of truth for the local-delivery state machine. **Never use `orderUpdate(input: { tags: [...] })`** — that replaces the entire tag list. Always use `tagsAdd` / `tagsRemove` (helpers `addTags` / `removeTags` in `app/services/lalamove-sync.server.ts`). Enforced by `scripts/check-no-order-update-tags.ts`. Suppress with `// allow-order-update-tags: <reason>` only if documented + audited.

## MCP usage

- Use `learn_shopify_api` before implementing unfamiliar Shopify flows.
- Use `introspect_graphql_schema` before changing GraphQL queries/mutations.
- Prefer schema-driven changes over guessing types/fields.

## Product & Data

- Request only required access scopes; update `shopify.app.*.toml` when needed.
- Field masks / `first:` limits on GraphQL to reduce payload.
- **Never store large record sets as a single JSON column.** Tens of thousands of records (orders, customers) in one Prisma `Json` column → OOM on write, slow reads. Use normalized tables with indexes. Reference: `RetailOrder`, `RetailCustomer`, `RetailCityMonthly`, `RetailHeatmapBucket`.
- Background syncs must survive container restarts. Persist progress per page, not just at end.
- Batch DB writes with raw SQL for bulk ingestion. `$transaction` with N upserts ~100x slower than `INSERT ... ON CONFLICT DO UPDATE`.
- Optimistic creates: generate IDs client-side, pass to server action, server uses client ID.

## Maps & Geodata

- Maps JavaScript API with `importLibrary` and `mapId`.
- Don't mix cloud-based map styling with JSON styles on the same map.
- City-level geocoding fallback: when records lack precise lat/lng but have `city`, geocode via Google Geocoder, use centroid. Cache in `cityGeocodes`, persist via server action.
- Customer counting in radius: merge unique IDs from geocoded customers within radius AND customer IDs from orders within radius. Use `Set<string>` to dedupe.

## Carrier Services

See `docs/cpg-labs/carrier-services.md` for full docs.

**Lalamove** (last updated 2026-03-24): API v3, REST, HMAC-SHA256 auth. Sandbox `https://rest.sandbox.lalamove.com/v3`, prod `https://rest.lalamove.com/v3`. Flow: `POST /v3/quotations` → `quotationId` + `stopIds` → `POST /v3/orders`. 11 markets including BR_SAO. SDK `@lalamove/lalamove-js` v1.1.0. Env: `LALAMOVE_API_KEY`, `LALAMOVE_API_SECRET`.

## Logging

Every server-side module (loaders/actions, services, webhooks) must include structured console logs. Logs post-Lightsail cutover live at `/var/log/cpg-labs/*.log`. Tail: `ssh -i ~/.ssh/cpg-labs-lightsail.pem ubuntu@54.221.23.142 'sudo tail -F /var/log/cpg-labs/*.log'`.

### Pattern

```ts
console.info(`[module-name] operation START shop=${shop} param=${value}`);
console.info(`[module-name] operation OK shop=${shop} result=${count}`);
console.warn(`[module-name] operation SKIP shop=${shop} reason=details`);
console.error(`[module-name] operation FAILED shop=${shop}`, error);
console.info(`[module-name] status updated ${prev} → ${next} shop=${shop}`);
```

### Rules
- Prefix `[kebab-case-module-name]`. Sub-contexts `[module:context]`.
- Always include `shop=` on loader/action/service-level logs.
- Log at: operation start, final result, each paginated loop iteration.
- Include counts (`orders=`, `customers=`, `routes=`) on summary lines.
- Nullable: use `${value ?? "?"}`.
- **Never log secrets, tokens, or PII** (no API keys, emails, addresses).
- `console.info` normal, `console.warn` recoverable, `console.error` failures.
- Long-running syncs: log elapsed time, per-step duration, running totals.

## GE Beauty

Operational tooling for GE Beauty lives in `sandbox/gebeauty/` (moved 2026-04-23). When designing features that intersect GE Beauty operations, read `sandbox/gebeauty/field-notes.md`.
