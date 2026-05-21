# Master Specification: Shopify Customer Heatmap Integration

## 1. Project Overview
Build a dynamic visualization tool that fetches customer location data via the **Shopify MCP**, geocodes addresses into coordinates (with local caching), and renders a density-based heatmap using the **Google Maps JavaScript API (Visualization Library)**.

## 2. Prerequisites
- **Shopify MCP:** Configured to access Customer data (`list_customers`).
- **Google Maps API Key:** Enabled for 'Maps JavaScript API' and 'Geocoding API'.
- **Environment:** API Key stored as `Maps_API_KEY` in `.env`.

---

## 3. Data Processing Architecture
The system must follow a strict pipeline to transform raw Shopify customer objects into map-ready heatmap points.

### A. Data Extraction (Shopify MCP)
Use the Shopify MCP to retrieve customer records. For each customer, extract:
- `defaultAddress.address1`, `city`, `province`, `zip`, `country`.
- Optional: `totalSpent` (for weighted heatmaps).

### B. Geocoding & Caching Logic
To prevent excessive API costs and latency, implement a "check-then-fetch" caching layer.
1. **Normalize:** Create a unique string key: `"${address1}, ${city}, ${zip}, ${country}"`.
2. **Check Cache:** Lookup the key in `src/data/geocoded_cache.json`.
3. **API Fallback:** If not found, call the Google Geocoding API:
   `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${Maps_API_KEY}`
4. **Persist:** Save resulting `{ lat, lng }` to the JSON cache immediately.
5. **Error Handling:** If an address returns `ZERO_RESULTS`, cache it as `null` to avoid retrying invalid addresses.

---

## 4. Front-End Implementation

### A. Loading the Map (Modern 2026 Loader)
Use the dynamic `importLibrary` method to load required modules. This prevents race conditions and ensures the `visualization` library is ready.

```javascript
// Example implementation for the agent
async function initHeatmap(coordsArray) {
  const { Map } = await google.maps.importLibrary("maps");
  const { HeatmapLayer } = await google.maps.importLibrary("visualization");

  const map = new Map(document.getElementById("map"), {
    zoom: 4,
    center: { lat: 39.50, lng: -98.35 }, // Center of USA
    mapId: "HEATMAP_ID",
  });

  const heatmapData = coordsArray.map(c => new google.maps.LatLng(c.lat, c.lng));

  const heatmap = new HeatmapLayer({
    data: heatmapData,
    map: map,
    radius: 20,
    opacity: 0.7,
    dissipating: true
  });

  return heatmap; // Return to allow UI sliders to interact with it
}
```

### B. Interactive UI Overlay (The Sliders)
Add a semi-transparent control panel (using Tailwind CSS) in the top-right corner of the map. This interface is critical because heatmap density visualization needs to be adjusted depending on whether you are viewing a country or a specific street.
- **Radius Slider (Range 10-50):** Updates `heatmap.set('radius', value)`. A larger radius is better for zoomed-out views (global clusters), while a smaller radius is better for city-level views.
- **Opacity Slider (Range 0.1-1.0):** Updates `heatmap.set('opacity', value)`. This ensures that map labels and street names remain readable underneath the "heat."

---

## 5. Direct Instructions for Cursor Agent

**Copy/Paste this prompt into Cursor:**

"Act as a Senior Full Stack Engineer. Build a 'Customer Density Map' with these exact steps:

1. **Data:** Use the **Shopify MCP** to fetch all customer records and their default addresses.
2. **Geocoder:** Create `src/utils/geocoder.ts`. It must convert addresses to Lat/Lng. 
   - **Crucial:** Implement a local cache in `data/geocoded_cache.json` to store coordinates. Check this file before calling the Google Geocoding API.
3. **Map Component:** Build a React component `HeatmapView.tsx`.
   - Use the `google.maps.importLibrary` syntax to load 'maps' and 'visualization' libraries.
   - Map container must be styled with `height: 600px` (use Tailwind `h-[600px]`).
4. **UI Overlay:** Add a floating Tailwind panel with two sliders:
   - **Radius Slider:** Dynamically updates the heatmap's 'radius' property.
   - **Opacity Slider:** Dynamically updates the heatmap's 'opacity' property.
