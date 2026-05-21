# Local Delivery - Route Planning & Order Management System

## Functional Specification

This document describes the complete functional specification for the Local Delivery route planning and order management system. It details all system workflows, Shopify API integrations, user actions, and system behaviors without reference to specific implementation technologies.

---

## System Overview

The Local Delivery system is a route planning and order management tool that helps merchants organize and assign local delivery orders to delivery routes. The system integrates with Shopify's Admin GraphQL API to fetch orders, update route assignments via tags, and manage fulfillment data.

**Core Capabilities:**
- Interactive map visualization of delivery addresses
- Route assignment with automatic Shopify tag synchronization
- Route optimization using nearest-neighbor algorithm
- Address validation and quality control
- Order filtering by fulfillment location, date range, and status
- Financial tracking (shipping charges per route)
- Pre-sale order management
- Delivery issue tracking (returns and re-deliveries)

---

## System Architecture & Data Flow

### High-Level Workflow

1. **User Configuration Phase**
   - User selects fulfillment location filter
   - User sets date range (start date to today)
   - System displays applied filters

2. **Order Loading Phase**
   - User clicks "Load orders" button
   - System fetches orders from Shopify API
   - System processes and filters orders
   - System geocodes addresses if coordinates missing
   - System displays orders in UI

3. **Pre-sale Order Handling Phase** (if applicable)
   - System detects pre-sale orders
   - User selects which pre-sale tags to include
   - User confirms selection
   - System filters orders based on selection

4. **Route Planning Phase**
   - User views orders on map
   - User selects orders via checkboxes
   - User selects target route
   - System renders optimized route on map
   - User confirms assignment
   - System updates Shopify tags
   - System refreshes display

5. **Route Management Phase**
   - System displays route statistics
   - User can clear route tags if needed
   - System tracks route assignments persistently

---

## Shopify API Integration

### Authentication

The system requires Shopify Admin API credentials:
- **Shop Name**: Shopify store identifier (without .myshopify.com suffix)
- **Access Token**: Admin API access token with required permissions
- **API Version**: Shopify Admin API version (e.g., 2024-01)

**Required API Permissions:**
- `read_orders` - To fetch order data
- `write_orders` - To update order tags

### GraphQL Queries

#### 1. Fetch Orders Query

**Query Name**: `GetOrdersWithCoordinates`

**Purpose**: Fetch orders with shipping addresses, coordinates, fulfillment status, and customer information.

