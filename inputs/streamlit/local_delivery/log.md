# Local Delivery - Change Log

This file registers all changes made to the Local Delivery system, documenting what changed, why it changed, how it works now, and the impact of each change.

---

## 2026-02-10 - Fix Delivery Promisse Debug Log

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Updated debug log field to use `orders_due_later` instead of removed `orders_due_tomorrow`.

**Why:**
- Prevent NameError when delivery promise changes.

**How it works now:**
- Debug logging reflects current grouping variables.

**Impact:**
- Affects: Debug logging only.
- Breaking changes: None
- Migration needed: No

---

## 2026-02-10 - Fix Due Tomorrow vs Due Later Split

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Corrected day‑bucket logic for due tomorrow vs due later under Day +2/+3.
  - Aligned map emoji classification with the corrected split.

**Why:**
- Orders placed yesterday should be due tomorrow for Day +2, not due later.

**How it works now:**
- Due tomorrow is computed as orders with age = promise_days - 1.
- Due later is computed as orders with age < promise_days - 1.

**Impact:**
- Affects: Orders grouping and map emojis for longer promises.
- Breaking changes: None
- Migration needed: No

---

## 2026-02-10 - Fix is_today Reference

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Replaced stale `is_today` reference with `is_due_tomorrow` in map color logic.

**Why:**
- Prevent NameError after delivery promise refactor.

**How it works now:**
- Map marker color uses due‑tomorrow classification instead of the removed `is_today`.

**Impact:**
- Affects: Map marker color assignment.
- Breaking changes: None
- Migration needed: No

---

## 2026-02-10 - Split Due Tomorrow vs Due Later

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Reintroduced "Orders due tomorrow" list for the original logic (orders placed today).
  - Added a separate "Orders due later" list for Day +2 / Day +3 promises.
  - Updated map emoji logic: alarm clock for due tomorrow, clock for due later.

**Why:**
- Keep the original due‑tomorrow behavior while supporting longer delivery promises.

**How it works now:**
- Orders are grouped into due today, due tomorrow, and due later when promise is beyond next day.
- Due tomorrow always represents orders placed today; due later represents orders within the extended promise window.

**Impact:**
- Affects: Orders grouping and map emojis.
- Breaking changes: None
- Migration needed: No

---

## 2026-02-10 - Delivery Promisse and Due-Later Logic

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Added a Delivery promisse selectbox and moved Applied filters into a paired row.
  - Updated due-today vs due-later split based on promise day offsets.
  - Updated map emoji logic to align with due-later classification.

**Why:**
- Allow switching between Next day, Day +2, and Day +3 definitions for order grouping.

**How it works now:**
- Orders are grouped by age in days relative to the selected promise.
- The due-later header and empty-state messaging adjust for Next day vs later promises.
- Applied filters now include the Delivery promisse value.

**Impact:**
- Affects: Orders grouping, map emojis, filter UI layout.
- Breaking changes: None
- Migration needed: No

---

## 2026-02-10 - Orders Header Cleanup and Bulk Buttons Placement

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Removed duplicated Orders header block.
  - Moved Select All / Deselect All buttons directly under the Orders header.
  - Positioned the due-today count bar below the buttons.

**Why:**
- Fix duplicated UI elements and align button placement to the requested layout.

**How it works now:**
- Only one Orders header is shown.
- Bulk action buttons appear immediately below the header, followed by the orders count bar and list.

**Impact:**
- Affects: Orders section layout.
- Breaking changes: None
- Migration needed: No

---

## 2026-02-02 - Add Debug Logs for Bulk Select

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Added logs to capture bulk action state and first checkbox render context.

**Why:**
- Gather runtime evidence on whether bulk selection state is applied before checkbox instantiation.

**How it works now:**
- Emits NDJSON entries to `.cursor/debug.log` with bulk action state and render timing.

**Impact:**
- Affects: Debug logging only (no behavior change).
- Breaking changes: None
- Migration needed: No

---

