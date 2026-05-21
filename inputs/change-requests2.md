# CPG Labs — Campaigns Tab Change Requests

---

### Campaigns list page
- Replace all non-Polarist UI elements with native Polarist components

### New campaign modal — Step 1 (Basic info)
- Keep simple: Campaign name, Start date, End date only
- Replace Start date and End date fields with native Polarist calendar pickers
- Remove campaign metric from this step

### New campaign modal — Step 2 (Match rule)
- Add Campaign metric dropdown (moved from step 1) with these options:
  - Bundle orders
  - Specific products
  - Specific combination of products
  - AOV
  - Revenue
- Each metric type will have its own tracking parameters
- Match rule type dropdown changes:
  - Add **Line item — product type**
  - Remove **Line item — SKU**
  - Replace with native Polarist component
- Match values field: replace free-text input with a dropdown that dynamically fetches available options from Shopify via **GraphQL**, scoped to the selected match rule type (e.g. product tags, product types, product IDs, etc.)

### New campaign modal — Step 3 (Targets)
- Add a dropdown to select a **previous period as baseline** (e.g. last month, last quarter, last year)
- Auto-populate the Baseline column with data from the selected period — remove manual baseline entry
- Replace all input fields with native Polarist components

### New campaign modal — Step 4
- Replace all input fields with native Polaris components