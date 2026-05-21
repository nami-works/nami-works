# Markdown lessons — Local Delivery UI/UX spec

A side-by-side of the original spec and a cleaned-up version, plus what changed and why. Use this as a reference for writing future specs in a way Claude can parse with the least friction.

---

## Before (original)

````markdown
UI / UX tweaks to local delivery

# Fulfillment details:
- remove 'Start date' filter and hardwire D-90 as the default period
- remove 'Dalivery promise' and 'Time limit for same day'; location's settings must be fetched from corresponding location at Settings page
- move all other remaining elements inside 'Route manager' block, in the same sequence
- remove 'all' text rendered below 'Orders to deliver' badge, currently displayed when all locations are selected

# Orders states (emojis and legends everywhere)
- add a new state for *failed deliveries*
## apply to any orders containing 'ld_failed-delivery' tag
## this state must overwrite any other 'due date' state
## suggest name + 3 options of emojis
- replace parcel emoji with "ampulheta" emoji for orders due today
- add a new 'overdue' among due date states; suggest 3 options of emojis

# route manager actions
- add two new buttons
## one to fetch Lalamove quotes for all orders on location
## one to dispatch all orders on location (regardless of having a quotation ready)

# auto-assign logic
- orders under the new failed delivery state **ARE NOT SUPPOSED TO BE ADDED TO ANY ROUTE**

/senior-engineer /design-engineer /product-manager are expected to join

# All orders table
- replace tabs UI with Polaris native bagdes in grey-scale schema to separate active filter from others
- add a new 'Failed' filter
- optimize columns content for minimal space usage:
## Padding between columns: reduce by half
## Date column: remove 'at' from date + time
## Customer column: lock width to fit:
- 15 characters on expanded mode
- 10 characthers on collapsed mode
## Route column
- replace 'Unassigned' badge with '-'
- on collapsed mode only: replace 'Route ' with '#' (Route 02 > #02, etc)
## Due column
- remove 'Due' from badges in each line (Due today > Today, etc)
## Remove button: replace 'Remove from route' with 'Unassign'
````

---

## After (cleaned up)

````markdown
# UI/UX tweaks — Local Delivery

Agents expected to join: /senior-engineer, /design-engineer, /product-manager

## Fulfillment details
- Remove the "Start date" filter; hardwire D-90 as the default period.
- Remove "Delivery promise" and "Time limit for same day" — fetch these from the corresponding location's Settings page.
- Move all remaining elements into the "Route manager" block, preserving current sequence.
- Remove the "all" text rendered below the "Orders to deliver" badge when all locations are selected.

## Order states (emojis + legends, everywhere they appear)
- Add a new **failed delivery** state:
  - Applies to any order tagged `ld_failed-delivery`.
  - Overrides any due-date state.
  - Please suggest a name + 3 emoji options.
- Replace the parcel emoji with an hourglass ("ampulheta") for orders due today.
- Add a new **overdue** due-date state; suggest 3 emoji options.

## Route manager — new actions
- Add a button to fetch Lalamove quotes for all orders at the location.
- Add a button to dispatch all orders at the location (regardless of whether a quotation is ready).

## Auto-assign logic
- Orders in the new failed-delivery state **must not be added to any route**.

## All orders table
- Replace the tabs UI with Polaris native badges in a grey-scale scheme to separate the active filter from the others.
- Add a new "Failed" filter.
- Optimize columns for minimal space:
  - Halve the padding between columns.
  - **Date column:** remove "at" from the date + time string.
  - **Customer column:** lock width to fit
    - 15 characters in expanded mode
    - 10 characters in collapsed mode
  - **Route column:**
    - Replace the "Unassigned" badge with `-`.
    - Collapsed mode only: replace "Route " with `#` (e.g. `Route 02` → `#02`).
  - **Due column:** drop "Due" from each badge ("Due today" → "Today", etc.).
- Rename the "Remove from route" button to "Unassign".
````

---

## Lessons

### 1. Header levels are a hierarchy, not labels
- **Before:** `##` was used as an inline qualifier to add conditions to a bullet (e.g. `## apply to any orders containing 'ld_failed-delivery' tag` sitting under a `-` bullet).
- **After:** sub-rules of a bullet become **nested bullets** (`  -`). Reserve `#` for the doc title, `##` for top-level sections, `###` for sub-sections inside a section.
- **Why it matters:** when `##` appears inside what should be a list, the renderer breaks the list and starts a new section. The reader (and Claude) loses the "this qualifies the bullet above" relationship.

### 2. One nesting style per depth
- **Before:** mixed `##` headers and `-` bullets at the same conceptual depth (e.g. column rules under "All orders table").
- **After:** consistent `-` bullets with indentation for nesting.
- **Why:** consistent indentation makes it obvious at a glance which rules belong to which parent.

### 3. Pull "open questions" out of the spec body
- **Before:** "suggest name + 3 options of emojis" was buried as another `##` inside a bullet list.
- **After:** kept inline with the rule it modifies, but framed as a request ("Please suggest…").
- **Why:** open questions are a different *kind* of content from requirements. They're decisions you want from me, not things to build. Calling them out lets me answer them in chat without them getting lost in the build list.

### 4. Group related tweaks under one section
- **Before:** "All orders table" mixed filter UI rules and per-column rules as siblings.
- **After:** kept everything under one section but used a sub-bullet (`Optimize columns for minimal space:`) to group the column-density rules together. The reader can hold one concern at a time.

### 5. Be explicit about subjects
- **Before:** "replace tabs UI with Polaris native badges in grey-scale schema to separate active filter from others" — the *behavior* of the badges is implied.
- **After:** same sentence, but the intent ("separate the active filter from the others") is preserved as the *why*, not buried.
- **Rule of thumb:** if I'd have to ask "what should this look like when X?", say it now.

### 6. Bold the noun, not the verb
- **Before:** plain text labels (`Date column: remove 'at'`).
- **After:** `**Date column:** remove "at" from the date + time string.`
- **Why:** scanners look for the *thing* being changed, not the *action*. Bolding the noun makes the spec scannable in 2 seconds instead of 20.

### 7. Typos compound friction
- `Dalivery` → `Delivery`
- `bagdes` → `badges`
- `characthers` → `characters`
- One typo is a non-issue. Several across one spec slow down parsing because each one breaks the flow. Spell-check before sending if the spec is non-trivial.

### 8. Move metadata to the top
- **Before:** `/senior-engineer /design-engineer /product-manager are expected to join` sat between two sections, near the bottom.
- **After:** moved to a single line under the doc title.
- **Why:** "who's involved" is metadata about the whole task, not part of any section. It belongs near the title where readers expect to find it.

---

## Cheat sheet for future specs

1. **Title** with a single `#`.
2. **Metadata** (agents, links, dates) right under the title.
3. **Sections** with `##`, **sub-sections** with `###`. Never use `##` to qualify a bullet.
4. **Bullets** for parallel items. **Nested bullets** for sub-rules.
5. **Bold the noun** in `**Label:** description` patterns.
6. **Open questions** stay with the rule they modify, but framed as a request, not a header.
7. **Spell-check** before sending.