## 2026-02-02 - Fix Select All Session State Error

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Changed Select All/Deselect All to set a pending bulk action and rerun.
  - Applied bulk selection before rendering checkboxes.

**Why:**
- Prevent Streamlit session state mutation on checkbox keys after widget instantiation.

**How it works now:**
- Button click stores `bulk_select_action` and triggers a rerun.
- On the next run, selection state is applied before any checkbox widgets render.

**Impact:**
- Affects: Select All/Deselect All behavior in Local Delivery.
- Breaking changes: None
- Migration needed: No

---

## 2026-02-02 - Debug Instrumentation for Select All

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Added debug logs around order selection rendering and Select All/Deselect All actions.

**Why:**
- Investigate Streamlit session state mutation error when using Select All/Deselect All.

**How it works now:**
- Emits NDJSON logs to `.cursor/debug.log` with counts and button state timing.

**Impact:**
- Affects: Debug logging only (no behavior change).
- Breaking changes: None
- Migration needed: No

---

## 2026-02-02 - Committed Routes Unassign All

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Added "Unassign all" action to each committed route expander.
  - Implemented batch unassign logic to clear route tags locally and in Shopify.

**Why:**
- Users need a quick way to clear an entire committed route and return orders to the assignment list.

**How it works now:**
- Each committed route expander shows an "Unassign all" button with confirmation.
- On confirm, the system removes the route tag from all route orders in Shopify, clears local route tags, updates the committed routes cache, and refreshes the map.

**Impact:**
- Affects: Committed routes expander actions, Shopify tag updates, assignment list behavior.
- Breaking changes: None
- Migration needed: No

---

## 2025-01-XX - Added Shipping Charges to Committed Routes Display

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Updated `_process_orders()` to extract and store shipping charges from order data
  - Added `shipping_charge` and `shipping_currency` fields to order_data dictionary
  - Updated `_display_committed_routes()` to calculate and display total shipping charges per route
  - Added currency formatting for Brazilian Real (R$) with proper decimal formatting

**Why:**
- Committed routes section was only showing order counts, not shipping charges
- README documentation specified that routes should display format: "Rota #01 (4 orders; R$69,50)"
- Users need to see total shipping charges per route for financial planning and cost analysis

**How it works now:**
- System extracts shipping charges from `shippingLine.originalPriceSet.shopMoney` in GraphQL response
- Shipping charges are stored in order_data for each order
- When displaying committed routes, system:
  - Sums shipping charges for all orders in each route
  - Formats currency (BRL -> R$, others use currency code)
  - Displays in format: "Rota #01 (4 orders; R$69,50)" (order count and total shipping charges)
- Brazilian Real amounts use comma as decimal separator (e.g., R$69,50)

**Impact:**
- Affects: Committed routes display, order data structure
- Breaking changes: None
- Migration needed: No
- Benefits:
  - Complete route information with both order counts and shipping charges
  - Better financial planning and cost analysis per route
  - Matches documented behavior in README
  - Proper currency formatting for Brazilian Real

---

## 2026-01-27 - Pre-sale Filter Applied to Map

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Applied pre-sale tag filtering to the map rendering as well as the assignable list.

**Why:**
- Keep map view consistent with the toggle selection for pre-sale tags.

**How it works now:**
- Orders excluded by pre-sale tag toggles are not shown on the map.

**Impact:**
- Affects: Map order visibility.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Pre-sale Expander Collapsed

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Set the pre-sale expander to be collapsed by default.

**Why:**
- Keep the main controls compact unless pre-sale selection is needed.

**How it works now:**
- The pre-sale expander starts collapsed and can be opened when needed.

**Impact:**
- Affects: Pre-sale UI default state.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Pre-sale Filtering Refactor

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Reworked pre-sale UI into an expander with tag toggles and confirm action.
  - Removed pre-sale filtering from map rendering and apply it only to Orders to assign list.
  - Default behavior now excludes pre-sale orders unless explicitly confirmed.

**Why:**
- Ensure all orders are fetched while keeping pre-sale orders excluded by default from assignment.