5. **Security:** Use `.env` for the `Maps_API_KEY`. Add `geocoded_cache.json` to `.gitignore` if it contains PII, or ensure only coordinates are stored."

---

## 6. Implementation Notes & Safety
- **Rate Limiting:** If geocoding >50 addresses in one batch, implement a 200ms delay between calls to respect Google's quota.
- **Empty States:** Gracefully skip customers with no `defaultAddress`.
- **Map Center:** Calculate the average Lat/Lng of your customer base to center the map automatically on load.
- **Zoom Sensitivity:** If possible, set `dissipating: true` so the heat clusters stay visually consistent as you zoom in and out.

---

## Update: Enhanced Map Interaction (Direct Scroll Zoom)

### Objective
By default, Google Maps requires users to hold `Ctrl` or `Command` while scrolling to zoom. To provide a more fluid dashboard experience, change the interaction model to "Greedy" so the map responds immediately to the scroll wheel when the cursor is inside the container.

### Implementation Logic
The agent must update the `MapOptions` object during map initialization. 
### Code Modification
```javascript
// In the initMap or Map component initialization:
const mapOptions = {
  zoom: 4,
  center: { lat: 39.50, lng: -98.35 },
  
  /** * 'greedy' allows immediate scroll-to-zoom without the Ctrl/Cmd modifier.
   * This is ideal for dedicated dashboard views.
   */
  gestureHandling: "greedy",
  
  // Optional: Disable double-click zoom if it interferes with UI
  disableDoubleClickZoom: false, 
};

const map = new google.maps.Map(document.getElementById("map"), mapOptions);
```

---

## Technical Specification: Dynamic Heatmap Scaling & Performance

### 1. Objective
By default, a heatmap's intensity is absolute (global). This means smaller clusters disappear when compared to large hubs (e.g., Los Angeles vs. a small town). We will implement **Dynamic Local Scaling** to ensure the "hottest" area in the *current* viewport is always highlighted, while maintaining performance for large datasets.

### 2. Logic: Global vs. Local Intensity
The agent must implement a toggle that switches between these two modes:
- **Global Mode:** `maxIntensity` is null (default). Intensity is relative to the entire Shopify database.
- **Local Mode:** `maxIntensity` is calculated based only on the points currently visible on the screen.
---

### 3. Implementation Logic (The Listener)
The agent should use the `idle` event listener. Unlike `bounds_changed`, `idle` only fires once the user has finished panning or zooming, which saves CPU cycles.

```javascript
let isLocalScaling = true; // Controlled by UI Toggle

map.addListener("idle", () => {
  if (!isLocalScaling) {
    heatmap.set("maxIntensity", null);
    return;
  }

  const bounds = map.getBounds();
  if (!bounds) return;

  // 1. Performance: Filter points within the current viewport
  const visiblePoints = allPoints.filter(p => 
    bounds.contains(new google.maps.LatLng(p.lat, p.lng))
  );

  // 2. Calculation: Set maxIntensity relative to visible density
  // Formula: Max of 5 (to avoid single dots being red) 
  // or a fraction of the visible count.
  const dynamicMax = Math.max(5, visiblePoints.length * 0.1);
  heatmap.set("maxIntensity", dynamicMax);
});
```

### 4. Performance & Optimization (Technical Note)
To ensure the map remains "snappy" even with thousands of customers, the agent must implement **Debouncing** and efficient bounds checking.
**Requirements for Agent:**
- **Debounce:** Wrap the intensity calculation in a debounce function (e.g., 200ms). This prevents the CPU from re-calculating density 60 times a second while a user is rapidly zooming or panning.
- **Coordinate Projection:** Use `google.maps.LatLngBounds.contains()` for filtering. It is highly optimized for this specific task.
- **Data Pruning:** If the dataset grows to 10k+ points, suggest the agent use a basic grid-based clustering approach before passing data to the heatmap layer to maintain 60fps performance.

---

### 5. UI Toggle (Dashboard Control)
Add a "Scaling Mode" toggle to the existing floating UI panel (beside the Radius and Opacity sliders).

