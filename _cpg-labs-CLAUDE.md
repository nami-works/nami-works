# CPG Labs — Project Rules

This is the single source of truth for all AI-assisted development in the Omnify codebase.

## Project Identity

CPG Labs is an embedded Shopify app. **Production URL:** `https://omnify.cpg-labs.io`

### Tech Stack
- **Framework:** React Router v7 + Shopify App React Router
- **UI:** Polaris web components (`s-page`, `s-section`, `s-stack`, `s-box`)
- **Data:** Prisma (SQLite locally, PostgreSQL in production via AWS RDS)
- **Maps:** Google Maps JavaScript API, Google Routes API
- **Language:** TypeScript (strict) | **Bundler:** Vite

### Core Features & Routes
- **Local Delivery** — `/app/local-delivery` — Route planning, map, order tags
- **Sales Goals** — `/app/sales-goals` — Monthly sales targets by location
- **Retail Expansion** — `/app/retail-expansion` — Location ranking with Maps + analytics
- **Sales** — `/app/merchandising/sales` — Bulk price campaigns with optional price tag labeling (merged from Campaigns + Price Tags)
- **Story-telling** — `/app/storytelling` — AI blog content generation
- **Settings** — `/app/settings` — Delivery locations, providers, carriers

### Key Commands
```bash
npm run dev           # Shopify app dev (tunnel)
npm run build         # React Router build
npm run setup         # prisma generate + prisma migrate deploy
npm run lint          # ESLint
npm run typecheck     # React Router typegen + tsc --noEmit
npm test              # Webhook tests
npx prisma migrate dev  # Create/apply migrations
```

### Architecture
| Area | Path |
|------|------|
| App routes | `app/routes/` |
| Shopify auth | `app/shopify.server.ts` |
| DB schema | `prisma/schema.prisma` |
| Extensions | `extensions/` |
| Infra (ECS, RDS, ALB) | `infra/terraform/` |
| Deploy scripts | `scripts/` |
| i18n | `app/i18n/` |

### Deployment
- **Hosting:** AWS ECS Fargate behind ALB (`us-east-1`)
- **Database:** AWS RDS PostgreSQL
- **Secrets:** AWS SSM Parameter Store (`/omnify/` prefix)
- **Deploy:** `scripts/deploy-cpg-labs.ps1` (CPG Labs) or `scripts/deploy-omnify.ps1` (Omnify)
- **Shopify scopes (CPG Labs):** `shopify app deploy --config shopify.app.cpg-labs.toml`
- **Shopify scopes (Omnify):** `shopify app deploy --config shopify.app.omnify.toml`