**How it works now:**
- Orders with tags matching "pré-venda"/"pre-venda" are hidden from the Orders list by default.
- Users can select tags in the expander and confirm to include those pre-sale orders in routing.
- Map and full orders table still show all orders regardless of pre-sale tags.

**Impact:**
- Affects: Pre-sale filtering, Orders list rendering, pre-sale UI controls.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Shopify Tags Override Route UI

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Removed local history fallback that re-applied route tags when Shopify tags were missing.
  - Clears local route history when Shopify no longer has the route tag.

**Why:**
- Shopify is the source of truth; manual tag removals must be reflected in the UI.

**How it works now:**
- If a route tag is removed in Shopify, the order returns to the unassigned list on reload.

**Impact:**
- Affects: Route persistence and UI state during reloads.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Replace st.debug Usage

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Replaced `st.debug()` calls with `st.warning()` to avoid Streamlit attribute errors.

**Why:**
- `st.debug` is not available in the current Streamlit version and causes crashes.

**How it works now:**
- Errors are surfaced via warnings instead of failing with an AttributeError.

**Impact:**
- Affects: Error reporting in Local Delivery.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Route Persistence Fallback

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Restores missing route tags from local tags history when Shopify tags are unavailable.

**Why:**
- Ensure route assignments persist across sessions even if Shopify tags are delayed or missing.

**How it works now:**
- During order processing, if no route tag is found on the order, the system checks local tag history and applies the saved route.

**Impact:**
- Affects: Route persistence on reload.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Route Separator Per Location

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Route selectbox now determines assigned vs unassigned per active fulfillment location.
  - Separator only appears when the current location has assigned routes.

**Why:**
- Ensure ordering and separator reflect the selected location context.

**How it works now:**
- Routes with orders in the current location appear first.
- If no routes are assigned in the current location, the separator is omitted.

**Impact:**
- Affects: Route selectbox ordering and separator display.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Render All Assigned Routes on Map

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Added map rendering for all assigned routes based on `route_tag` groups.

**Why:**
- Ensure all assigned routes stay visible on the map after new assignments.

**How it works now:**
- The map draws routes for every assigned route, not just the currently selected route.
- Selected route previews still render on top when selecting unassigned orders.

**Impact:**
- Affects: Map route rendering behavior.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Committed Routes Order Rows

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Rendered order info and Unassign button in a single row using columns.
  - Removed dividers between orders inside committed routes expanders.

**Why:**
- Improve compactness and readability of the committed routes list.

**How it works now:**
- Each order shows its label and Unassign action on the same line within the expander.
- Orders are displayed without horizontal dividers.

**Impact:**
- Affects: Committed routes expander layout.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Route Selectbox Separator

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Added a separator option between unassigned and assigned routes in the route selectbox.
  - Ignored the separator option in route selection logic.

**Why:**
- Make it clear where already-assigned routes start in the dropdown.

**How it works now:**
- Routes with no orders appear first.
- The separator `---Already assigned routes---` appears next (when applicable).
- Assigned routes follow after the separator.

**Impact:**
- Affects: Route selectbox ordering and display.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Future Dates List Always Visible

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Removed expander around the future-dated orders list.

**Why:**
- Keep future-dated orders visible without extra clicks.

**How it works now:**
- "Orders scheduled for future dates" renders as a normal header with a simple list.

**Impact:**
- Affects: Future-dated orders section layout.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Default Start Date D-1

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Updated default start date to yesterday (D-1).

**Why:**
- Match requested default date range behavior.

**How it works now:**
- When no prior selection exists, the start date defaults to yesterday.

**Impact:**
- Affects: Initial date filter value.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Orders Sections Not Expandable

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Removed expanders around Orders and Orders due tomorrow sections.
  - Wrapped only future-dated orders list in an expander.

**Why:**
- Align section behavior with requested UI structure.

**How it works now:**
- Orders and Orders due tomorrow are always visible with their headers and lists.
- Orders scheduled for future dates is the only collapsible section.