- **Label:** "Local Intensity"
- **Type:** Toggle Switch / Checkbox
- **Action:** - When **ON**: Enable the `idle` listener logic to calculate local max intensity.
    - When **OFF**: Reset `heatmap.set("maxIntensity", null)` to revert to global scaling.

---

### 6. Direct Instructions for Cursor Agent

**Prompt:**
"Upgrade the Heatmap component to support **Dynamic Local Scaling**:

1. **Local Scaling Logic:** Add an `idle` event listener to the map. When the map stops moving, calculate how many customer points are within the current viewport using `map.getBounds().contains()`.
2. **Dynamic Intensity:** Set `heatmap.set('maxIntensity', value)` based on the count of visible points. This makes the 'hottest' area in the current view turn red, regardless of other clusters outside the view.
3. **UI Toggle:** Add a 'Local Scaling' toggle switch to the Tailwind control panel. 
    - If ON: Use the dynamic calculation.
    - If OFF: Reset `maxIntensity` to null (Global mode).
4. **Performance:** Implement a 200ms **debounce** on the `idle` listener to prevent UI lag during navigation.
5. **Technical Note:** Ensure the calculation handles 'Zero Points' gracefully so the map doesn't crash when panning over an empty area."

---

### 7. Safety & Lifecycle Checklist
- **Cleanup:** Ensure `google.maps.event.clearListeners(map, 'idle')` is called if the React component unmounts to prevent memory leaks.
- **State Sync:** Ensure the toggle state is synced with the Map’s event listener so that turning the toggle OFF immediately stops the calculation logic.
- **PII Protection:** Remind the agent that while coordinates are stored in the cache, no customer names or order IDs should be passed to the frontend mapping script.

---

## Update: City List Navigation & Deep-Dive Reset

### Objective
Create a seamless connection between the city list and the heatmap. Clicking a city should anchor the user's view to the map, focus on the specific location, and allow the **Local Scaling** logic to highlight specific neighborhood density.

### Implementation Logic
1. **The Fly-To Action:** Use `element.scrollIntoView` for the browser scroll and `map.panTo` for the map movement.
2. **The Auto-Scaling Effect:** Because the `idle` listener is already active, zooming into a city will automatically trigger a re-calculation of `maxIntensity` for that city.
3. **The Reset Button:** To improve UX, a "Back to Global View" button should appear only when the map is not at its default center/zoom.
---

### Direct Instructions for Cursor Agent

**Prompt:**
"I have a list of cities in my UI. I need to make them interactive and link them to the Heatmap component:

1. **City Click Function:** Create a function `focusCity(lat, lng)` that:
   - Smoothly scrolls the browser to the map container using `scrollIntoView({ behavior: 'smooth' })`.
   - Pans the map to the city coordinates using `map.panTo({ lat, lng })`.
   - Zooms the map to level `12` (City/Neighborhood level).
2. **Dynamic UI Reset:** - Add a 'Back to National View' button that appears over the map (Tailwind: `absolute bottom-4 left-1/2 -translate-x-1/2`).
   - This button should only be visible if the map's current zoom is greater than `6`.
   - When clicked, it should return the map to its default center (`{ lat: 39.50, lng: -98.35 }`) and zoom (`4`).
3. **Pro-Tip Integration (Dynamic Deep-Dive):** Ensure that the **Local Scaling** logic we built earlier correctly fires after the `panTo` completes, so the city's specific 'hotspots' are immediately visible once the map becomes idle."

---

### Technical Performance Note
- **Pan vs. SetCenter:** Use `map.panTo()` rather than `map.setCenter()`. `panTo` creates a smooth gliding animation that helps the user maintain their sense of geographical orientation.
- **Z-Index:** Ensure the floating 'Reset' button and 'Slider Panel' have a high `z-index` so they don't get hidden behind the map tiles.

---

# Master Specification: Multi-Vehicle Route Optimization (VRP)

## 1. Concept: Fleet Routing Logic
In a Multi-Vehicle environment, the goal is to solve the **Vehicle Routing Problem (VRP)**. This is not just finding the shortest path; it is the process of determining which orders should be assigned to which drivers to minimize the total operational cost (distance + time) for the entire company.