**Query Structure**:
```graphql
query GetOrdersWithCoordinates($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query) {
    edges {
      node {
        id
        name
        displayFulfillmentStatus
        cancelledAt
        displayFinancialStatus
        tags
        shippingLine {
          title
          code
          originalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
        }
        shippingAddress {
          address1
          address2
          city
          province
          country
          zip
          latitude
          longitude
          name
          phone
          coordinatesValidated
        }
        customer {
          id
          email
        }
        fulfillments(first: 10) {
          id
          status
          displayStatus
          location {
            id
            name
            address {
              address1
              city
              province
              country
              zip
            }
          }
          trackingInfo {
            company
          }
        }
        createdAt
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

**Variables**:
- `first`: Number of orders per page (typically 50)
- `after`: Cursor for pagination (from previous page's `endCursor`)
- `query`: Search query string with filters (e.g., `created_at:>=2024-01-01 AND created_at:<=2024-01-31`)

**Response Structure**:
- `orders.edges[].node`: Individual order data
- `orders.pageInfo.hasNextPage`: Boolean indicating more pages
- `orders.pageInfo.endCursor`: Cursor for next page

**Pagination Strategy**:
- Fetch orders in pages of 50
- Continue fetching while `hasNextPage` is true
- Use `endCursor` as `after` parameter for next page
- Combine all pages into single order list

**Filtering Logic (in query string)**:
- Date range: `created_at:>={start_date} AND created_at:<={end_date}`
- Additional filtering (LOCAL tag, fulfillment status) done in post-processing

#### 2. Fetch Locations Query

**Query Name**: `GetLocations`

**Purpose**: Fetch all fulfillment locations from Shopify with their addresses.

**Query Structure**:
```graphql
query GetLocations($first: Int!) {
  locations(first: $first) {
    edges {
      node {
        id
        name
        address {
          address1
          address2
          city
          province
          country
          zip
          latitude
          longitude
        }
      }
    }
  }
}
```

**Variables**:
- `first`: Maximum number of locations (typically 250, Shopify limit)

**Response Structure**:
- `locations.edges[].node`: Individual location data with address and coordinates

**Usage**:
- Used to populate fulfillment location filter dropdown
- Used to get fulfillment location coordinates for route starting points

#### 3. Fetch Orders by IDs Query

**Query Name**: `GetOrdersByIds`

**Purpose**: Fetch specific orders by their IDs (used for tag cleanup operations).

**Query Structure**:
```graphql
query GetOrdersByIds($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id
      name
      shippingAddress {
        province
      }
    }
  }
}
```

**Variables**:
- `ids`: Array of order IDs (max 250 per query, batch if needed)

**Response Structure**:
- `nodes[]`: Array of order nodes matching the provided IDs

**Batching Strategy**:
- Process IDs in batches of 250 (Shopify limit)
- Combine results from all batches

### GraphQL Mutations

#### 1. Add Tags Mutation

**Mutation Name**: `tagsAdd`

**Purpose**: Add route tags to orders in Shopify.

**Mutation Structure**:
```graphql
mutation tagsAdd($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    node {
      id
      ... on Order {
        tags
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

**Variables**:
- `id`: Order ID (Global ID format, e.g., `gid://shopify/Order/123456`)
- `tags`: Array of tag strings to add (e.g., `["ld_rota-01"]`)

**Response Structure**:
- `tagsAdd.node`: Updated order node with new tags
- `tagsAdd.userErrors[]`: Array of errors if mutation failed

**Tag Format**:
- Route tags use format: `ld_rota-XX` where XX is zero-padded route number (e.g., `ld_rota-01`, `ld_rota-02`)
- Tags are added to existing order tags (not replaced)

**Error Handling**:
- Check `userErrors` array for validation errors
- Display error messages to user if mutation fails
- Continue processing remaining orders even if some fail

**Rate Limiting**:
- Process orders sequentially with small delays (0.1 seconds) between requests
- Shopify API limit: 40 requests/second

#### 2. Remove Tags Mutation

**Mutation Name**: `tagsRemove`

**Purpose**: Remove route tags from orders in Shopify (used for tag cleanup).

**Mutation Structure**:
```graphql
mutation tagsRemove($id: ID!, $tags: [String!]!) {
  tagsRemove(id: $id, tags: $tags) {
    node {
      id
      ... on Order {
        tags
      }
    }
    userErrors {
      field
      message
    }
  }
}
```

**Variables**:
- `id`: Order ID (Global ID format)
- `tags`: Array of tag strings to remove (e.g., `["ld_rota-01"]`)

**Response Structure**:
- `tagsRemove.node`: Updated order node with tags removed
- `tagsRemove.userErrors[]`: Array of errors if mutation failed

**Usage**:
- Used by "Clear tags" functionality to remove route assignments
- Can remove multiple tags in single mutation

---

## Data Processing & Filtering

### Order Filtering Criteria

Orders must meet **all** of the following criteria to be included:

1. **LOCAL Tag Requirement**
   - Order must have `LOCAL` tag (case-insensitive)
   - Checked in order's `tags` array

2. **Fulfillment Status Filter**
   - Orders with status `FULFILLED` are excluded
   - Exception: Fulfilled orders with `ld_devolucao` or `ld_reentrega` tags are included
   - All other fulfillment statuses are included

3. **Cancellation Filter**
   - Order must not be cancelled (`cancelledAt` is null)
   - Financial status must not be `VOIDED` or `REFUNDED`

4. **Province Mapping**
   - Shipping province must map to a fulfillment location
   - Province-to-location mapping is configurable
   - Example mapping:
     - `Ceará` / `CE` → `Iguatemi Fortaleza`
     - `Pernambuco` / `PE` → `Shopping Recife`
     - `Rio de Janeiro` / `RJ` → `RioSul`
     - `São Paulo` / `SP` → `Shops Jardins`

5. **Coordinates Requirement**
   - Order must have valid latitude and longitude
   - Coordinates can come from:
     - Shopify order data (`shippingAddress.latitude` / `shippingAddress.longitude`)
     - Geocoding service (if coordinates missing from Shopify)

6. **Date Range Filter**
   - Order created date must be between start date and today
   - Date comparison uses order's `createdAt` field

7. **Fulfillment Location Filter** (if not "All fulfillment locations")
   - Order's mapped fulfillment location must match selected filter
   - Mapping based on shipping province

### Pre-sale Order Filtering

**Pre-sale Tag Recognition**:
- Any tag starting with `pre-venda` or `pré-venda` (case-insensitive)
- Pre-sale orders are filtered out by default

**User Selection Process**:
1. System detects pre-sale tags in loaded orders
2. System displays multiselect with all unique pre-sale tags
3. User selects which pre-sale tags to include
4. User clicks "Confirm" button
5. System filters orders to include only selected pre-sale tags

**Default Behavior**:
- If no pre-sale tags detected: All orders processed normally
- If pre-sale tags detected: User must select tags and confirm before orders are displayed

### Geocoding Strategy

**Priority Order**:
1. **Shopify Coordinates** (Primary)
   - Use `shippingAddress.latitude` and `shippingAddress.longitude` if available
   - Check `coordinatesValidated` flag (if true, coordinates are verified)

2. **Geocoding Service** (Fallback)
   - If coordinates missing from Shopify, use geocoding service
   - Combine address fields: `address1`, `address2`, `city`, `province`, `country`, `zip`
   - Query geocoding service with full address string
   - Extract latitude and longitude from geocoding response

3. **Coordinate Validation**
   - Validate coordinates are within valid ranges:
     - Latitude: -90 to 90
     - Longitude: -180 to 180
   - Reject orders with invalid coordinates

**Caching Strategy**:
- Cache geocoding results to avoid redundant API calls
- Cache key: Combination of address fields
- Cache duration: Permanent (until system restart)

---

## User Actions & System Responses

### 1. Configuration Actions

#### Action: Select Fulfillment Location Filter

**User Action**:
- Selects fulfillment location from dropdown
- Options: "All fulfillment locations" or specific location names

**System Response**:
- Stores selection in session state
- Clears existing order data (forces reload)
- Updates applied filters display

**Shopify API Impact**: None (filtering done in post-processing)

#### Action: Set Start Date

**User Action**:
- Selects start date from date picker
- Date range: Start date to today

**System Response**:
- Stores selection in session state
- Clears existing order data (forces reload)
- Updates applied filters display

**Shopify API Impact**: Used in GraphQL query filter (`created_at:>={start_date}`)

#### Action: View Applied Filters

**User Action**:
- Expands "Applied filters" section

**System Response**:
- Displays all active filter criteria:
  - Tag filter: "tagged with: LOCAL"
  - Fulfillment status: "All except FULFILLED"
  - Date range: "{start_date} to today"
  - Pre-sale tags: Selected tags or "Exclude all pre-sale tags"

**Shopify API Impact**: None

### 2. Order Loading Actions

#### Action: Click "Load orders" Button

**User Action**:
- Clicks "Load orders" button

**System Actions** (in sequence):

1. **Build Query Filters**
   - Constructs date range filter: `created_at:>={start_date} AND created_at:<={today}`
   - Prepares pagination variables

2. **Fetch Orders from Shopify**
   - Executes `GetOrdersWithCoordinates` query with pagination
   - Fetches all pages until `hasNextPage` is false
   - Combines all pages into single order list

3. **Process and Filter Orders**
   - Filters orders by LOCAL tag requirement
   - Filters by fulfillment status (exclude FULFILLED, except delivery issues)
   - Filters by cancellation status
   - Maps provinces to fulfillment locations
   - Filters by fulfillment location (if specified)
   - Filters by date range (already done in query, but validated)

4. **Geocode Addresses** (for orders without coordinates)
   - For each order missing coordinates:
     - Constructs full address string
     - Queries geocoding service
     - Caches result
     - Extracts latitude/longitude
   - Rejects orders with invalid coordinates after geocoding

5. **Process Order Data**
   - Extracts route tags from existing tags (`ld_rota-XX`, `rota-XX`, `rota#XX` formats)
   - Formats customer names (removes prepositions, uses initials)
   - Validates address formats
   - Identifies delivery issues (returns, re-deliveries)
   - Calculates shipping charges
   - Categorizes by due date (today vs. tomorrow)

6. **Store Orders**
   - Stores processed orders in session state
   - Stores future-dated orders separately (if any)

7. **Handle Pre-sale Orders** (if detected)
   - Extracts unique pre-sale tags
   - Displays multiselect for user selection
   - Waits for user confirmation before displaying orders

8. **Display Results**
   - If orders found: Display orders in UI and map
   - If no orders: Display warning message with troubleshooting tips

**Shopify API Calls**:
- Multiple `GetOrdersWithCoordinates` queries (paginated)
- Rate limiting: Sequential requests with pagination

**Error Handling**:
- If API error: Display error message with details
- If no orders found: Display warning with filter criteria
- If geocoding fails: Reject order (don't crash system)

### 3. Pre-sale Order Actions

#### Action: Select Pre-sale Tags

**User Action**:
- Selects tags from multiselect dropdown
- Can select multiple tags or none

**System Response**:
- Stores selected tags in session state
- Updates applied filters display

**Shopify API Impact**: None

#### Action: Click "Confirm" Button

**User Action**:
- Clicks "Confirm" button after selecting pre-sale tags

**System Response**:
- Filters orders to include only selected pre-sale tags
- Sets confirmation flag in session state
- Refreshes UI to display filtered orders

**Shopify API Impact**: None (filtering done locally)

### 4. Route Planning Actions

#### Action: Select Orders via Checkboxes

**User Action**:
- Checks/unchecks order checkboxes in order list
- Can select multiple orders

**System Response**:
- Stores selected order IDs in session state
- Updates map visualization (selected orders shown in red)
- Enables route assignment controls

**Shopify API Impact**: None

#### Action: Click "Select All" Button

**User Action**:
- Clicks "Select All" button in "Orders due today" section

**System Response**:
- Adds all "Orders due today" order IDs to selection set
- Updates all checkboxes to checked state
- Updates map visualization

**Shopify API Impact**: None

#### Action: Click "Deselect All" Button

**User Action**:
- Clicks "Deselect All" button in "Orders due today" section

**System Response**:
- Removes all "Orders due today" order IDs from selection set
- Updates all checkboxes to unchecked state
- Updates map visualization

**Shopify API Impact**: None

#### Action: Select Route from Dropdown

**User Action**:
- Selects route from "Assign orders to:" dropdown
- Options: "Select a route", "Rota #01", "Rota #02", etc.

**System Response** (if route selected, not "Select a route"):

1. **Sync Checkbox States**
   - Syncs checkbox states to selected orders set
   - Updates map to show selected orders in red

2. **Calculate Route**
   - Gets fulfillment location coordinates (route starting point)
   - Gets selected orders' coordinates
   - Applies nearest-neighbor algorithm to optimize sequence
   - Calculates route segments between consecutive stops

3. **Fetch Driving Routes** (for each segment)
   - For each segment in optimized sequence:
     - Queries OSRM API for driving routes
     - Requests up to 3 alternative routes
     - Returns route coordinates (GeoJSON format)
   - Falls back to straight line if OSRM unavailable

4. **Render Route on Map**
   - Displays primary route as thick solid line
   - Displays alternative routes as thin dashed lines
   - Colors route line to match route assignment color
   - Shows route starting point (fulfillment location)
   - Shows route stops (selected orders)

**Shopify API Impact**: None (route calculation is local)

#### Action: Click "Assign Orders" Button

**User Action**:
- Clicks "Assign Orders" button after selecting orders and route

**System Actions** (in sequence):

1. **Validate Selection**
   - Checks that orders are selected
   - Checks that route is selected
   - If invalid: Display warning, stop process

2. **Prepare Tag Updates**
   - Constructs route tag: `ld_rota-XX` (where XX is route number, zero-padded)
   - Prepares list of order IDs to update

3. **Update Shopify Tags** (for each order)
   - Executes `tagsAdd` mutation for each order
   - Uses order's Global ID format
   - Adds route tag to order's existing tags
   - Includes 0.1 second delay between requests (rate limiting)
   - Tracks success/failure for each order

4. **Update Local Data**
   - Updates order data in session state with route tag
   - Updates route assignment in route data structure
   - Adds order to route's order list

5. **Update Tag History**
   - Adds order ID and route tag to persistent tag history
   - Tag history stored in local file system

6. **Refresh Display**
   - Clears selected orders set
   - Refreshes order list (shows route assignments)
   - Refreshes map (shows route colors on markers)
   - Updates route statistics
   - Displays success/error messages

**Shopify API Calls**:
- Multiple `tagsAdd` mutations (one per order)
- Rate limiting: 0.1 second delay between requests
- Error handling: Continue processing even if some fail

**Success/Error Display**:
- Success message: "Successfully updated tags for X order(s) in Shopify"
- Error message: "Failed to update X order(s). Route assignment saved locally."
- If all fail: "Could not update Shopify tags, but route assignment has been saved locally."

### 5. Route Management Actions

#### Action: View Route Statistics

**User Action**:
- Views "Committed routes" section

**System Response**:
- Displays all routes with assigned orders
- For each route shows:
  - Route name (e.g., "Rota #01")
  - Order count
  - Total shipping charges (sum of all order shipping charges)
  - Color-coded border matching route color
- Format: "Rota #01 (4 orders; R$69,50)"

**Shopify API Impact**: None

#### Action: Click "Clear tags" Button

**User Action**:
- Clicks "Clear tags" button

**System Actions** (in sequence):

1. **Load Tag History**
   - Loads tag history from local file
   - Filters by fulfillment location (if specified)

2. **Fetch Order Data** (if filtering by location)
   - Fetches orders by IDs to check fulfillment locations
   - Uses `GetOrdersByIds` query (batched)

3. **Remove Tags from Shopify** (for each order)
   - Executes `tagsRemove` mutation for each order
   - Removes all `ld_rota-XX` tags from order
   - Includes 0.1 second delay between requests
   - Tracks success/failure

4. **Update Tag History**
   - Removes successfully cleaned orders from history
   - Saves updated history to file

5. **Display Results**
   - Success message: "Removed local delivery tags from X order(s)"
   - Error message: "Failed to remove tags from X order(s)"

**Shopify API Calls**:
- `GetOrdersByIds` query (if filtering by location)
- Multiple `tagsRemove` mutations (one per order)
- Rate limiting: 0.1 second delay between requests

---

## Route Management

### Route Initialization

**System Action**: On system start/initialization

**Behavior**:
- Pre-initializes routes "Rota #01" through "Rota #10"
- Each route has:
  - Route ID: `route_01`, `route_02`, etc.
  - Route name: `rota-01`, `rota-02`, etc.
  - Order list: Empty array
- Stores routes in session state
- Sets next route number to 11 (for dynamic creation)

**Shopify API Impact**: None

### Route Tag Format

**Format**: `ld_rota-XX` where XX is zero-padded route number

**Examples**:
- Route 1: `ld_rota-01`
- Route 2: `ld_rota-02`
- Route 10: `ld_rota-10`
- Route 15: `ld_rota-15`

**Tag Recognition**:
- System recognizes multiple tag formats:
  - `ld_rota-XX` (preferred format, saved to Shopify)
  - `rota-XX` (legacy format, converted internally)
  - `rota#XX` (alternative format, converted internally)

### Route Colors

**Predefined Colors** (Routes 1-5):
- Rota #01: Blue (#1E90FF)
- Rota #02: Green (#4CAF50)
- Rota #03: Golden (#FFD700)
- Rota #04: Fuchsia (#FF00FF)
- Rota #05: Brown (#8B4513)

**Dynamic Colors** (Routes 6+):
- Rotating color palette:
  - Orange, Purple, Teal, Deep Pink, Lime Green, Dark Orange, Medium Purple, Light Sea Green
- Colors cycle based on route number

**Usage**:
- Map markers colored by route assignment
- Route lines colored to match route
- Route statistics display colored borders

### Route Persistence

**Tag History Storage**:
- Tag history stored in local file system
- Format: JSON file with order IDs as keys, route tags as values
- File location: `data/local_delivery/ld_tags_history.json`

**Persistence Behavior**:
- Route assignments saved to Shopify as tags
- Tag history maintained locally for cleanup operations
- Route assignments persist across system sessions (via Shopify tags)
- On order load: System reads route tags from Shopify and displays routes

---

## Route Optimization

### Nearest-Neighbor Algorithm

**Purpose**: Optimize delivery sequence to minimize total distance

**Algorithm Steps**:

1. **Initialize**
   - Start with fulfillment location as starting point
   - Create list of unvisited orders (selected orders)
   - Create empty sequence list

2. **Iteration**
   - For each iteration:
     - Calculate distance from current location to all unvisited orders
     - Select nearest unvisited order
     - Add to sequence
     - Remove from unvisited list
     - Set as new current location

3. **Termination**
   - Repeat until all orders visited
   - Return optimized sequence

**Distance Calculation**:
- Uses Haversine formula for great-circle distance
- Calculates distance in meters
- Accounts for Earth's curvature

**Input**:
- Starting point: Fulfillment location coordinates
- Stops: Selected orders' coordinates

**Output**:
- Optimized sequence: List of orders in optimal visit order

### Driving Route Calculation

**Service**: OSRM (Open Source Routing Machine) API

**Purpose**: Get actual driving routes between consecutive stops

**API Endpoint**: `http://router.project-osrm.org/route/v1/driving/{coordinates}?overview=full&geometries=geojson&alternatives=true`

**Request Format**:
- Coordinates: `{lon1},{lat1};{lon2},{lat2}` (semicolon-separated)
- Parameters:
  - `overview=full`: Return full route geometry
  - `geometries=geojson`: Return coordinates in GeoJSON format
  - `alternatives=true`: Return multiple route options

**Response Format**:
- GeoJSON LineString geometry
- Multiple routes if alternatives available (up to 3)

**Processing**:
- Extract coordinates from GeoJSON geometry
- Convert from `[lon, lat]` to `[lat, lon]` format
- Return up to 3 alternative routes per segment

**Fallback**:
- If OSRM API unavailable: Use straight line between points
- If error occurs: Use straight line for that segment

**Route Visualization**:
- Primary route: Thick solid line
- Alternative routes: Thin dashed lines
- All routes same color (matching route assignment)

---

## Address Validation

### Validation Rules

**Purpose**: Detect common address format issues before delivery

**Validation Patterns**:

1. **Apartment Keywords in Address1**
   - Detects apartment/suite keywords appearing before street number in address line 1
   - Keywords: `Apt`, `Apto`, `Apartamento`, `Suite`, `Suíte`, `Bloco`, `Bl`, `Casa`, `Sala`, `Andar`, `Floor`
   - Issue: Apartment info should be in address line 2, not line 1

2. **Duplicate Numbers**
   - Detects when same number appears in both address1 and address2
   - Issue: Likely apartment number duplication

**Validation Process**:
- Runs automatically during order processing
- Checks each order's address1 and address2 fields
- Stores validation results in order data

**Validation Result Structure**:
```
{
  "is_valid": boolean,
  "issue_type": "apartment_in_address1" | "duplicate_number" | null,
  "suggested_address1": string,
  "suggested_address2": string
}
```

**Display**:
- Invalid addresses marked with red dot (🔴) in order list
- Validation details stored but not displayed in UI
- Manual correction required (system flags but doesn't auto-correct)

---

## Order Organization

### Due Date Categorization

**Purpose**: Organize orders by urgency (today vs. tomorrow)

**Categorization Rules**:

1. **Orders due today**:
   - Orders assigned to routes (regardless of creation date)
   - Unassigned orders created yesterday or earlier

2. **Orders due tomorrow**:
   - Unassigned orders created today (using GMT-3 timezone)
   - Displayed with clock emoji (🕐) on map

3. **Future-dated orders**:
   - Orders with date tags in DD/MM/YYYY format
   - Displayed in separate section (not selectable)
   - Shown below "Orders due tomorrow"

**Timezone Handling**:
- Uses GMT-3 (Brasília time) for date calculations
- Compares order creation date to current date in GMT-3

**Display**:
- "Orders due today" section: Shows today's orders
- "Orders due tomorrow" section: Shows tomorrow's orders
- Future-dated orders: Simple list (no checkboxes)

---

## Delivery Issue Tracking

### Delivery Issue Tags

**Tags**:
- `ld_devolucao`: Return order
- `ld_reentrega`: Re-delivery order

### Order Filtering

**Fulfilled Orders Exception**:
- Normally, fulfilled orders are excluded
- Exception: Fulfilled orders with `ld_devolucao` tag are included
- Exception: Fulfilled orders with `ld_reentrega` tag are included (if not yet delivered)

### Order Markers

**Emoji Indicators**:
- Regular order (not fulfilled, no delivery issues): 📦 (shown on map only)
- Re-delivery (not fulfilled, has `ld_reentrega`): 🔄
- Both tags (not fulfilled, has both): 🔄↩️
- Return (fulfilled, has `ld_devolucao`): ↩️

**Display**:
- Emojis shown on map markers
- Emojis shown in order list (except regular orders)
- Order number displayed below emoji on map

### Tag Removal

**Automatic Removal**:
- System automatically removes `ld_reentrega` tag from delivered orders
- Runs during order processing phase
- Uses `tagsRemove` mutation

---

## Fulfillment Location Mapping

### Province-to-Location Mapping

**Purpose**: Map shipping provinces to fulfillment locations

**Mapping Table**:
- `Ceará` / `CE` → `Iguatemi Fortaleza`
- `Pernambuco` / `PE` → `Shopping Recife`
- `Rio de Janeiro` / `RJ` → `RioSul`
- `São Paulo` / `SP` → `Shops Jardins`

**Mapping Process**:
- Extract province from order's shipping address
- Look up province in mapping table
- Assign fulfillment location to order
- Use fulfillment location for filtering and route starting points

**Route Starting Points**:
- Routes start from fulfillment location coordinates
- Fulfillment location coordinates fetched from Shopify locations
- If location not found in Shopify: Use hardcoded coordinates (if available)

---

## Financial Tracking

### Shipping Charge Calculation

**Purpose**: Track total shipping charges per route

**Data Source**:
- Shipping charges from order's `shippingLine.originalPriceSet.shopMoney.amount`
- Currency from `shippingLine.originalPriceSet.shopMoney.currencyCode`

**Calculation**:
- Sum all shipping charges for orders assigned to route
- Preserve currency (assumes all orders same currency)

**Display Format**:
- "Rota #01 (4 orders; R$69,50)"
- Shows order count and total shipping charges

**Usage**:
- Displayed in route statistics section
- Helps with route profitability analysis

---

## Map Visualization

### Order Markers

**Marker Types**:
- Regular orders: Grey markers (unassigned, not selected)
- Route-assigned orders: Colored markers (matching route color)
- Selected orders: Red markers (regardless of route assignment)
- Priority: Selected (red) > Route color > Grey

**Marker Information**:
- Emoji indicator (for delivery issues)
- Order number (below emoji)
- Click behavior: Selects/deselects order

### Fulfillment Locations

**Display**:
- Shown with astronaut emoji (👨‍🚀)
- Shows location name and address
- Used as route starting points on map

### Route Visualization

**Trigger**:
- Automatic when orders selected and route chosen
- No manual "render route" button

**Display Elements**:
- Primary route: Thick solid line through all selected orders
- Alternative routes: Thin dashed lines (up to 3 per segment)
- Route color: Matches route assignment color
- Starting point: Fulfillment location marker
- Stops: Selected order markers

**Route Sequence**:
- Optimized using nearest-neighbor algorithm
- Starts from fulfillment location
- Visits all selected orders in optimized order
- Ends at last order

---

## Data Persistence

### Session State

**Storage Location**: In-memory session state (cleared on session end)

**Stored Data**:
- `delivery_orders_data`: Processed order list
- `selected_orders`: Set of selected order IDs
- `delivery_routes`: Route data structure
- `fulfillment_location_filter`: Selected location filter
- `delivery_start_date`: Selected start date
- `selected_presale_tags`: Selected pre-sale tags
- `presale_tags_confirmed`: Pre-sale confirmation flag
- Map state (center, zoom level)

**Persistence**: Temporary (lost on session end)

### Tag History

**Storage Location**: Local file system

**File Path**: `data/local_delivery/ld_tags_history.json`

**Format**:
```json
{
  "gid://shopify/Order/123456": ["ld_rota-01"],
  "gid://shopify/Order/789012": ["ld_rota-02"]
}
```

**Purpose**:
- Track which orders have route tags
- Enable tag cleanup operations
- Filter by fulfillment location during cleanup

**Operations**:
- Add: When orders assigned to routes
- Remove: When tags cleared
- Load: On cleanup operations

### Shopify Tags

**Storage Location**: Shopify order tags

**Format**: `ld_rota-XX` tags on orders

**Purpose**:
- Persistent route assignment storage
- Survives system restarts
- Accessible from Shopify admin

**Operations**:
- Add: Via `tagsAdd` mutation
- Remove: Via `tagsRemove` mutation
- Read: From order's `tags` field in GraphQL query

---

## Error Handling

### API Errors

**Shopify API Errors**:
- Display error message to user
- Show error details in expandable section
- Continue processing other operations if possible
- Don't crash system

**Geocoding Errors**:
- Reject order (don't include in results)
- Continue processing other orders
- Log error for debugging

**OSRM API Errors**:
- Fall back to straight line route
- Continue rendering map
- Don't block route assignment

### Validation Errors

**Address Validation**:
- Flag invalid addresses
- Don't reject orders
- Allow manual correction

**Order Filtering**:
- If no orders match filters: Display warning with filter criteria
- Suggest troubleshooting steps
- Don't crash system

### User Input Errors

**Missing Selections**:
- Validate before processing
- Display clear error messages
- Prevent invalid operations

**Invalid Dates**:
- Validate date ranges
- Prevent future end dates
- Default to reasonable ranges

---

## Performance Considerations

### API Rate Limiting

**Shopify API**:
- Limit: 40 requests/second
- Strategy: Sequential requests with 0.1 second delays
- Batch operations: Process orders one at a time

**OSRM API**:
- Public instance (no authentication)
- No strict rate limit
- May have usage restrictions

**Geocoding Service**:
- Depends on service provider
- Cache results to minimize calls

### Caching Strategies

**Geocoding Cache**:
- Cache results permanently (until restart)
- Cache key: Address string
- Avoid redundant API calls

**Shopify Data Cache**:
- Cache order data in session state
- Clear cache on filter changes
- Refresh on explicit "Load orders" action

### Memory Management

**Order Display Limits**:
- Order list: Limited to 50 orders for performance
- Map: Shows all orders (no limit)
- Pagination: Not implemented in UI (all orders loaded)

**Route Data**:
- Routes stored in session state
- Limited to active routes (not archived)
- Clear on session end

---

## System Integration Points

### External Services

1. **Shopify Admin GraphQL API**
   - Order data source
   - Tag updates destination
   - Location data source

2. **Geocoding Service**
   - Address to coordinates conversion
   - Fallback when Shopify coordinates missing

3. **OSRM API**
   - Driving route calculation
   - Route optimization visualization

### Data Flow

**Order Loading**:
Shopify API → Filter & Process → Geocode (if needed) → Store in Session → Display in UI

**Route Assignment**:
User Selection → Calculate Route → OSRM API (optional) → Update Shopify Tags → Update Session → Refresh UI

**Tag Cleanup**:
Load History → Fetch Orders (if filtering) → Remove Tags from Shopify → Update History → Refresh UI

---

## User Interface Components

### Filter Controls

**Components**:
- Fulfillment location dropdown
- Start date picker
- Applied filters expander

**Layout**: Top section, left column

### Action Buttons

**Buttons**:
- "Clear tags" button (secondary)
- "Load orders" button (primary)

**Layout**: Side by side, equal width

### Order Selection Interface

**Components**:
- Order checkboxes (two columns)
- "Select All" / "Deselect All" buttons
- Route selection dropdown
- "Assign Orders" button

**Sections**:
- "Orders due today"
- "Orders due tomorrow"
- "Orders scheduled for future dates" (read-only)

**Layout**: Left column, full width

### Map Visualization

**Components**:
- Interactive map
- Order markers
- Route lines
- Fulfillment location markers

**Layout**: Right column, 2/3 width

### Route Statistics

**Components**:
- Route cards with:
  - Route name
  - Order count
  - Total shipping charges
  - Color-coded border

**Layout**: Below order selection, full width

### Order Table

**Components**:
- Data table with columns:
  - Order Number
  - Date
  - Customer
  - Shipping Address
  - Route (if assigned)

**Layout**: Below map, full width

---

## Workflow Summary

### Complete User Journey

1. **Initial Setup**
   - User opens system
   - System initializes routes (Rota #01-10)
   - System loads available fulfillment locations from Shopify

2. **Configure Filters**
   - User selects fulfillment location (or "All")
   - User sets start date
   - System displays applied filters

3. **Load Orders**
   - User clicks "Load orders"
   - System fetches orders from Shopify (paginated)
   - System filters orders (LOCAL tag, fulfillment status, dates, province mapping)
   - System geocodes addresses (if needed)
   - System processes order data
   - If pre-sale orders detected: System shows multiselect, user selects tags, user confirms
   - System displays orders in UI and map

4. **Plan Routes**
   - User views orders on map
   - User selects orders via checkboxes
   - User selects route from dropdown
   - System calculates and displays optimized route
   - User reviews route on map
   - User clicks "Assign Orders"
   - System updates Shopify tags (for each order)
   - System updates local data
   - System refreshes display

5. **Review Results**
   - User views route statistics
   - User views order table
   - User can assign more orders or clear tags if needed

### System Operations Summary

**On Order Load**:
- Fetch orders (Shopify API)
- Filter orders (local processing)
- Geocode addresses (external service)
- Process data (local processing)
- Display results (UI update)

**On Route Assignment**:
- Validate selection (local)
- Calculate route (local + OSRM API)
- Update tags (Shopify API)
- Update local data (session state)
- Refresh display (UI update)

**On Tag Cleanup**:
- Load history (local file)
- Fetch orders (Shopify API, if filtering)
- Remove tags (Shopify API)
- Update history (local file)
- Refresh display (UI update)

---

## Implementation Notes for Developers

### Key Design Decisions

1. **Tag-Based Route Assignment**
   - Routes stored as Shopify tags (not separate entity)
   - Enables persistence across sessions
   - Accessible from Shopify admin
   - Simple to implement and maintain

2. **Post-Processing Filtering**
   - Some filters applied after fetching (fulfillment location, pre-sale tags)
   - Shopify GraphQL query filters limited to date range
   - Allows more flexible filtering logic

3. **Optimistic Route Rendering**
   - Routes calculated and displayed before assignment
   - User can review route before committing
   - Improves user experience

4. **Session-Based State Management**
   - Orders stored in session state (not database)
   - Requires reload on filter changes
   - Simple architecture, no database needed

5. **Tag History for Cleanup**
   - Local file tracks tag assignments
   - Enables efficient cleanup operations
   - Prevents unnecessary API calls

### Recommended Implementation Approach

1. **Start with Core Functionality**
   - Order fetching and filtering
   - Basic route assignment
   - Tag updates

2. **Add Visualization**
   - Map display
   - Route rendering
   - Order markers

3. **Enhance with Optimization**
   - Route optimization algorithm
   - Driving route calculation
   - Alternative routes

4. **Add Advanced Features**
   - Address validation
   - Pre-sale filtering
   - Delivery issue tracking
   - Financial tracking

### Technology Agnostic Considerations

- **UI Framework**: Any web framework (React, Vue, Angular, etc.)
- **Map Library**: Any mapping library (Leaflet, Google Maps, Mapbox, etc.)
- **API Client**: Any HTTP client with GraphQL support
- **State Management**: Any state management solution (Redux, Vuex, Context API, etc.)
- **Routing Service**: Any routing API (OSRM, Google Directions, Mapbox Directions, etc.)
- **Geocoding Service**: Any geocoding API (Google Maps, Nominatim, etc.)

### Data Structures

**Order Data Structure** (processed order):
```
{
  order_id: string (Global ID),
  order_name: string,
  customer_name: string (formatted),
  address: string,
  address2: string,
  city: string,
  province: string,
  country: string,
  zip: string,
  latitude: number,
  longitude: number,
  route_tag: string (e.g., "rota-01"),
  tags: string[],
  shipping_charge: number,
  currency: string,
  created_at: string (ISO format),
  fulfillment_status: string,
  is_fulfilled: boolean,
  has_devolucao: boolean,
  has_reentrega: boolean,
  address_validation: {
    is_valid: boolean,
    issue_type: string | null
  }
}
```

**Route Data Structure**:
```
{
  route_id: string (e.g., "route_01"),
  route_name: string (e.g., "rota-01"),
  order_ids: string[],
  color: string (hex code)
}
```

---

## Conclusion

This functional specification provides a complete description of the Local Delivery route planning and order management system. It details all Shopify API interactions, user actions, system behaviors, and data flows without reference to specific implementation technologies. Developers can use this document to build the system using any technology stack while maintaining the same functionality and user experience.