**Impact:**
- Affects: Orders section layout and visibility.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Future Orders Location Filter and Route Sorting

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Future-dated orders now capture fulfillment location and are filtered to the active location in the UI.
  - Route selectbox sorting now prioritizes unassigned routes and then alphabetical order.

**Why:**
- Ensure future-dated orders only appear for the selected location.
- Make route selection faster by listing empty routes first.

**How it works now:**
- Future-dated orders are filtered by the active fulfillment location before display.
- Routes are sorted by whether they have assigned orders (empty first), then by name.

**Impact:**
- Affects: Orders scheduled for future dates list, route selection ordering.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Orders Lists Reordered and Status Bars Split

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Split status bars to show due-today vs due-tomorrow counts.
  - Reordered UI elements to show Orders list, Orders due tomorrow list, route assignment, then future-dated orders.
  - Wrapped both order lists in expanders for toggle behavior.

**Why:**
- Provide clearer progress context per list and match the requested UI order.

**How it works now:**
- The main status bar reflects only orders due today.
- A new status bar appears under the Orders due tomorrow expander.
- The route assignment selectbox and button appear before the future-dated list.

**Impact:**
- Affects: Orders list layout and status indicators.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Committed Routes Expanders with Unassign

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Updated committed routes UI to render each route in an expander with a color indicator.
  - Listed orders inside each route expander with per-order unassign controls and confirmation.
  - Added batch tag removal helper for unassigning Shopify tags.

**Why:**
- Improve route visibility and allow quick unassignment directly from the committed routes list.

**How it works now:**
- Committed routes appear as expanders with route color emojis in the header.
- Each expander lists its orders and provides an Unassign flow with confirmation.
- Unassigning removes route tags locally and in Shopify, updates caches, and returns orders to the appropriate list based on date.

**Impact:**
- Affects: Committed routes UI, unassign flow, Shopify tag updates.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-27 - Persist Route Selection After Assignment

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Kept a stable selectbox key for route assignment to preserve the selected route after confirmation.
  - Removed the selectbox reset counter on assignment.

**Why:**
- Users need the selected route and rendered route line to remain visible after confirming assignment.

**How it works now:**
- The route selection persists across reruns, so the assigned route stays selected and the map continues to render the same route context.

**Impact:**
- Affects: Route assignment UI state, map route persistence after assignment.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-20 - Route Optimization Uses Shortest Path

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Updated `_optimize_route_sequence()` to use OSRM trip optimization with a fixed start.
  - Added fallback nearest-neighbor that starts from the fulfillment location.
  - Updated `_get_driving_route()` to select the shortest route option only.
  - Simplified map rendering to draw only the shortest route per segment.

**Why:**
- Ensure routes always optimize order points for the shortest driving path.

**How it works now:**
- When a route is rendered, order sequencing is optimized via OSRM trip API (source fixed to fulfillment location).
- If OSRM fails, the system falls back to a nearest-neighbor sequence starting from the fulfillment location.
- Each route segment uses the shortest OSRM alternative rather than displaying multiple options.

**Impact:**
- Affects: Route sequencing and map route rendering.
- Breaking changes: None
- Migration needed: No

---

## 2026-01-20 - Persist Committed Routes Per Location (Daily)

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Added committed routes cache stored per date and fulfillment location.
  - Persisted route counts and shipping totals when orders are assigned.
  - Updated committed routes display to read from cache when no orders are loaded.

**Why:**
- Committed routes must persist between sessions for each location on the same day.

**How it works now:**
- On assignment, the system saves a per-location summary of route counts and shipping totals to disk for the current date.
- When switching locations (or after restarting), the committed routes section uses the saved summary for that location and day.

**Impact:**
- Affects: Committed routes display persistence and route assignment flow.
- Breaking changes: None
- Migration needed: No

---

## 2025-01-XX - Changed Allocation Indicator Emoji from Arrow to Target

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Changed emoji indicator for orders allocated to different fulfillment locations from ➡️ (arrow) to 🎯 (target)
  - Updated map marker display to use 🎯 before parcel emoji
  - Updated order list display to use 🎯 after customer name

