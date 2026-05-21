# Shopify Project Rules

## Product & Scope
- Keep apps embedded and aligned with Shopify Admin UX.
- Prefer Polaris web components for UI consistency.
- Default filters sensibly; avoid hardcoding feature-specific assumptions.

## Data & Permissions
- Request only required access scopes; update the relevant `shopify.app.*.toml` when needed.
- Handle protected customer data errors with a clear UI banner fallback.
- Normalize Shopify Admin API responses into stable UI types before rendering.

## Maps & Geodata
- Use the Maps JavaScript API with `importLibrary` and `mapId`.
- Do not mix cloud-based map styling with JSON styles in the same map.
- Validate `GOOGLE_MAPS_API_KEY` and `GOOGLE_MAPS_MAP_ID`; show banners if missing.
- Only style markers you create; never target internal map DOM.

## UI Structure
- Use `s-page` + `s-section` layout and slots (`aside`) consistently.
- Keep primary actions in header slots (`primary-action`, `secondary-actions`).
- Build lists with `s-box` + `s-stack` and clear selection affordances.

## State & Interactions
- Keep selection state in React and de-dupe by IDs.
- Disable actions when prerequisites are not met.
- All Shopify mutations must go through `action` handlers.

## Error Handling
- Show banners for API errors, map load errors, and missing credentials.
- Keep logs for developer diagnostics only; user messages must be clear.

## Performance & Cost
- Avoid unnecessary map re-inits; update options and markers in place.
- Use field masks for GraphQL and external APIs to reduce payload and cost.
- Cache expensive computations where safe and appropriate.

## Styling
- Keep CSS scoped in route-level `styles.module.css`.
- Prefer ASCII in code and comments unless user-facing text requires otherwise.

## Quality & Safety
- Run lint checks for modified files.
- Never hardcode secrets; use environment variables.
- Avoid destructive git commands unless explicitly requested.