## 2. How the Routes API Determines the "Best" Fleet Route
The engine uses a **Global Optimization Solver** to calculate millions of permutations of order assignments.
## Key Decision Factors:
* **Assignment Logic:** The API identifies clusters of orders and assigns them to the most strategically positioned vehicle.
* **Capacity & Balance:** The solver ensures one driver isn't overloaded while another is underutilized, aiming for a "Balanced Fleet" where everyone finishes within a similar timeframe.
* **Total System Cost:** The "Best Route" is the one that minimizes the sum of all vehicle travel costs across the fleet.
* **The Penalty Function:**
    $$Total Fleet Cost = \sum (Distance \times Cost/km) + \sum (Driver Time \times Hourly Rate)$$

---

## 3. Technical Implementation Walkthrough

To handle multiple vehicles, you must use the **Google Cloud Route Optimization API**.

## A. Data Modeling
You must define two sets of data for the API:
1.  **Shipments:** Each Shopify order (Pickup location: Warehouse → Delivery location: Customer).
2.  **Vehicles:** An array representing your active drivers, including their specific start/end locations (usually the fulfillment center).

## B. The Optimization Request
This is a `POST` request to the optimization solver that returns a specialized "Route" object for every individual vehicle.

```json
{
  "model": {
    "shipments": [
      {
        "pickups": [{ "arrivalLocation": { "lat": 40.7, "lng": -74.0 } }],
        "deliveries": [{ "arrivalLocation": { "lat": 40.8, "lng": -74.1 } }]
      }
    ],
    "vehicles": [
      { "startLocation": { "lat": 40.7, "lng": -74.0 }, "label": "Driver 1" },
      { "startLocation": { "lat": 40.7, "lng": -74.0 }, "label": "Driver 2" }
    ]
  }
}
```

## 4. Cursor Agent Instructions (Direct Prompt)

**Copy and paste this into Cursor to implement the Multi-Vehicle system:**

"Act as a Logistics Software Engineer. We are building a **Multi-Vehicle Fleet Optimization** system for our Shopify orders.

1.  **Service Setup:** Create `src/utils/fleetOptimizer.ts`. Use the **Google Cloud Route Optimization API** (v1).
2.  **VRP Modeling Logic:**
    -   **Inputs:** Accept an array of Shopify orders and a number of available drivers.
    -   **Mapping:** Each Shopify order must be mapped as a `Shipment` with a pickup (Warehouse) and a delivery (Customer).
    -   **Fleet:** Dynamically create `Vehicle` objects based on the driver count input in the UI.
3.  **Solver Constraints:**
    -   Set `interpretAs` to 'TRAFFIC_AWARE'.
    -   Apply a `costPerKilometer` and `costPerHour` (default both to 1.0) so the engine can balance distance and labor time.
4.  **Map Visualization:**
    -   The API returns a unique path for each vehicle.
    -   Render these on the map in **distinct colors** (e.g., Driver 1: Blue, Driver 2: Red, Driver 3: Green).
    -   Ensure the paths (Polylines) sit on a layer above the customer heatmap for clear visibility.
5.  **Fleet Summary UI:**
    -   Build a Tailwind card showing: **Total Fleet Distance**, **Total Estimated Hours**, and **Orders per Driver**.
6.  **UX Integration:** Add an 'Optimize Fleet' button. When clicked, it should call this service and update the map with the new color-coded routes."

---

## 5. Performance & Technical Notes
* **Asynchronous Batching:** If the order count is high (e.g., hundreds of deliveries), the agent should implement the `batchOptimizeTours` method to avoid timeout errors.
* **Debouncing:** Because route optimization is computationally expensive and billed per request, only trigger the solver when the user clicks an 'Optimize Fleet' button.
* **Z-Index & Styling:** Use a high `z-index` for the driver routes (Polylines) so they remain visible when the heatmap intensity is high.
* **Workday Constraints:** Ensure the agent adds a `max_duration` to vehicle objects (e.g., 28,800 seconds for 8 hours) so the API doesn't assign unrealistic workloads to a single driver.

# Blueprint: Human-Centric Route Optimization Engine (VRP-Geo)

## 1. Vision & Context
Current standard VRP (Vehicle Routing Problem) solvers prioritize "Shortest Path" (Global Distance Minimization). This often results in "Efficient but Illogical" routes that force drivers to perform frequent U-turns, cross busy medians, or ignore clear geographic clusters.