**Why:**
- Arrow emoji (➡️) was not visually effective on the map due to color contrast issues
- Target emoji (🎯) provides better visibility and contextually represents allocation/assignment
- More distinct and recognizable visual indicator for orders allocated to different fulfillment locations

**How it works now:**
- On map: 🎯 emoji appears before the parcel emoji (e.g., 🎯📦) for orders allocated to different fulfillment locations
- In order list: 🎯 emoji appears after customer name (e.g., "Customer Name 🎯") for allocated orders
- Visual indicator helps users quickly identify orders that are being allocated to different fulfillment locations

**Impact:**
- Affects: Map marker display, order list display
- Breaking changes: None
- Migration needed: No
- Benefits:
  - Better visual contrast and visibility on map
  - More contextually appropriate emoji for allocation/assignment
  - Improved user experience with clearer visual indicators

---

## 2025-01-XX - Reentrega Order Tracking and Special Formatting

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Added persistent cache system for reentrega orders assigned to routes (`ld_reentrega_cache.json`)
  - Added `_get_reentrega_cache_file_path()`, `_load_reentrega_cache()`, `_save_reentrega_cache()` methods for cache management
  - Added `_add_to_reentrega_cache()` and `_remove_from_reentrega_cache()` methods
  - Updated route assignment logic to store reentrega orders in cache when assigned to routes
  - Updated `_process_orders()` to check cache and verify delivery status for cached reentrega orders
  - Added automatic tag removal for delivered reentrega orders (removes `ld_reentrega` tag from Shopify)
  - Updated map marker display to add ⚠️ emoji before parcel icon for non-delivered cached reentrega orders
  - Updated map marker order number styling (black border and font, yellow background) for non-delivered cached reentrega orders
  - Updated order list display to add ⚠️ emoji before order number for non-delivered cached reentrega orders

**Why:**
- Orders tagged with `ld_reentrega` need special tracking after being assigned to routes
- System needs to monitor delivery status and automatically remove tags when orders are delivered
- Non-delivered reentrega orders need visual indicators to highlight their status
- Cache persists across sessions to track reentrega orders even after page refresh

**How it works now:**
- When an order with `ld_reentrega` tag is assigned to a route:
  - Order is stored in persistent cache (`data/local_delivery/ld_reentrega_cache.json`) with fulfillment location and route tag
  - Cache entry includes assignment timestamp for tracking
- Upon next load of orders for the same fulfillment location:
  - System checks cache for reentrega orders
  - For each cached order, verifies delivery status (FULFILLED = delivered)
  - If delivered: Removes `ld_reentrega` tag from Shopify and removes order from cache
  - If not delivered: Applies special formatting:
    - ⚠️ emoji before parcel icon on map
    - Order number text block with black border and font, yellow background on map
    - ⚠️ emoji before order number in order list
- Cache is checked per fulfillment location to ensure proper filtering

**Impact:**
- Affects: Route assignment, order processing, map display, order list display, tag management
- Breaking changes: None
- Migration needed: No
- Benefits:
  - Automatic tracking of reentrega orders across sessions
  - Automatic tag cleanup when orders are delivered
  - Clear visual indicators for non-delivered reentrega orders
  - Improved workflow efficiency for managing re-delivery orders
  - Persistent cache ensures tracking continues even after page refresh

---

## 2025-01-XX - Visual Indicators for Orders Allocated to Different Fulfillment Locations

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Added `_get_actual_fulfillment_location_from_order()` method to extract actual fulfillment location from order fulfillments
  - Added `_is_order_allocated_to_different_location()` method to detect when actual fulfillment location differs from mapped location
  - Updated `_process_orders()` to detect and store `is_allocated_to_different_location` flag in order data
  - Updated map marker display to add 🎯 emoji before parcel emoji when order is allocated to different location (changed from ➡️ to 🎯 for better visibility)
  - Updated order list display to add 🎯 emoji after customer name when order is allocated to different location (changed from ➡️ to 🎯 for better visibility)

