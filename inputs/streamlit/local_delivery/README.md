# Local Delivery - Route Planning & Order Management

A comprehensive route planning and order management system for Shopify local delivery orders with interactive map visualization, automatic route optimization, and address validation.

---

## What Does It Do?

Local Delivery is a route planning and order management tool that helps merchants efficiently organize and assign local delivery orders to delivery routes. The system:

- **Interactive Map Visualization**: Displays all orders on an interactive map with color-coded markers for routes, selection status, and delivery issues
- **Route Assignment**: Assign orders to predefined routes (Rota #01 through Rota #10+) with automatic Shopify tag synchronization
- **Route Optimization**: Automatically calculates optimized delivery sequences using nearest-neighbor algorithm and displays up to 3 alternative driving routes per segment using OSRM
- **Order Management**: Organizes orders by due date (today vs. tomorrow), filters by fulfillment location and date range, and tracks assignment progress
- **Address Validation**: Detects address format issues (apartment numbers in wrong field, duplicate numbers) and flags them for manual review
- **Shipping Charge Tracking**: Sums and displays total shipping charges per route for financial planning
- **Pre-sale Order Handling**: Filters and manages pre-sale orders separately with user-selectable tag inclusion
- **Delivery Issue Tracking**: Identifies and highlights orders with return (`ld_devolucao`) and re-delivery (`ld_reentrega`) tags
- **Fulfillment Location Mapping**: Automatically maps orders to fulfillment locations based on shipping province

**Key Deliverables**:
- Visual route planning with interactive map
- Optimized delivery sequences for each route
- Automatic Shopify tag updates (`ld_rota-XX` format)
- Route summaries with order counts and shipping charges
- Address validation flags for quality control
- Persistent route assignments across sessions

---

## How Does It Do It?

### Architecture

The system is built with a **single-module architecture** centered around the `DeliveryAddressMapper` class, with support for future subsystem expansion:

- **Main Module** (`_local_delivery.py`): Core route planning and order management
- **Delivery Issues** (`delivery_issues.py`): Special handling for return and re-delivery orders
- **Fulfillment Optimizer** (`fulfillment_optimizer/`): Advanced route optimization (future expansion)

### Data Loading & Filtering

1. **Shopify API Integration**: Direct GraphQL API connection with pagination support
   - Fetches orders with shipping addresses, coordinates, and fulfillment status
   - Filters by `LOCAL` tag (required for local delivery orders)
   - Excludes fulfilled orders (except those with delivery issues)
   - Filters by fulfillment location (province-based mapping)
   - Date range filtering (start date to today)

2. **Geocoding Fallback**:
   - **Primary**: Uses coordinates from Shopify when available
   - **Fallback**: Geocoding service (Google Maps or Nominatim) for addresses without coordinates
   - **Cache**: Results cached to avoid redundant API calls

3. **Order Processing**:
   - Validates shipping addresses and coordinates
   - Extracts route tags from existing Shopify tags (`ld_rota-XX`, `rota-XX`, `rota#XX`)
   - Formats customer names (removes Brazilian prepositions, uses initials for middle names)
   - Categorizes orders by due date (today vs. tomorrow)
   - Identifies delivery issues (returns, re-deliveries)

### Route Management

1. **Route Initialization**: 
   - Pre-initializes routes Rota #01 through Rota #10 at session start
   - Supports dynamic route creation (Rota #11+)
   - Routes stored in session state for persistence

2. **Route Assignment**:
   - Users select orders via checkboxes
   - Select target route from dropdown
   - System automatically:
     - Updates Shopify tags (`ld_rota-XX` format)
     - Updates local order data
     - Refreshes map visualization
     - Calculates route statistics

3. **Route Visualization**:
   - **Automatic Rendering**: When orders are selected and a route is chosen, routes are automatically rendered
   - **Optimization**: Uses nearest-neighbor algorithm to create optimal delivery sequence
   - **Driving Routes**: Fetches up to 3 alternative driving routes per segment using OSRM API
   - **Color Coding**: Each route has a unique color (Rota #01-05 have predefined colors, Rota #06+ use rotating palette)
   - **Route Lines**: Primary route shown as thick solid line, alternatives as thin dashed lines

4. **Route Statistics**:
   - Order count per route
   - Total shipping charges per route (summed from individual order charges)
   - Display format: `Rota #01 (4 orders; R$69,50)`

### Address Validation

The system validates address formats to detect common issues:

1. **Apartment Keywords in Address1**: Detects apartment/suite keywords (Apt, Suite, Bloco, etc.) appearing before street number in address line 1
2. **Duplicate Numbers**: Identifies when the same number appears in both address1 and address2 (likely apartment number duplication)

**Validation Results**:
- Invalid addresses flagged with red dot (🔴) indicator in order list
- Validation details stored in order data for review
- Manual correction required (system flags but doesn't auto-correct)

### Order Organization

Orders are automatically organized into two categories:

1. **Orders due today**:
   - Orders assigned to routes (regardless of creation date)
   - Unassigned orders from yesterday or earlier
   - Displayed with normal formatting

2. **Orders due tomorrow**:
   - Unassigned orders created today (using GMT-3 Brasília time)
   - Displayed with clock emoji (🕐) on map
   - Shown in separate section below "Orders due today"

### Map Visualization

1. **Order Markers**:
   - Color-coded by route assignment, selection status, or assigned color
   - Priority: Today's orders (grey) > Route color > Selected (red) > Assigned color
   - Emoji indicators for delivery issues (🔄 for reentrega, ↩️ for devolucao)
   - Order number displayed below emoji

2. **Fulfillment Locations**:
   - Displayed with astronaut emoji (👨‍🚀)
   - Shows location name and address
   - Used as route starting points

3. **Route Visualization**:
   - Automatic rendering when orders selected and route chosen
   - Single optimized route through all selected orders
   - Multiple alternative routes per segment (up to 3)
   - Color matches route assignment

---

## Why Does It Do It? What Is Its Purpose?

Local Delivery serves several critical business purposes:

### 1. **Operational Efficiency**
   - **Purpose**: Streamline the process of organizing local delivery orders into delivery routes
   - **Value**: Reduces manual planning time from hours to minutes, eliminates errors in route assignment
   - **Use Case**: A merchant receives 50 local delivery orders daily and needs to organize them into 5 delivery routes efficiently

### 2. **Route Optimization**
   - **Purpose**: Minimize delivery time and fuel costs by optimizing delivery sequences
   - **Value**: Reduces total driving distance, improves delivery efficiency, lowers operational costs
   - **Use Case**: A merchant wants to ensure delivery drivers follow the most efficient route when visiting 10 addresses in a neighborhood

### 3. **Visual Planning**
   - **Purpose**: Provide visual context for route planning decisions
   - **Value**: Helps identify geographic clusters, understand delivery density, make informed routing decisions
   - **Use Case**: A merchant wants to see all pending deliveries on a map to understand geographic distribution before assigning routes

### 4. **Data Quality & Validation**
   - **Purpose**: Ensure shipping addresses are correctly formatted before delivery
   - **Value**: Reduces delivery failures, prevents packages from being returned, improves customer satisfaction
   - **Use Case**: A merchant notices delivery issues and wants to validate addresses before dispatching drivers

### 5. **Financial Tracking**
   - **Purpose**: Track shipping charges per route for cost analysis
   - **Value**: Enables route profitability analysis, helps optimize pricing strategies
   - **Use Case**: A merchant wants to understand the total shipping revenue per route to evaluate route efficiency

### 6. **Order Prioritization**
   - **Purpose**: Automatically prioritize orders by due date and assignment status
   - **Value**: Ensures urgent orders are handled first, prevents missed deliveries
   - **Use Case**: A merchant needs to distinguish between orders due today (yesterday's orders) and orders due tomorrow (today's orders)

---

## Installation

### 1. Dependencies

Install required Python packages:

```bash
pip install -r requirements.txt
```

Required packages:
- `streamlit`
- `folium`
- `streamlit-folium`
- `pandas`
- `asyncio`
- `apis.shopify` (Shopify GraphQL client)

### 2. Environment Configuration

Create a `.env` file in the project root with your credentials:

```env
SHOPIFY_SHOP_NAME=your-shop-name
SHOPIFY_ACCESS_TOKEN=your-access-token
SHOPIFY_API_VERSION=2024-01

# Optional: Google Maps API key for enhanced geocoding (used by GeocodingService)
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
```

### 3. Shopify App Setup

To use this system, you need a Shopify private app with the following permissions:

**Required Permissions**:
- `read_orders`
- `write_orders` (for tag updates)

**To create a private app**:
1. Go to your Shopify admin dashboard
2. Navigate to Settings > Apps and sales channels
3. Click "Develop apps"
4. Create a new app and configure Admin API scopes
5. Generate API credentials

### 4. Province to Location Mapping

The system uses a hardcoded mapping of Brazilian provinces to fulfillment locations:

```python
PROVINCE_TO_LOCATION_MAP = {
    'Ceará': 'Iguatemi Fortaleza',
    'CE': 'Iguatemi Fortaleza',
    'Pernambuco': 'Shopping Recife',
    'PE': 'Shopping Recife',
    'Rio de Janeiro': 'RioSul',
    'RJ': 'RioSul',
    'São Paulo': 'Shops Jardins',
    'SP': 'Shops Jardins',
}
```

To add new locations, modify the `PROVINCE_TO_LOCATION_MAP` in `_local_delivery.py`.

---

## Usage

### Running the Application

The Local Delivery system is accessed through the main CPG Labs application:

```bash
streamlit run _cpg_labs.py
```

Then navigate to **Local Delivery** in the sidebar menu.

### Application Flow

1. **Configure Filters**:
   - Select **Fulfillment location** (or "All fulfillment locations")
   - Set **Start date** (orders up to today will be included)
   - Review applied filters in the expander

2. **Load Orders**:
   - Click **"🗺️ Load orders"** button
   - System fetches orders from Shopify matching:
     - `LOCAL` tag (required)
     - Non-fulfilled status (or fulfilled with delivery issues)
     - Date range (start date to today)
     - Fulfillment location (if filtered)
   - Orders are geocoded if coordinates are missing

3. **Handle Pre-sale Orders** (if applicable):
   - If pre-sale orders are detected, a multiselect appears
   - Select which pre-sale tags to include
   - Click **"Confirm"** to proceed

4. **Review Orders**:
   - View orders in the left panel, organized by due date
   - Check map visualization in the right panel
   - Review address validation flags (red dots)
   - Check delivery issue indicators (emoji markers)

5. **Assign Orders to Routes**:
   - Select orders using checkboxes (or use "Select All" / "Deselect All")
   - Choose target route from **"Assign orders to:"** dropdown
   - Routes automatically render on map when selected
   - Click **"✅ Assign Orders"** to save assignment
   - System updates Shopify tags and refreshes display

6. **Review Route Statistics**:
   - View committed routes section below assignment controls
   - See order count and total shipping charges per route
   - Routes displayed with color-coded borders matching map markers

### Using Route Visualization

When orders are selected and a route is chosen:

1. **Automatic Route Calculation**:
   - System optimizes delivery sequence using nearest-neighbor algorithm
   - Creates single route starting from fulfillment location
   - Visits all selected orders in optimized sequence

2. **Alternative Routes**:
   - System fetches up to 3 alternative driving routes per segment
   - Primary route shown as thick solid line
   - Alternative routes shown as thin dashed lines
   - All routes use the same color (matching route assignment)

3. **Route Review**:
   - Review route on map before assigning
   - Check if route makes geographic sense
   - Adjust order selection if needed

### Using Address Validation

Address validation runs automatically during order processing:

1. **Validation Flags**:
   - Orders with invalid addresses show red dot (🔴) in order list
   - Validation details stored but not displayed in UI
   - Manual review and correction required

2. **Common Issues Detected**:
   - Apartment keywords in address line 1 (should be in line 2)
   - Duplicate numbers in both address lines (apartment number duplication)

3. **Correction Process**:
   - Review flagged orders manually
   - Correct addresses in Shopify admin
   - Reload orders to verify corrections

### Managing Routes

**Route Assignment**:
- Routes Rota #01 through Rota #10 are pre-initialized
- Additional routes (Rota #11+) can be created dynamically
- Each route can contain unlimited orders

**Route Colors**:
- Rota #01: Blue (#1E90FF)
- Rota #02: Green (#4CAF50)
- Rota #03: Golden (#FFD700)
- Rota #04: Fuchsia (#FF00FF)
- Rota #05: Brown (#8B4513)
- Rota #06+: Rotating colors (orange, purple, teal, etc.)

**Route Persistence**:
- Route assignments saved to Shopify as `ld_rota-XX` tags
- Assignments persist across sessions
- Unfulfilled orders with route tags are automatically loaded with route colors

### Clearing Route Tags

To remove route tags from orders:

1. Select **Fulfillment location** filter (or "All fulfillment locations")
2. Click **"🧹 Clear tags"** button
3. System removes `ld_rota-XX` tags from orders in history
4. Tags removed from Shopify and local data

---

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SHOPIFY_SHOP_NAME` | Your Shopify shop name (without .myshopify.com) | Yes |
| `SHOPIFY_ACCESS_TOKEN` | Private app access token | Yes |
| `SHOPIFY_API_VERSION` | Shopify API version (default: 2024-01) | No |
| `GOOGLE_MAPS_API_KEY` | Google Maps API key for enhanced geocoding | No (recommended) |

### Data Loading Defaults

When Local Delivery is first accessed:

- **Date Range**: Last 60 days to today
- **Fulfillment Location**: All fulfillment locations
- **Fulfillment Status**: All except FULFILLED (fulfilled orders with delivery issues are included)

### Route Configuration

**Preset Routes**: Rota #01 through Rota #10 are automatically initialized

**Dynamic Routes**: Routes Rota #11+ are created on-demand when needed

**Route Tag Format**: `ld_rota-XX` (saved to Shopify), `rota-XX` (internal use)

### Address Validation Rules

**Apartment Keywords Detected**:
- `Apt`, `Apto`, `Apartamento`, `Apt.`
- `Suite`, `Suíte`
- `Bloco`, `Bl`
- `Casa`, `Sala`, `Andar`, `Floor`

**Validation Logic**:
- Checks if apartment keyword appears before street number in address1
- Checks if same number appears in both address1 and address2

---

## Data Processing

### Order Filtering

Orders must meet all criteria to be included:

1. **LOCAL Tag**: Order must have `LOCAL` tag (case-insensitive)
2. **Fulfillment Status**: Not FULFILLED (unless has `ld_devolucao` or `ld_reentrega` tags)
3. **Not Cancelled**: `cancelledAt` is null and financial status is not VOIDED/REFUNDED
4. **Province Mapping**: Shipping province must map to a fulfillment location
5. **Valid Coordinates**: Must have valid latitude/longitude (from Shopify or geocoding)
6. **Date Range**: Created between start date and today
7. **Fulfillment Location**: Matches selected filter (if not "All fulfillment locations")

### Geocoding Strategy

1. **Shopify Coordinates**: Uses coordinates from `shippingAddress.latitude/longitude` if available
2. **Geocoding Service**: Falls back to GeocodingService (Google Maps or Nominatim) if coordinates missing
3. **Cache**: Geocoding results cached to avoid redundant API calls

### Route Optimization Algorithm

**Nearest-Neighbor Algorithm**:
1. Start from fulfillment location
2. Find nearest unvisited order
3. Add to route sequence
4. Repeat until all orders visited
5. Returns optimized sequence

**OSRM Route Calculation**:
- Fetches up to 3 alternative driving routes per segment
- Uses OSRM public API (`http://router.project-osrm.org`)
- Returns route coordinates for map visualization
- Falls back to straight line if API unavailable

### Data Schema

**Processed Order Data**:
- `order_id`, `order_name`, `fulfillment_status`
- `shipping_method`, `fulfillment_location`
- `address`, `address2`, `city`, `province`, `country`, `zip`
- `latitude`, `longitude`
- `customer_id`, `customer_email`, `customer_name` (formatted)
- `phone`, `total_price`, `currency`
- `shipping_charge`, `shipping_currency`
- `created_at`
- `tags`, `route_tag`
- `has_devolucao`, `has_reentrega`, `is_fulfilled`
- `address_validation` (validation status and suggestions)

---

## Performance Considerations

### Caching Strategy

- **Geocoding Results**: Cached permanently to avoid redundant API calls
- **Shopify API Responses**: Cached per session where applicable
- **Route Tags History**: Stored in `data/local_delivery/ld_tags_history.json`

### Rate Limiting

- **Shopify API**: 40 requests/second (configurable in ShopifyGraphQLClient)
- **OSRM API**: Public instance, no rate limit but may have usage restrictions
- **Geocoding Service**: Depends on configured service (Google Maps or Nominatim)

### Memory Management

- Orders limited to 50 for display in selection panel (for performance)
- All orders shown on map (no limit)
- Session state managed efficiently to prevent memory bloat

### Optimization Features

- **ZIP Code Caching**: Geocoding optimized to cache per unique ZIP code
- **Batch Tag Updates**: Multiple orders updated in sequence with delays
- **Lazy Map Rendering**: Map only recreated when necessary

---

## Troubleshooting

### Common Issues

**No Orders Found**:
- Verify orders have `LOCAL` tag in Shopify
- Check date range (must include orders up to today)
- Verify fulfillment status (system excludes FULFILLED orders)
- Check province mapping (orders must be from mapped provinces)
- Ensure orders have valid addresses for geocoding

**Map Not Displaying**:
- Ensure `streamlit-folium` is installed
- Verify coordinates are valid (check geocoding results)
- Check that map tiles are accessible
- Verify orders have been loaded successfully

**Route Not Rendering**:
- Ensure orders are selected (checkboxes checked)
- Verify route is selected from dropdown
- Check that fulfillment location has coordinates
- Verify OSRM API is accessible (public instance may be down)

**Tags Not Updating in Shopify**:
- Verify API token has `write_orders` permission
- Check that order IDs are valid
- Review error messages in Streamlit UI
- Verify Shopify API connection

**Address Validation Not Working**:
- Validation runs automatically during order processing
- Check that addresses have both address1 and address2 fields
- Review validation flags (red dots) in order list
- Manual correction required in Shopify admin

**Pre-sale Orders Not Showing**:
- Pre-sale orders are filtered by default
- Use multiselect to include specific pre-sale tags
- Click "Confirm" after selecting tags
- Verify orders have pre-sale tags starting with "pre-venda"

### Logging

The application uses Streamlit's built-in debugging. Enable debug mode for troubleshooting:

```python
import streamlit as st
st.set_option('deprecation.showPyplotGlobalUse', False)
```

---

## API Reference

### Main Classes

- `DeliveryAddressMapper`: Main class for route planning and order management
- `ShopifyGraphQLClient`: Shopify API client with rate limiting (from `apis.shopify`)
- `GeocodingService`: Geocoding service wrapper (from `functions.geocommerce.core.api_data_processor`)

### Key Methods

**Order Processing**:
- `_process_orders()`: Process and filter orders from Shopify
- `_fetch_and_display_orders()`: Fetch orders and prepare for display
- `_validate_address_format()`: Validate address format and detect issues
- `_format_customer_name()`: Format customer names (remove prepositions, use initials)

**Route Management**:
- `_display_orders_selection()`: Display order selection interface
- `_display_orders_map()`: Display interactive map with orders and routes
- `_display_committed_routes()`: Display route statistics
- `_get_route_color()`: Get color for route based on route number
- `_optimize_route_sequence()`: Optimize delivery sequence using nearest-neighbor
- `_get_driving_route()`: Get driving routes from OSRM API

**Shopify Integration**:
- `_update_order_tags_batch()`: Update tags for multiple orders
- `_update_order_tags()`: Update tags for single order
- `_cleanup_tags_from_history()`: Remove route tags from orders

**Data Management**:
- `_load_tags_history()`: Load route tag history from file
- `_save_tags_history()`: Save route tag history to file
- `_add_to_tags_history()`: Add order to tag history
- `_remove_from_tags_history()`: Remove orders from tag history

---

## Contributing

When contributing to this project:

1. Follow PEP 8 style guidelines
2. Add type annotations for new functions
3. Include docstrings for all public methods
4. Test with different order volumes and edge cases
5. Update this README for new features
6. Follow CPG Labs UI patterns (see `.cursor/rules/ui-patterns.mdc`)
7. Register changes in `log.md` after modifications

---

## License

This project is developed as part of the CPG Labs Local Delivery system for Shopify route planning and order management.

---

## Support

For issues and questions:

1. Consult the troubleshooting section
2. Review error messages in Streamlit UI
3. Verify Shopify API configuration
4. Test with a smaller date range first
5. Check that orders have `LOCAL` tag in Shopify
6. Verify fulfillment location mapping matches your provinces

---

**Version**: 1.0.0  
**Last Updated**: 2025-01-XX  
**Maintainer**: CPG Labs Team

