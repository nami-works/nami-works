# Retail Goals Page — Change Requests

## Name and routes: change all to *Retail sales*

## Scoreboard

### Layout
- Reorder cards: **Total Revenue → Orders → AOV**
- Preserve uniformity in cards height: all top-aligned

### Total Revenue card
- Relabel "vs goal" to "vs MTD goal"
- Replace "proj" with "Projection" in the subdued row

### AOV card
- Use default Polaris for the helper text element
- Replace main comparison "vs goal" with "vs previous month" (recalculate variance)
- Remove projection and goal rows (no difference between actual and projection for AOV, no goal)

### Orders card
- Use default Polaris for the helper text element
- Replace main comparison "vs goal" with "vs previous month" (recalculate variance)
- Remove goal comparison row (no goal for Orders)

---

## Volume / Quality

### Layout
- Reorder cards: **Total Revenue → Orders → AOV**
- Preserve uniformity in cards height: all top-aligned

### Same-store YoY card
- Use default Polaris for the helper text element
- Display variance in green when positive and red when negative
- Add a new row showing the highest growth rate store vs previous year

### Best vs worst card
- Rewrite copy for clarity — it's about goal achievement ranking but currently not obvious
- Clarify what "ahead of Shopping Recife 51%" means (add explicit context)

### Discount rate card
- Remains untouched for now (to be replaced with a quality card TBD)

---

## Expanded Charts (all)

### General
- Highlight the active/selected card in navy blue (subdued), keeping text readable in black (see reference in footprint-expansion app)
- Add rounded top corners to **prior year bars** to match the projected year bar styling (currently sharp-edged)
- Add a **label to the goal line** on all charts that display it (currently unlabelled)
- Move chart **legend to bottom center** on all charts

### Revenue by Location chart
- Split the projected bar into two portions:
  - **Actual portion (bottom):** Solid navy blue with gradient fade lightening toward top
  - **Transition:** Smooth gradient from navy → lighter blue at the actual/projected boundary (no sharp cut)
  - **Projected portion (top):** Fading from light blue to transparent, with a border consistent with the actual portion
- Add labels to both portions: white for actual part, black for transparent part

### Orders by Location chart
- Apply the same actual/projected split bar effect as Revenue by Location
- Apply the same labels as Revenue by Location

### AOV by Location chart
- No split bar effect (AOV is not projected)

### Same-store YoY Chart
- Invert the axis for declining stores to show the bar going **downward** visually
- Keep the declining bar **red** to reinforce the downward direction

### Best vs worst Chart
- Apply tiered colour coding based on achievement %:
  - **Above 90%** → dark green
  - **60–90%** → dark yellow
  - **Below 60%** → red


---

## Breakdown by Location Table

- Retitle to **"Revenue breakdown by location"**
- Column header changes:
  - "MTD Revenue" → **"MTD"**
  - "Projected rev." → **"Projected"**
  - All other headers (Goal, Achievement, YoY, 13-mo trend) remain unchanged