**Why:**
- System fetches orders from fulfillment centers that do not perform local deliveries (e.g., CD Cajamar) and allocates them to available fulfillment locations (e.g., Shops Jardins)
- User requested visual indicators to identify these orders that are being allocated to different fulfillment locations
- Helps users quickly identify orders that need special attention due to fulfillment location allocation

**How it works now:**
- System compares actual fulfillment location (from Shopify fulfillments) with mapped fulfillment location (from province mapping)
- When they differ, order is marked as `is_allocated_to_different_location = True`
- On map: 🎯 emoji appears before the parcel emoji (e.g., 🎯📦) for allocated orders
- In order list: 🎯 emoji appears after customer name (e.g., "Customer Name 🎯") for allocated orders
- Visual indicators help users quickly identify orders that are being allocated to different fulfillment locations

**Impact:**
- Affects: Map marker display, order list display, order data structure
- Breaking changes: None
- Migration needed: No
- Benefits:
  - Clear visual identification of orders allocated to different fulfillment locations
  - Helps users understand which orders need special handling
  - Improves workflow efficiency by highlighting allocation differences
  - No impact on existing functionality, only adds visual indicators

---

## 2025-01-XX - Default Date Range Changed to -60 Days

**What Changed:**
- File: `functions/local_delivery/_local_delivery.py`
  - Changed default starting date from -7 days to -60 days
  - Updated variable name from `last_7_days_start` to `last_60_days_start` for clarity
  - Updated comment from "Last 7 days" to "Last 60 days"
- File: `functions/local_delivery/README.md`
  - Updated documentation to reflect new default date range (Last 60 days to today)

**Why:**
- User requested default starting date to be changed from -7 days to -60 days
- Allows users to see a larger historical range of orders by default when opening Local Delivery

**How it works now:**
- When Local Delivery is first accessed, the default date filter is set to 60 days ago (today-60 to today)
- Users can still manually adjust the start date using the date picker control
- End date remains fixed to today (unchanged behavior)

**Impact:**
- Affects: Default date filter initialization, user experience when first accessing Local Delivery
- Breaking changes: None
- Migration needed: No
- Benefits:
  - Shows more historical orders by default (60 days vs. 7 days)
  - Better visibility of older unfulfilled orders
  - No impact on existing functionality, users can still adjust date range manually

---

## 2025-01-XX - README Documentation

**What Changed:**
- File: `functions/local_delivery/README.md`
  - Created comprehensive README documentation matching GeoCommerce and PDP Maker formatting standards
  - Documented complete system architecture, features, and usage
  - Added installation instructions, configuration details, and troubleshooting guide

**Why:**
- User requested comprehensive README file to present the system's current state
- Documentation needed to match formatting and structure of other CPG Labs functions (GeoCommerce and PDP Maker)
- Provides developers and users with complete understanding of system capabilities, architecture, and usage

**How it works now:**
- README.md contains comprehensive documentation organized into sections:
  - **What Does It Do?**: Overview of system capabilities and key deliverables
  - **How Does It Do It?**: Detailed architecture, data processing, route management, and algorithms
  - **Why Does It Do It?**: Business purposes, use cases, and value propositions
  - **Installation**: Dependencies, environment configuration, Shopify setup
  - **Usage**: Application flow, route visualization, address validation, route management
  - **Configuration**: Environment variables, defaults, route configuration, validation rules
  - **Data Processing**: Order filtering, geocoding strategy, route optimization, data schema
  - **Performance Considerations**: Caching, rate limiting, memory management
  - **Troubleshooting**: Common issues and solutions
  - **API Reference**: Main classes and key methods
  - **Contributing**: Guidelines for contributors

**Impact:**
- Affects: Documentation system, developer onboarding, user understanding
- Breaking changes: None
- Migration needed: No
- Benefits:
  - Provides clear reference for system capabilities
  - Enables faster onboarding for new developers
  - Documents current implementation state comprehensively
  - Matches documentation standards across CPG Labs functions

---

