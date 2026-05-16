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


## AI auto-routing
- Understand error "Slot 8 crosses the Tietê River; +15 min typical is within acceptable range for a normal SP multi-stop route, but peak-hour exposure (+35 min) on a 6-stop route could compound delays. Try again in a moment, or assign orders manually. Decision id: cmp7chxoo001ypb2yut19yh19."
- When displaying error "AI route optimization is off, Turn on "Use AI-powered route optimization" in Settings > Local delivery for this location, then try again."
  - add link to **Settings > Local delivery** to allow navigation straight from the error (open in new tab)

## modal **Order details**
- fix button *Open full order* (is not opening the order correctly, returns 404)
- place both buttons *Open full order* and *Close* at the right edge of the footer
- fetch phone from delivery address instead of default customer phone

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

