# Local Delivery — Backlog

## delivery requests
- For routes with 3+ stops (delivery addresses), automatically add a 30' wait time (see Lalamove API field)
- Register delivery request time to identify time elapsed. If no driver accepted:
  - **20 min**: add 10% (or minimal) priority fee
  - **30 min**: add +10% (or minimal) priority fee
  - **45 min**: add +10% (or minimal) priority fee
  - **60 min**: automatically cancel and request again

## collapse/expand map behavior
- Refresh map zoom to encompass all orders

## address & order issues
- Add a large modal similar to Lalamove's to check addresses
- Fix number vs. street name (number after)
- After some requests, the system returns 404 but the order is confirmed
- Make the *driver requested* status persistent to prevent two calls for same route

---

## UI improvements

### [UI] Route manager — reorder "No assigned routes" message
When no routes are assigned, "No assigned routes for this location." should appear **above** the "Auto-assign" button, not below it.

### [UI] Map legend — collapsed emoji-only subtitles with hover expand
The legend row beneath the map ("Due today", "Due tomorrow", "Due later"):
- **Default state:** show only the emoji for each label (no text), inside a gray pill/container to signal interactivity
- **Hover state:** expand each item to show the full label (emoji + text)

### [UI] Route manager — wrap "Optimization applied" in Polaris success banner
Render the "Optimization applied: N routes" text inside a standard Polaris success container (green tint, checkmark icon) instead of plain styled text.

### [UI] Auto-assign — rename and promote to primary style
- Rename "Auto-assign orders" to "Auto-assign"
- Style as primary (main) button

### [UI] Auto-assign — hide "No assigned routes" message while assigning
While the auto-assign spinner/loading state is active, hide the "No assigned routes for this location." message to avoid conflict with the loading feedback.

### [UI] Map — match collapsed height to expanded height
The collapsed map should use the same dynamic height logic as expanded mode (fill available screen, balance visible area with always-visible buttons).

### [UI] Loading screen — embed video and match brand font
- Render `@public/omnify-loading.mp4` centered on the loading page (already done)
- Change the loading text font to match the font used on https://omnify.cpg-labs.io

---

## Feature changes

### [Feature] Auto-assign — enable button whenever unassigned orders exist
The "Auto-assign" button should be enabled any time the location has at least one unassigned order, regardless of other state.

### [UI/Feature] Route manager — "Add to best route" button visibility
- Aligned to the left side of the Route manager block
- Visible only when: one or more unassigned orders are selected **AND** at least one assigned route exists
- Secondary style

---

## Bugs

### [Bug] Auto-assign — 504 timeout despite successful route assignment
Server returns 504 on slow auto-assign even though routes are assigned. Needs async/polling approach or longer timeout.

### [Bug] Request driver — button click produces no visible result
The "Request driver" button's multi-step Lalamove flow silently swallows errors when `routeId` is missing from action responses. Fixed: `useEffect` now handles errors with or without `routeId` and always opens `driverErrorModal`.

---

# Later
- Delivery time confirmation to avoid unsuccessful deliveries (send WhatsApp when order assigned to route?)
  - Include WhatsApp notification with ETA to signal order is on the way
