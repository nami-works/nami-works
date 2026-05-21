# Settings

## Locations
- enhance display time for success message when settings are changed to 3 seconds

## Tone of voice

### functionality and navigation
- during Monday and FB connections, system required a re auth (requested shopify domain) and crashed afterwards
  - fetch logs from 13/05/2022 18:15~18:45 BRT to understand
- since we can access tone of voice from *New brief* under *Storytelling*, there should be a *Back to brief* button when user reaches page through it
  - place it
    - at the top of each block
    - on the same row as the title
    - on the right edge
    - formatted as link (Polaris native)

### Sources  
#### Shopify blog posts
- allow user to filter macro blogs to prevent fetching blogs that are not in accordance with TOV
#### Business Facebook onbording 
- on Instagram and Facebook, Meta allows only snake_case system user names; suggest **omnify_tov_access**
- token generation requires an app associated with user; if merchant does not have it, it must be created first; suggest **omnify_tov**
- there must be a Phase 2 to retrieve Instagram Business ID and Facebook Page ID before generating the token (place it as B, and Token gen as C)
- make sure checkmarks for completed steps are Polaris native
- add **Instagram Bio** + profile picture as proof that the connection is succesful
#### Monday.com
- correct course to fetch API: "Profile → Admin → Connections → API → Personal API token"
- teach user how to fetch board ID
  - it is the board URL (https://your-space.monday.com/boards/6639318401)
    - **your-space**: merchant's admin URL
    - **6639316401**: board number
- fix UX on **C. Filter rules** and **D Preview & save*
  - after selecting filters, only *Preview* is available; *Save filters* should be primary action
    - with this change, I'm not sure we need a *Preview & Save* 4th step
  - *Preview* induces user to think they'll see actual content from the fields should be displayed automatically above the filters; should be dropped
  - an alternative would be think of another UI, such as those used on Excel to personalize tool bars (all available on left box, selected on right box)
#### Manual references
- drag+drop box is broken; must be fixed or UI removed, inducing user to always click to open Explorer and select
- during processing, replace "Extracting text via Claude…" with "Extracting tone of voice from file…"
  - process took longer than 5 minutes
    - user must be allowed to leave page and give them an forecast on time left, so they come back when it's done

### Traits
- rename as **Traits · 15 approved entries · 1 pending**
- allow pending traits to also be edited, not only rejected or accepted
- redesign UI acccording to the change requested on the name
  - it should allow visibility on all traits, emphasizing the pending ones
- Shopify, FB and Monday did not return any trait
  - understand why
- traits vs. sources:
  - under **Connected** for connections and **n reference** for references, disclose how many traits were approved by each

# Local delivery

## Routing
- Whenever orders are removed or included in routes, the route optimization should re-run upon confirmation, to display the updated best route
- Completely remove button *Add to best route* from UI and codebase
- When selecting orders to be added to any route, any route already dispatched must not be available to have orders added to it
- Orders already assigned to a route should not be included in the auto-assign selection for routing
- Whenever a never-before created route, add its view to the orders UI ("Rota #nn")
- drop the *Reassign* button entirely from the control panel; *Assign to new route* must handle both unassigned and already-assigned orders
  - *Assign to new route* must appear **whenever** at least one order badge is selected, regardless of whether the selected order(s) are already on a route

## route cards
- "Hold for review" badge
  - does not follow Polaris pattern (renders as a custom yellow pill instead of `<s-badge tone="warning">`); same applies to the route-state badge underneath (*Out for delivery*, *Driver heading to pickup* etc.) which is rendered as a custom orange/blue pill
  - all route-card badges must migrate to Polaris `<s-badge>` with the right `tone` so they match the rest of the admin
  - persists after clearing and reusing the route

## Dispatching
- Application error reported at 13/05/26 at 17:02 BRT when dispatching orders from São Paulo
- Notification: "AI route optimization succeeded; Routes applied. Confidence 82% — review the post-mortem panel for flagged choices (cmp4hs1kp02empb2yp4oeg778)."
  - add link to **post-mortem analysis** to allow navigation straight from the notification (open in new tab)
- Delivery time confirmation to avoid unsuccessful deliveries (send WhatsApp when order assigned to route?)
  - Include WhatsApp notification with ETA to signal order is on the way
- Application error reported at 15/05/26 at 16:34 BRT when confirming changes to a route in São Paulo
- Application error reported at 13/05/26 at 16:52 BRT when confirming changes to a route in São Paulo
- 502 reported at 16/05/26 at 16:59 BRT loading Local delivery (GET /app/local-delivery.data, locationId 97397014848); Caddy → upstream cpg-labs-full during a ~9s container-restart gap (clean exit, no OOM, ready at 16:59:44 BRT)
  - reverse proxy has no retry/health-gate on 502 — deploy/restart of full app surfaces as page-load failure to merchant
  - consider Caddy `lb_try_duration` + `lb_try_interval` on the upstream so restart gaps don't bleed to users
- add a per time-of-request escalation logic: the later the requests happened, higher and faster the escalation should happen
- **Lalamove errors modal shows "internal server error" but the order was actually dispatched** (reported 19/05/26 ~17:20 BRT)
  - logs confirm `POST /v3/quotations → 201 ok` → `POST /v3/orders → 201 ok` → `[local-delivery:action] Unhandled error { error: '[object Response]' …` — the Lalamove order is created successfully, then the action handler throws a `Response` object that the error logger can't serialize (prints literal `[object Response]`); the UI swallows it as a generic Lalamove failure
  - fix: in the dispatch action handler, do not throw `Response` after the Lalamove POST returns 2xx; return success and let the post-dispatch side-effect (tagging, persistence) report its own error separately
  - UX guard: after a successful Lalamove order create, never surface the *Lalamove errors* modal — if a downstream step fails, surface a distinct "Dispatched, but post-dispatch step failed" notice so the operator doesn't try to re-dispatch a live order
- **503s on `/app/local-delivery.data` loader** (~5×/hour as of 19/05/26)
  - logs show two confirmed in the last hour, both ~1.4–1.5s response time, ending right after `phase1-parallel` with no error line emitted before the 503 — suggests an unhandled throw inside the loader pipeline (likely the `orders-graphql-pagination` step) or an upstream/Caddy timeout that bubbles as 503
  - instrument the loader to log the failing step + the thrown error before responding, so future 503s have a traceable cause
  - once instrumented, fix the underlying cause (likely Shopify GraphQL throttle or connection drop on the 18-page paginated fetch)

## AI auto-routing
- When displaying error "AI route optimization is off, Turn on "Use AI-powered route optimization" in Settings > Local delivery for this location, then try again."
  - add link to **Settings > Local delivery** to allow navigation straight from the error (open in new tab)

## modal **Order details**
- fix button *Open full order* (is not opening the order correctly, returns 404)
- make information hierarchy gracious between *Customer* and *Shipping address* blocks (align labels, line-heights, font weights so the two columns read as a pair)
- add **City** to the *Shipping address* block (currently shows street + complement + "Fulfills from …" but no city)
- move footer buttons (*Open full order*, *Close*) to the **right edge** of the modal footer — convention is dismiss/primary right-aligned, not left

## map order balloon
- clicking an order on the map opens a full balloon that persists until another order is selected
  - rethink UX so the balloon is lighter / easier to dismiss (e.g. click outside to close, hover preview vs. click pin, compact card vs. full details)
  - balloon must expose a link to the full order page (Shopify admin order URL), distinct from the in-app *Order details* modal
  - balloon currently overlaps nearby order badges, blocking the user from clicking them to multi-select; balloon must not occlude other selectable pins (offset/anchor away, or shrink footprint)

## all orders table
- add a new "Due today" filter at the top to fetch only orders marked as Due today

# General

## Navigation
- Rename home breadcrumb from **Home** to **Omnify**

# Storytelling
## tabs navigation
- when *Blog posts > New brief* is selected, *Alt text* tab is pulled to the left in first position
  - desired:
    - when no *Blog posts* selected with no subtab selected: *Blog posts* | *Alt text*
    - when *Blog posts > New brief* selected: *Blog posts* > *New brief* | *Alt text*
## functionality
- there is simply no button to *generate blog posts* inside *New brief* which is the main funciton of this system
- upon installing, system should create a new *metafield* for blog posts called *Storytelling feedback*
- the *Blog post* page should be all revisited to fulfill its purpose
- the Streamlit predecessor allowed pasting multiple themes at once; the new flow here should be:
  - user pastes unstructured *themes*
  - system parses them, reasons on it with AI to generate the corresponding dictionaries
  - system shows *pre-filled* dictionaries to user (products, seo titles, keywords etc)
  - user approves (all at once, a sample or one by one)
  - blog posts are written by AI and actually added to content (as drafts)
  - blog posts are "marked" with a canonical id that will allow post-mortem learning from user's review before publication
  - blog posts are tagged with *storytelling-draft*
  - user is notified and taken to the *Content > blog posts* with a view filtering only blog posts tagged with *storytelling-draft* so they can review them
  - user reviews and adds *feedback* to field *Storytelling feedback*
  - cron job is defined to fetch blog posts from production batches *which are visible* and from *feedbacks* to understand what changed and presume reasons
  - assumptions are added to a new block inside *Tone of voice* with learnings to be validated, in a similar scheme as the *Traits* block (reject, edit, approve)
  - system dogfeeds from these approved to enhance its writing
- the system must be explicitly prompted to **NEVER** use hyphens, unless when creating lists.