### Environment Variables
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`
- `DATABASE_URL` — Postgres (production)
- `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID`
- `APP_IDENTITY` — `cpg-labs` (all features), `omnify`, `retail`, `storytelling`, `storefront`
- `BASE_PATH` — subpath for multi-app deployments (e.g. `/full`)

---

## Hard Rules

- **Always confirm before writing to the live store.** Any Shopify API mutation (product updates, metafield changes, discount edits, theme writes) must be explicitly approved by the user before execution. Present the proposed changes, wait for confirmation, then apply.
- **Production and `main` must stay in sync.** Anything deployed to production must also be committed to `main`. If a session deploys changes (via `scripts/deploy-*.ps1`, `shopify app deploy`, or any infra/website push), the corresponding code changes must be committed in the same session — no "I'll commit it later." Conversely, if uncommitted work exists on disk that's already running in production, treat committing it as part of the current task before moving on.
- Keep the app embedded and aligned with Shopify Admin UX.
- Prefer Polaris web components for page and form structure.
- **One top-level `<s-page>` per route.** No extra wrappers.
- Use **CSS modules** at route level: `app/routes/<route-name>/styles.module.css`, camelCase class names.
- All layout in CSS modules; inline styles only for runtime-computed values.
- **Native form elements inherit fonts globally.** `app/root.tsx` applies `font-family: inherit; font-weight: inherit` to `select, input, textarea, button`. Do not add per-element font overrides — the global rule handles it.
- Keep selection state in React, de-duped by IDs.
- Disable actions when prerequisites are missing.
- Show clear error banners for API errors, map load failures, and missing credentials.
- **Never hardcode secrets;** use environment variables.
- **Never hardcode store-specific values** (metaobject types, field names, metafield keys, colors). All configuration comes from UI → database.
- All Shopify mutations go through React Router **`action` handlers.**
- Use `redirect` from `authenticate.admin` for auth-protected flows; `redirect` from `react-router` is fine for simple navigational redirects (e.g. home page).
- **No idle UI elements.** Every button, modal, input, or control must have a real effect on the process. Never add decorative or placeholder UI that doesn't do anything.
- **New UI elements require clarification.** Before adding any new button, modal, form field, or interactive element, ask the user:
  1. **How is it triggered?** (what user action opens/activates it)
  2. **What does it affect?** (what data, state, or flow it changes)
  3. **How should it behave?** (loading states, error handling, success feedback)
- **Reuse before creating.** If the requested behavior or logic resembles something already in the system, find the existing implementation and propose reusing it for consistency. Only create new patterns when no existing one fits.

---

## Task Contract

### Backlog Mode
When the user says **"backlog"** at the start of a session, enter backlog-building mode:
- **Do not** read files, explore code, or make any changes.
- Only collect and organize backlog items from the user's messages.
- Stay in backlog mode until the user says a trigger phrase like **"now plan"**, **"do the changes"**, **"start coding"**, or similar.
- Until then, every new message is interpreted as an addition to the backlog.

1. **Read** the target route and its sibling `styles.module.css` together.
2. **Reuse** existing components and patterns before introducing new abstractions.
3. **Normalize** API responses into stable UI types before rendering.
4. **Maps:** keep map instances stable; update markers/options in place.
5. **Collapsed & expanded forms:** When a page has both collapsed (non-fullscreen) and expanded (fullscreen) variants of the same UI section, **ALL** changes requested to UI elements must be applied to both forms.
6. **Before finishing:** run lint/typecheck/tests as applicable.
7. **In the final reply:** call out behavioral risks and manual test steps.

### Keeping docs/project-brief.md Updated
`docs/project-brief.md` is external context used by Claude in planning and ideation conversations (mobile app, Claude Projects, anyone unfamiliar with the code). It must stay in sync with the codebase — stale content misleads planning.

**Update whenever a session:**
- Introduces a new feature or renames an existing one
- Changes the multi-app identity mapping or scoped navigation
- **Starts a new initiative** → add to "In progress"
- **Lands an initiative** → move from "In progress" to "Recently shipped" with an absolute date, or delete if superseded
- **Shifts priorities** → reorder entries within their bucket
- Adds or removes a "Planned / not yet started" item

**The "Current Initiatives" section has three buckets:**
- **Recently shipped** — landed within the last ~3 weeks, kept as context for what just changed. Always tag with an absolute date (e.g. *(2026-04-08)*) so entries age cleanly. Prune anything older than ~3 weeks unless it is still load-bearing context.
- **In progress** — actively being built. Each entry should explain what, why, and where it stands (partially landed, planned, blocked).
- **Planned / not yet started** — acknowledged but not scheduled. One-line bullets are fine here.

When in doubt about whether something belongs in the brief, ask: "would a planning conversation be misled if this were missing?" If yes, add it. If the brief drifts from reality, fix it in the same session rather than deferring.

### Definition of Done
- Code follows route layout conventions used elsewhere in the repo.
- No obvious regressions in navigation, forms, or map interactions.
- `npm run lint` and `npm run typecheck` pass (or issues are explained).
- **After renaming or deleting route files**, run `npx react-router typegen` before `tsc`. React Router generates type files in `.react-router/types/` that become stale and cause phantom `TS2307` errors until regenerated.
- Relevant tests pass when affected (`npm test`).
- Scope/config changes reflected in Shopify app config.
- **Scope changes:** When any access scope is added or modified, remind the user to run `shopify app deploy --config <relevant-toml>` so the new scopes are deployed and the app doesn't crash.

---

## UI Patterns

Follow these conventions for all UI work.

### Layout
- Aside/config blocks on the **right** on desktop, matching Shopify admin native layout.
- On mobile (`max-width: 768px`), aside renders **first** (above main content) via `order: -1`.
- Two-column flex layout with `gap: 20px`, stacks vertically on mobile.
- **Data-heavy pages (Local Delivery, Retail Expansion):** Full-width `<s-page>`, no `inlineSize`.
- **Settings/config pages:** Use `inlineSize="base"` on `<s-page>`.
- **Header:** Primary actions in header slots (`primary-action`, `secondary-actions`). Main on right; Back/Cancel on left.
- **Form layout:** Responsive grid: `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;`.

### Tabs
All tabs use the flat/underline style. No emojis. No `<s-link>` (its shadow DOM forces blue text that CSS cannot override). CSS classes are defined per-route (not shared). The `TabBar` component (`app/components/tab-bar`) is deprecated — do not use it for new work.

- **When adding tabs to a page, ask the user:** "Will these tabs be potential standalone pages in a future app split, or will they always live inside this page?" The answer determines the element and placement:
  - `<Link to>` — tabs that navigate between Outlet child routes (e.g. Merchandising, Storytelling). Placed **outside** `<s-section>`, directly under `<s-page>`, above `<Outlet />`. Never use `<a href>` — plain anchors trigger full page loads which cause 404s inside the Shopify embedded iframe.
  - `<button onClick>` — tabs that switch content in-place without navigation (e.g. Settings, Sales Goals). Placed **inside** `<s-section>`, before the content. Add `border: none; border-radius: 0;` to reset button defaults.

- **CSS spec (route-level):**
  ```css
  .tabsRow {
    display: flex; align-items: center; gap: 7px;
    border-bottom: 1px solid #e1e3e5;
  }
  /* When inside <s-section>, bleed divider to section edges: */
  /* .tabsRow { margin: -4px -20px 12px; padding: 0 20px; } */

  .tab {
    padding: 8px 16px; border-bottom: 2px solid transparent;
    color: #6d7175; font-weight: 400; font-size: 13px;
    text-decoration: none; background: none; cursor: pointer;
    margin-bottom: -1px; /* overlap the container border */
  }
  .tab:hover { color: #303030; border-bottom-color: #8c9196; }
  .tabActive { color: #303030; font-weight: 500; border-bottom-color: #303030; }
  ```

### Collapsible Sections
Sections that collapse/expand (e.g. Fulfillment Details in Local Delivery, Cities Ranking and Expansion Projects in Retail Footprint) use a **bottom-right chevron toggle** — a real clickable `<div>`, not a CSS `::after` pseudo-element.
- **Structure:**
  ```tsx
  <div className={styles.collapsibleSectionWrap}>
    <s-section heading="...">
      {!collapsed && ( /* content */ )}
      <div
        className={`${styles.collapseChevron}${collapsed ? ` ${styles.collapsed}` : ""}`}
        onClick={() => setCollapsed(prev => !prev)}
        role="button"
        aria-label="Toggle section"
      >
        <span className={styles.chevronIcon}>›</span>
      </div>
    </s-section>
  </div>
  ```
- **CSS:**
  ```css
  .collapsibleSectionWrap { position: relative; }
  .collapseChevron { display: flex; justify-content: flex-end; padding: 4px 12px; cursor: pointer; }
  .chevronIcon { font-size: 18px; font-weight: 600; color: #8c9196; transform: rotate(270deg); /* UP = expanded */ display: inline-block; transition: transform 0.15s ease, color 0.15s ease; }
  .collapseChevron.collapsed .chevronIcon { transform: rotate(90deg); /* DOWN = collapsed */ }
  .collapseChevron:hover .chevronIcon { color: #303030; }
  ```
- Only the chevron area toggles — the heading is NOT clickable.
- The chevron lives **inside** `<s-section>` (not outside), so it renders within the Polaris card.

### Aside Card Blocks
Cards inside aside panels (e.g. Route Manager in Local Delivery, Expansion Projects in Retail Footprint) follow a shared structure:
```
┌─────────────────────────────────┐
│  [Badge]          [Destructive] │  ← cardHeader (negative-margin bleed)
│                                 │
│  stat line 1                    │  ← cardInfo (flex column, gap 4px)
│  stat line 2                    │
│                                 │
│          [Secondary] [Primary]  │  ← cardActions (flex-end, gap 12px)
└─────────────────────────────────┘
```
- **Wrapper:** `<s-box padding="base" borderWidth="base" borderRadius="base">`
- **Header:** `.cardHeader` — `display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin: -12px -12px 12px -12px; padding: 12px 12px 0;` — badge on left, destructive action (`<s-button variant="secondary" tone="critical">`) on right. This is an exception to the "Delete bottom-left" rule in the Buttons section — compact cards place the destructive action in the header for quick access.
- **Badge:** `.cardBadge` — `padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600;` — static color (`background: #e4e5e7; color: #303030`) or dynamic via CSS vars (`--badge-bg`, `--badge-text`).
- **Stats:** `.cardInfo` — `display: flex; flex-direction: column; gap: 4px; margin-top: 8px;`
- **Actions:** `.cardActions` — `display: flex; gap: 12px; align-items: center; justify-content: flex-end; margin-top: 12px;` — only constructive buttons (Edit, Load). Destructive actions live in the header.
- **Card gap:** `16px` between cards in a list.

### Block Titles & Content Blocks
- Block title class: `modalTitle` — `font-size: 18px`, `font-weight: 600`, `margin: 0`.
- Subsection title class: `subSectionTitle` — `font-size: 16px`, `font-weight: 600`.
- Content block structure:
```tsx
<div className={styles.locationSettingsBlock}>
  <s-box padding="base" borderRadius="base">
    <s-stack direction="block" gap="base">
      <h2 className={styles.modalTitle}>Block title</h2>
      {/* content */}
    </s-stack>
  </s-box>
</div>
```

### Buttons
- **All button rows must be right-aligned** (`justify-content: flex-end`) within their container — modals, blocks, cards, sections, everywhere. No exceptions.
- `<s-button>` web component: removing `disabled` dynamically may not re-enable it — use conditional rendering with different `key` values or two separate elements.
- **Processing state:** Use `<s-button loading disabled>` as the standard feedback for in-progress actions (e.g. Apply, Save, Submit). Swap via key-based conditional rendering. Optionally change the button label text (e.g. "Applying…"). This is the canonical pattern — do not use external spinners below buttons.
- **Delete buttons:** Always confirm via a separate confirmation modal before executing the delete. Placement depends on whether delete is the expected action:
  - **Delete is the expected action** (e.g. confirmation dialogs, delete-only flows): Use `<s-button variant="primary" tone="critical">` right-aligned alongside other buttons. Order: Cancel → Delete (rightmost).
  - **Delete is NOT the expected action** (edit modals, settings blocks, any context where Save/Confirm is the primary intent): Place Delete **bottom-left** with `variant="secondary" tone="critical"`, spatially isolated from the primary action cluster on the right. This prevents misclicks. Use a split footer (`justify-content: space-between`): `[Delete]          [Cancel] [Save]`.
  - **Exception — Aside Card Blocks:** In card headers (Route Manager, Expansion Projects), the destructive action sits **top-right** next to the badge, not bottom-left. See the "Aside Card Blocks" section for this pattern. The bottom-left rule applies to modals and full-page forms; the top-right rule applies to compact cards.
- **Button order (left to right):** Cancel/Dismiss (secondary) → Save/Confirm/Load (primary). The main action is always **rightmost**; the dismiss action is always **leftmost**. This applies to modals, cards, blocks — everywhere. Exception: destructive actions go bottom-left when delete is not the expected action (see above).

### Tables
- **No zebra striping.** All tables use white rows with subtle borders — this is consistent across Local Delivery, Price Tags, Carrier Service, and Retail Expansion.
- Header rows: `background: #f6f6f7`, `font-weight: 600`, `color: #6d7175`.
- Data row borders: `1px solid #f1f1f1` (lighter than card borders).
- Row hover: `background: #f6f6f7`.
- Column group separators (multi-radius tables): `border-left: 2px solid #e1e3e5` on the first sub-column of each group.
- Wrap tables in a container with `overflow-x: auto` for mobile scroll.

### Icons
- Never use emoji for icons in elements that intend to resemble the native Shopify Polaris experience (e.g. search fields, action buttons, nav items). Use **inline SVG** following Polaris conventions: `viewBox="0 0 20 20"`, `width="16"`, `height="16"`, `aria-hidden="true"`, `currentColor`. See `app/components/tab-icons.tsx`. Emoji is acceptable in custom UI elements like tab labels where it's used as decorative content.

### Search & Modals
- When the action button opens a **modal**, the inline search field captures text only — no dropdown results rendered inline. When results are intended to appear in the **same block** (no modal), an inline expander/dropdown is expected.
- Action buttons associated with an inline search field (e.g. Browse, Search, Filter) pass the typed text to the modal search field and trigger search automatically.
- Search results render **only inside the modal**, never in the main page.
- Modal search input: bordered container with SVG search icon inside, mimicking Shopify's native search.
- Clicking "Add" closes modal and clears search results.
- Declare `<s-modal>` wherever makes sense for code readability (near the triggering code).
- **Radio-button options in modals:** Use `<s-choice-list>` with `<s-choice>` children (not HTML `<input type="radio">`). For two-column option groups, use a CSS grid container: `grid-template-columns: 1fr 1fr; gap: 16px`. See Local Delivery map style modal and Retail Expansion heatmap options modal as reference implementations.
- **Draft/applied pattern for modal settings:** Keep a `draft` state and an `applied` state. On open, copy applied → draft. On cancel, reset draft → applied. On confirm, copy draft → applied and persist to localStorage.

### Badges
- Selected items displayed as Polaris-style badge chips with `×` remove button.
- `margin-top: 12px` between search row and badge list.

### Shopify Web Components
- Use `<s-option>` inside `<s-select>`, not HTML `<option>`.
- `<s-select>` onChange: cast with `(e.currentTarget as HTMLSelectElement).value`.
- `<s-choice-list>` onChange: cast with `(event.currentTarget as { values?: string[] } | null)?.values?.[0]` and validate against expected union type.
- **`<s-button>` with `commandFor`/`command` + `onClick`:** Never combine `commandFor="modal-id" command="--hide"` with an `onClick` handler on the same `<s-button>`. The modal dismiss command races with the click handler and the handler may never fire. Instead, run all logic inside the `onClick` handler and close the modal programmatically: `document.getElementById("modal-id")?.removeAttribute("open")`.
- **`<s-section>` slot assignment:** When wrapping `<s-section slot="aside">` in a `<div>`, move the `slot="aside"` to the wrapper `<div>` — Shopify's `<s-page>` only slots direct children.
- **Slots don't work from child routes.** `<s-page>` only sees direct children for slot assignment. A `<div slot="aside">` rendered inside `<Outlet>` (child route) will be ignored. If only one tab needs a sidebar, render the content inline within the main area instead.
- **Use `<s-checkbox>` instead of native `<input type="checkbox">`.** Native checkboxes render with browser-default blue; `<s-checkbox>` renders in Shopify's standard dark style.
- **`<s-checkbox>` does not accept children.** Place the label text outside as a sibling: `<s-checkbox checked={...} onChange={...} /> Label text`. Wrapping text inside `<s-checkbox>children</s-checkbox>` causes a TypeScript error (`Property 'children' does not exist`).
- **`<s-checkbox>` + label text toggle pattern.** HTML `<label>` wrapping does not auto-toggle `<s-checkbox>` (web component). Use a container `<div>` with `onClick` that toggles state, `role="button"`, and `user-select: none` in CSS:
  ```tsx
  <div className={styles.checkboxToggle} onClick={() => setState(prev => !prev)} role="button">
    <s-checkbox checked={value || undefined} onChange={() => setState(prev => !prev)} />
    Label text
  </div>
  ```
  ```css
  .checkboxToggle { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
  ```
  This is the system-wide standard for all `<s-checkbox>` + label combinations.

### Mobile
- All pages must be mobile-friendly. Main breakpoint: `768px`.
- Tables use `overflow-x: auto` for horizontal scroll on small screens.
- Modals and result lists must be scrollable/responsive.

### UI Tokens
| Token | Value | Use |
|-------|-------|-----|
| Subdued text | `#6d7175` | Secondary labels, helper text |
| Border | `#e1e3e5` | Cards, rows, dividers |
| Light border | `#f1f1f1` | Table data row separators |
| Subtle border | `#eceeef` | Grid-based table row separators |
| Shopify green | `#008060` | Active states, primary indicators |
| Critical red | `#d72c0d` | Delete buttons, error states |
| Light gray bg | `#f6f6f7` | Map canvas, empty states, table headers, hover |
| Header text | `#3a3a3a` | Stronger header labels (bordered tables) |

---

## Navigation

- Structure navigation around merchant tasks; keep categories minimal and scannable.
- Do not duplicate app nav links inside the page body.
- Use tabs only for secondary navigation below the header; keep tabs single-line.
- Provide a clear way back (breadcrumbs or Back button).

### Subpath (BASE_PATH)
When deployed under a subpath (e.g. `BASE_PATH=/full`), React Router uses `basename`. **Do not manually add basePath to client links or form actions** — you'll get `/full/full/...` and 404s.
- **Client links:** `href="/app/..."` — never `href={basePath + "/app/..."}`.
- **Form actions:** `action="/app/..."` directly.
- **`BASE_PATH` is baked at Docker build time**, not runtime. `react-router.config.ts` reads `process.env.BASE_PATH` during `npm run build` inside the Dockerfile. Changing the `BASE_PATH` env var on the ECS task definition alone will NOT update the basename — the image must be rebuilt with the correct `--build-arg BASE_PATH=...`. Docker layer caching can silently reuse a stale build; use `--no-cache` if the basename is wrong after deploy.

---

## MCP Usage
- Use **`learn_shopify_api`** before implementing unfamiliar Shopify flows.
- Use **`introspect_graphql_schema`** before changing GraphQL queries/mutations.
- Prefer schema-driven changes over guessing Shopify types/fields.

## Shopify API Gotchas
- **`discountNodesCount` caps at 10,000.** If you need an exact count above that, paginate and count manually.
- **Pagination without `sortKey` is unstable.** Shopify's default cursor pagination for discount/code queries can return different subsets on each run. Always use `sortKey: ID` or `sortKey: CREATED_AT` for deterministic traversal.
- **Bulk discount updates must be idempotent.** When updating thousands of codes, always check if each code already has the target state before mutating. Use a loop-until-zero-remaining pattern, not a single pass.
- **Theme settings are split across files.** Announcement bar content lives in `sections/header-group.json`, PDP banners in `config/settings_data.json`, and promotional logic in `snippets/*.liquid`. When auditing promotional consistency, read all three.
- **Classifying Shopify locations as store vs warehouse:** Use the `localPickupSettingsV2` field on the `Location` GraphQL type. Non-null = physical store (pickup enabled), null = warehouse/DC. This is more reliable than `fulfillsOnlineOrders` or `shipsInventory` for determining physical retail presence.

## GE Beauty Workspace
- **`gebeauty-workspace/`** contains operational tooling for the GE Beauty Shopify store (scripts, quiz content, API access).
- **`gebeauty-workspace/CLAUDE.md`** is the operational playbook — store access, product catalog, discount conventions, theme layout.
- **`gebeauty-workspace/field-notes.md`** captures lessons from manual store operations that should inform app features (especially Merchandising). Review this file when designing features for `app/routes/app.merchandising.tsx`.

---

## Product & Data
- Request only required access scopes; update the relevant `shopify.app.*.toml` when needed.
- Handle protected customer data errors with a clear UI banner fallback.
- Use field masks / `first:` limits on GraphQL to reduce payload.
- **Never store large record sets as a single JSON column.** Storing tens of thousands of records (orders, customers) in one Prisma `Json` column causes OOM on write and slow page loads on read. Use normalized tables with proper indexes instead. The Retail Footprint analytics migration (`RetailOrder`, `RetailCustomer`, `RetailCityMonthly`, `RetailHeatmapBucket`) is the reference pattern.
- **Background sync processes must survive container restarts.** ECS Fargate replaces tasks on deploy, killing in-flight background work. Design syncs so progress is persisted to the DB per page (not just at the end), and the sync status can be cleanly reset and restarted. Never rely on a single fire-and-forget promise completing before the next deploy.
- **Batch DB writes with raw SQL for bulk ingestion.** Prisma `$transaction` with hundreds of individual `upsert()` calls is ~100x slower than a single `INSERT ... ON CONFLICT DO UPDATE` via `$executeRawUnsafe`. Use the bulk pattern for sync/migration workloads (see `upsertRetailOrders` in `analytics-queries.server.ts`).
- **Optimistic creates: generate IDs client-side.** When a newly created entity must appear in the UI immediately (e.g. a new project card in a sidebar), generate the ID on the client (`set-${Date.now()}`), pass it to the server action via formData, and use it for optimistic local state. The server should prefer the client-supplied ID over generating its own. This prevents ID mismatches between optimistic UI and persisted data.

---

## Maps & Geodata
- Use Maps JavaScript API with `importLibrary` and `mapId`.
- Do not mix cloud-based map styling with JSON styles on the same map.
- Validate API keys; show banners if missing.
- Only style markers you create; never target internal map DOM.
- **City-level geocoding fallback:** When records (customers or orders) lack precise lat/lng but have a `city` field, geocode the city via Google Maps Geocoder and use the city centroid as coordinates. Cache geocoded cities in state (`cityGeocodes`) and persist via server action. Apply this fallback in `enhanced*` memos (e.g., `enhancedOrders`, `enhancedCustomers`) that combine precisely geocoded records with city-level fallbacks.
- **Customer counting in radius computations:** Merge unique IDs from BOTH geocoded customers within radius AND customer IDs from orders within radius. Use a `Set<string>` to deduplicate.

---

## Error Handling
- Show banners for API errors, map load errors, and missing credentials.
- Keep logs for developer diagnostics; user-facing messages must be clear.
- Avoid destructive git commands unless explicitly requested.

## Logging

Every server-side module (route loaders/actions, services, webhooks) **must** include structured console logs so issues can be traced via `aws logs tail /ecs/omnify-gebeauty --since 15m --region us-east-1`.

### Pattern

```ts
// Operation start
console.info(`[module-name] operation START shop=${shop} param=${value}`);

// Success
console.info(`[module-name] operation OK shop=${shop} result=${count}`);

// Skipped / non-fatal
console.warn(`[module-name] operation SKIP shop=${shop} reason=details`);

// Failure
console.error(`[module-name] operation FAILED shop=${shop}`, error);

// State transition
console.info(`[module-name] status updated ${prev} → ${next} shop=${shop}`);
```

### Rules
- **Prefix:** `[kebab-case-module-name]` — matches the feature (e.g. `[local-delivery]`, `[retail-footprint]`, `[price-tags]`). Use `[module:context]` for sub-contexts (e.g. `[local-delivery:webhook]`).
- **Always include** `shop=` on loader, action, and service-level logs (audit trail).
- **Log at:** operation start, final result (OK/FAILED/SKIP), and each paginated loop iteration for GraphQL fetches.
- **Include counts** (`orders=`, `customers=`, `routes=`) on summary lines.
- **Nullable values:** use `${value ?? "?"}` rather than crashing the template literal.
- **Never log secrets, tokens, or PII** (no API keys, customer emails, addresses).
- Use `console.info` for normal flow, `console.warn` for recoverable issues, `console.error` for failures.
- **Long-running sync pipelines:** Log elapsed time (`elapsed=Xs`), per-step duration (`durationMs=N`), and running totals (`total=N`) on every page/batch. This is essential for diagnosing stuck syncs vs. slow-but-progressing ones. Use `[module:sync]` sub-context prefix.

---

## Carrier Services

See `docs/carrier-services.md` for full platform docs.

**Lalamove** (last updated 2026-03-24)
- API v3 — REST, HMAC-SHA256 auth
- Sandbox: `https://rest.sandbox.lalamove.com/v3` | Production: `https://rest.lalamove.com/v3`
- Flow: POST `/v3/quotations` → get `quotationId` + `stopIds` → POST `/v3/orders`
- 11 markets: SG_SIN, HK_HKG, MY_KUL, PH_MNL, TH_BKK, VN_HAN/SGN, ID_JKT, TW_TPE, JP_TYO, MX_MEX, BR_SAO
- Official SDK: `@lalamove/lalamove-js` v1.1.0
- Env vars needed: `LALAMOVE_API_KEY`, `LALAMOVE_API_SECRET`
- **Special requests vary per city within the same market.** A single market (e.g. `BR_SAO`) contains multiple cities with different available special requests and service types. Always validate special requests against the specific city + service type, not just the market. The `/v3/cities` endpoint returns per-city availability; the config stores city in `lalamoveLocationConfig.data.city`.
