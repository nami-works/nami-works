# Shopify → Omnify Local Delivery Field Mapping

Reference for how Shopify data maps to Omnify Local Delivery UI and loader types.

## Loader Data Sources

Data comes from:

1. **Shopify GraphQL** — Orders, Locations, Delivery Profiles
2. **Omnify DB** — `LalamoveLocationConfig`, `CarrierServiceConfig`, `pendingDeliveryRoute`, `LalamoveDispatchJob`
3. **URL params** — `deliveryMethod`, `locationId`, `startDate`, `deliveryPromiseDays`, `presaleTags`

---

## Orders (Shopify Order → LoaderOrder / Local Delivery UI)

| Omnify Local Delivery field | Shopify source | Notes |
|-----------------------------|----------------|-------|
| `LoaderOrder.id` | `Order.id` | Order GID |
| `LoaderOrder.name` | `Order.name` | Order number (e.g. #1001) |
| `LoaderOrder.processedAt` | `Order.processedAt` | Order date |
| `LoaderOrder.customerName` | `Order.customer.displayName` | Customer name |
| `LoaderOrder.total` | `Order.currentTotalPriceSet.shopMoney.amount` + `currencyCode` | Formatted total |
| `LoaderOrder.shippingCost` | `Order.currentShippingPriceSet.shopMoney.amount` + `currencyCode` | Shipping amount |
| `LoaderOrder.shippingSummary` | `Order.shippingAddress` (address1, city, province, country) | Formatted address (no address2) |
| `LoaderOrder.address1` | `Order.shippingAddress.address1` | Street and house number |
| `LoaderOrder.address2` | `Order.shippingAddress.address2` | Apartment, suite, etc. |
| `LoaderOrder.addressValidation` | `Order.shippingAddress.address1`, `address2` | Validation result |
| `LoaderOrder.shippingCoordinates` | `Order.shippingAddress.latitude`, `longitude` | Delivery coordinates |
| `LoaderOrder.fulfillmentLocation.id` | `FulfillmentOrder.assignedLocation.location.id` | Assigned location GID |
| `LoaderOrder.fulfillmentLocation.name` | `FulfillmentOrder.assignedLocation.name` | Location name |
| `LoaderOrder.fulfillmentLocation.coordinates` | `FulfillmentOrder.assignedLocation.location.address.latitude/longitude` | Pickup coordinates |
| `LoaderOrder.tags` | `Order.tags` | Order tags (e.g. route tags, LOCAL) |
| `LoaderOrder.adminOrderUrl` | Derived from `session.shop` + `Order.id` | Admin order URL |

---

## Locations (Shopify Location → LoaderLocation)

| Omnify Local Delivery field | Shopify source | Notes |
|-----------------------------|----------------|-------|
| `LoaderLocation.id` | `Location.id` | Location GID |
| `LoaderLocation.name` | `Location.name` | Location name |
| `LoaderLocation.addressSummary` | `Location.address` (address1, city, province, country) | Formatted address |
| `LoaderLocation.coordinates` | `Location.address.latitude`, `longitude` | Location coordinates |
| `LoaderLocation.phone` | `Location.address.phone` | Location phone |
| `LoaderLocation.address1` | `Location.address.address1` | Street and house number |
| `LoaderLocation.address2` | `Location.address.address2` | Apartment, suite, etc. |
| `LoaderLocation.city` | `Location.address.city` | City |
| `LoaderLocation.province` | `Location.address.province` | Province |
| `LoaderLocation.country` | `Location.address.country` | Country |
| `LoaderLocation.countryCode` | `Location.address.countryCode` | Country code |

---

## Lalamove Config (DB + Location Overrides)

| Omnify Local Delivery field | Shopify source | Notes |
|-----------------------------|----------------|-------|
| `LalamoveConfig.locationName` | `Location.name` \|\| `LalamoveLocationConfig.locationName` | Location overrides saved config |
| `LalamoveConfig.locationDetails` | `Location.address.address2` \|\| `LalamoveLocationConfig.locationDetails` | Location overrides saved config |
| `LalamoveConfig.locationPhone` | `LalamoveLocationConfig.locationPhone` | From Location settings (DB) |
| `LalamoveConfig.locationAddress` | `LalamoveLocationConfig.locationAddress` | From Location settings (DB) |
| `LalamoveConfig.pickupInstructions` | `LalamoveLocationConfig.pickupInstructions` | From Location settings (DB) |
| `LalamoveConfig.market` | `LalamoveLocationConfig.market` | From Location settings (DB) |
| `LalamoveConfig.city` | `LalamoveLocationConfig.city` | From Location settings (DB) |
| `LalamoveConfig.language` | `LalamoveLocationConfig.language` | From Location settings (DB) |
| `LalamoveConfig.preferredServiceType` | `LalamoveLocationConfig.preferredServiceType` | From Location settings (DB) |

---

## Route Stats (Route Tags + Orders)

| Omnify Local Delivery field | Shopify source | Notes |
|-----------------------------|----------------|-------|
| `routeStats[].label` | Derived | `Route 01`, `Route 02`, etc. |
| `routeStats[].tag` | `Order.tags` | Tags like `ld_rota-01`, `ld_rota-02` |
| `routeStats[].orders` | `Order.id`, `Order.name`, `Order.customer.displayName` | Orders in route |
| `routeStats[].shippingTotal` | `Order.currentShippingPriceSet.shopMoney.amount` | Sum of shipping per route |

---

## Delivery Profiles (Filtering Locations)

| Omnify Local Delivery field | Shopify source | Notes |
|-----------------------------|----------------|-------|
| `localDeliveryLocationIds` | `DeliveryProfile.profileLocationGroups[].locationGroup.locations.nodes[].id` | Only when zone has `methodDefinitions.name` containing "local" |

---

## Filtering / Query Params

| Omnify Local Delivery field | Shopify source | Notes |
|-----------------------------|----------------|-------|
| `filters.deliveryMethod` | URL param `deliveryMethod` | `delivery_method:LOCAL` etc. |
| `filters.locationId` | URL param `locationId` | `fulfillment_location_id:...` |
| `filters.startDate` | URL param `startDate` | `created_at:>=${startDateKey}` |
| `filters.deliveryPromiseDays` | URL param `deliveryPromiseDays` | Used for display |
| `filters.selectedPresaleTags` | URL param `presaleTags` | Comma-separated tags for presale filtering |

---

## Order Filtering (Loader)

| Filter | Shopify source | Notes |
|--------|----------------|-------|
| Fulfillment location | `FulfillmentOrder.assignedLocation.location.id` | Must match location filter |
| Delivery method | `FulfillmentOrder.deliveryMethod.methodType` | Must match LOCAL etc. |
| Status | `Order.displayFulfillmentStatus` | Excludes CANCELLED, DELIVERED |
| Presale tags | `Order.tags` | Must include selected presale tag |
| Coordinates | `Order.shippingAddress.latitude/longitude` | Required for map |

---

## Precomputed Routes

| Omnify Local Delivery field | Shopify source | Notes |
|-----------------------------|----------------|-------|
| Route origin | `Order.fulfillmentLocation.coordinates` | From matching fulfillment |
| Route waypoints | `Order.shippingCoordinates` | From `Order.shippingAddress.latitude/longitude` |
| Route polyline | Google Routes API | Derived from order coordinates |

---

## Lalamove Order Request Mapping

| Lalamove field | Shopify / Omnify source | Notes |
|----------------|--------------------------|-------|
| `recipients[0].remarks` | `LalamoveConfig.pickupInstructions` | Only pickup instructions for first delivery stop |
| `recipients[n>0].remarks` | `Order.shippingAddress.address2` | Apartment/building details for each delivery stop |
| `recipients[n].stopId` | `Quotation.stops[n+1].stopId` | Comes from Lalamove quotation response |
| `recipients[n]` order linkage | Optimized `stopId -> orderId` assignment | Deterministic mapping captured at quote time |