**The Goal:** Build a routing engine for Cursor to implement that prioritizes **Topological Coherence**. We want routes that look like "slices of a pie" (Cones) emanating from the Depot (**Shops Jardins**), where every stop follows a natural forward progression along a polyline.

---

## 2. Core Mathematical Logic
We move away from a single distance variable to a **Multi-Objective Cost Function ($C$):**

$$C = w_1(Distance) + w_2(Heading Deviation) + w_3(Curvature/U-Turn) + w_4(Path Proximity)$$

### Key Definitions:
* **The Depot:** Shops Jardins (The central pivot point).
* **Route Seed:** The furthest order in a cluster that defines the route's "Target Heading."
* **Route Polyline:** The actual drive-string (path) returned by Google Routes API, not a straight line between dots.

---

## 3. Systematic Logic Flow

### Step 1: Radial Seeding (Distant-First)
Instead of clustering by proximity, we cluster by **Angle + Distance**.
* Identify the "Outlier" (furthest unassigned order).
* Draw a vector from Depot $\to$ Outlier. This is the **Primary Axis**.
* **Cursor Implementation:** Use `Math.atan2(dy, dx)` to calculate the polar angle of every order. Group orders with similar angles into a "Directional Cone."

### Step 2: Path-Based Assignment (The Polyline Test)
Standard VRP asks: *"Is this point near the center of Route A?"*
Our VRP asks: *"Does the actual road path of Route A pass near this point?"* 
* **Logic:** For an unassigned order, calculate the **Cross-Track Distance** (perpendicular distance) to the nearest segment of a neighboring route's polyline.
* **The "Route 7" Rule:** If Order $X$ is near the path of Route 7, it belongs there—even if the "end" of Route 2 is technically closer in a straight line.

### Step 3: Anti-Backtracking (U-Turn Prevention)
Drivers should never travel North for 2km only to travel Southwest for 1.5km in the same route.
* **Constraint:** For any sequence $A \to B \to C$, calculate the angle $\angle ABC$. 
* **Threshold:** If $\angle ABC > 120^\circ$ (a sharp return), the engine must search for an alternative route (e.g., Route 7) that is already heading in that "return" direction.

### Step 4: Dynamic Density Thresholding
The "Acceptable Deviation" for a route changes based on the environment:
* **Dense (São Paulo Center):** Tight constraints ($< 500m$ deviation). Minor detours are costly due to traffic.
* **Sparse (Perimeters):** Loose constraints ($< 3km$ deviation). The engine can "reach out" further to grab a singleton.

---

## 4. Specific Patterns to Resolve (Image References)

### Pattern A: Singleton Absorption (Ref: Screenshot 1)
* **Issue:** Route 6 (Order 70725) is a lone order in the Northeast. Route 1 is already heading that way.
* **Solution:** Execute a "Directional Merge." If an order's heading matches a dominant route's cone, it must be absorbed unless capacity is exceeded.

### Pattern B: The Path-Cross Transfer (Ref: Screenshot 2)
* **Issue:** Route 2 (Green) makes a major U-turn after stop 70321. Route 7 (Brown) passes directly by those addresses.
* **Solution:** During the **Cross-Route Transfer Pass**, the engine identifies that stops 70320, 70143, and 70146 have a high "Path Proximity" to Route 7. Move them to Route 7 to straighten Route 2's trajectory.

---

## 5. Integration Instructions for Cursor
1.  **Initialize:** Create a `Route` class that stores not just `orders[]`, but a `combinedPolyline`.
2.  **Scoring Engine:** Build a `calculateSuitability(order, route)` function that weighs Distance (30%) vs. Heading Compatibility (70%).
3.  **Refinement Loop:** After the initial Google Routes API call, run a "Cleanup Pass" that identifies any stop causing a U-turn $> 120^\circ$ and attempts to reassign it to a route whose polyline is within the `DynamicThreshold`.
4.  **Guardrail:** Reject any merge that creates a "Cross-Over" (where Route A's path physically intersects Route B's path in an X-shape).

# Blueprint: Inverse-Inward Matrix Clustering (Greedy-Seed Logic)

