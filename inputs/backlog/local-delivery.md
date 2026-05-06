# **Local delivery** backlog

## Route optimization

### Assignment logic
- *DO NOT EVER* add orders tagged with 'ld_failed-dalivery' to any route
- *DO NOT EVER* add orders tagged with 'ld_address-confirmation' to any route

### Traffic_aware config
- drop for **ALL** calls: Lalamove already uses traffic_aware on their side to optimize, so we do not need it
### route's polyline handling
- add 'Edit' + 'Confirm'/'Cancel' icon buttons to the map block

#### 'Edit':
- visible by default
- when clicked:
  - unlocks drag+drop feature
  - formats all current polylines as dotted and subdued colors
  - Edit button itself disappears to reveal 'Confirm' + 'Cancel'
#### 'Confirm':
- hidden by default
- visible when 'Edit' is clicked
- when clicked:
  - calls API to recalculate routes (no traffic_aware)
  - new routes polylines are rendered in default format
  - previous routes polylines are erased completely
#### - 'Cancel': 
- hidden by default
- visible when 'Edit' is clicked
- when clicked:
  - clears all changes made since last auto-assignment or last click on *Confirm*
  - original routes polylines are rendered back in the default format

## Address errors management
- add the *parsing/correction process* built at Nami Works, to manage trivial corrections automatically
- for cases that the *parsing/correction process* can't handle
  - if issue is **duplicated number**: both number in adr1 and adr2 are equal (eg.: "Endereço: Rua Forte William, ⁠11; Complemento: 11 Matizes, ⁠Panamby), add tag 'ld_number-confirm' to the order
  - if issue is not **duplicated number**:  add tag 'ld_address-confirm' to the order
- study how to leverage addresses from previous orders to confirm an order is correct
   eg: I've seen a suspect order by a customer who placed another few days prior, and we confirmed it was right; we should assume it is right (what are the rules for that?)

### "Potential address errors: n" badge
- make the badge visible when 'All locations' is selected
- rewire the modal to:
  - display a list of orders with address errors, with *no per-order* CTA
  - wire a single primary button "Fix addresses", that when clicked:
    - opens *a new tab* with Shopify's native order list view, filtering all orders containing the tag 'ld_address-confirm'
      - the goal here is to allow users to fix all orders at once, instead of opening each order in a new window, since the order list allow address editing

## UI/UX adjustments
- Verify logs from 05-05-26 16h15 BRT to understand 502 error
### Orders and routes status:
- Standardize all badges:
  - "[icon] Failed delivery: 2"
    - icon: *alert-octagon* Shopify web-component
    - <s-badge tone="warning">
    - ": n" instead of "(n)"
  - "[icon] Potential address errors: 1" > no change 
  - "[icon] Shipment requests to process (6)" > completely remove *UI and logic* from codebase
  - "[icon] Orders to deliver: 17" > suggest icon; blue info bagde
    - icon: suggest a Shopify web-component;
    - <s-badge tone="info">
    - ": n" instead of "(n)"
- Dispatching UI feedback: "Dispatching: 1/3" > remove space before and after "/"
- Per-route cards
  - Place delivery status bagdes ("Looking for driver", "Driver heading to pickup") at the same row as the main action button, to the left of the button
  - Move secondary actions inside a per-route action menu ("Manage", "Details", "Clear route")
    - **Preserve the visibility logic** (when each button must be displayed/hidden); only the placement of buttons change
- Expanded layout
  - Render sidebar blocks (*Route manager* and *Auto-assign accuracy*) at the same relative positions to the main block

## Route dispatching
- Verify why 'Dispatch all' button is not working and propose a fix
- Suggest  field mapping to update order's delivery status on Shopify according to Lalamove's status
   - notes: we will use this to trigger new whatsapp messages
     - with order tracking for user when status = deliery on the way
     - requesting address confirmation for user when status = failed delivery