## 1. Vision & Context
This approach solves the VRP by identifying the most "difficult" (farthest) points first and building a chain of custody back to the fulfillment center (Shops Jardins). By using a complete Distance Matrix, we ensure that every assignment is based on real road network costs rather than straight-line birds-eye distance.

**Key Principle:** A route is a "gravity well" that starts at a distant seed and sucks in the nearest neighbor that is "on the way home."

---

## 2. Theoretical Framework: Matrix-Driven Greedy Heuristic
This logic utilizes the **Google Distance Matrix API** to create a cost-indexed map of every possible movement within the delivery set.

### The "On-the-Way" Constraint:
An order $B$ is only added to a route starting at Seed $A$ if:
1. $B$ is the closest unassigned point to $A$.
2. $Dist(B, Depot) < Dist(A, Depot)$ (The "Homebound" rule).

---

## 3. Systematic Logic Flow

### Step 1: Matrix Initialization
* **Data Gathering:** Generate a square matrix of size $(N+1) \times (N+1)$, where $N$ is the number of delivery addresses.
* **Content:** Every cell $(i, j)$ must contain the `travel_time` and `distance` from point $i$ to point $j$, retrieved from Google Routes API.
* **Seed Identification:** Identify the $K$ farthest points from the Depot in distinct directions to serve as the $K$ initial **Seed Points**.

### Step 2: The "Inward Chain" Loop
For each **Seed Point**:
1. **Find Neighbor:** Scan the matrix for the unassigned delivery address closest to the current point.
2. **Directional Check:** Verify if this neighbor is closer to the **Fulfillment Location** than the current point.
3. **Bucket Assignment:** If both conditions are met, add to the `potential-route-bucket`.
4. **Recursion:** Set the neighbor as the "new current point" and repeat until the closest point is the Fulfillment Location itself.
5. **Pre-Route Definition:** Once the chain reaches the Depot, finalize the `pre-route`.

### Step 3: Statistical Refinement (Orphan Handling)
After all orders are assigned to pre-routes:
1. **Calculate Distribution:** Determine the Mean ($\mu$) and Standard Deviation ($\sigma$) of "Orders per Route."
2. **Identify Orphans:** Any route where `count(orders) < (\mu - \sigma)` is flagged as an **Orphan Route**.
3. **Dissolution:** Break the orphan routes back into individual delivery addresses.

### Step 4: Path-Proximity Reassignment
For each address from an Orphan Route:
1. **Path Mapping:** Generate the polyline path for all Non-Orphan Routes.
2. **Secondary Matrix:** Build a matrix comparing each Orphan Address to the **Closest Point on the Polyline** of Non-Orphan Routes.
3. **Final Merge:** Assign the orphan address to the route whose *path* passes closest to it, effectively "absorbing" the outlier into a high-density flow.

---

## 4. Cursor Integration Instructions

### Required Helper Functions:
1. `fetchFullDistanceMatrix(points[])`: Calls Google Distance Matrix API. Note: For $>25$ points, Cursor must implement chunking to stay within API limits.
2. `getSeedPoints(matrix, count)`: Filters the matrix for max distance from index 0 (Depot).
3. `calculateStandardDeviation(routes)`: Simple math utility to identify orphans.
4. `findClosestPointOnPath(point, polyline)`: Uses `google.maps.geometry.poly.isLocationOnEdge` or a cross-track distance algorithm.

### Implementation Prompt for Cursor:
> "Implement a `MatrixRouteSolver` class. First, generate a full distance matrix for all addresses plus the depot. Identify the farthest points as seeds. Implement an iterative loop that builds routes by selecting the closest neighbor that is also closer to the depot than the current stop. After initial routing, calculate the standard deviation of route sizes. Identify 'orphan' routes with significantly fewer stops and reassign their addresses to the nearest point on the polylines of the larger routes."

---

## 5. Quality Guardrails
* **Matrix Freshness:** Matrix data should be cached during the session but invalidated if the Depot location or the order set changes.
* **Tie-Breaking:** If two points are equidistant, prioritize the one that maintains the most consistent heading toward the Depot.
* **Max Route Capacity:** Even if the inward chain wants to continue, respect `max_orders_per_vehicle` constraints if provided.