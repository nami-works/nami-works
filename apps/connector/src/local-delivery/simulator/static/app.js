/* eslint-disable */
// Vanilla-JS frontend for the LD optimization simulator.
// Uses Google Maps JS API (v=weekly, libraries=marker) with a cloud-styled
// Map ID for the dark-blue cpg-labs visual.
// Loaded dynamically after fetching /api/config so the API key is never
// hardcoded in the source.

const API = "/local-delivery/simulator/api";
const ROUTE_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#e67e22", "#9b59b6", "#f1c40f", "#8e44ad", "#16a085"];

// Map style arrays ported from cpg-labs/app/routes/app.local-delivery.tsx.
// Registered as `google.maps.StyledMapType`s and switched via setMapTypeId.
const GRAYSCALE_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "poi", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.land_parcel", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#dadada" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
];

const DARK_MAP_STYLES = [
  { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#38414e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212a37" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#746855" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1f2835" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
  { featureType: "transit", elementType: "all", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#17263c" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
];

const STYLE_OPTIONS = [
  { id: "light", label: "Light" },
  { id: "grayscale", label: "Grayscale" },
  { id: "dark", label: "Dark" },
];

const state = {
  batches: [],
  current: null,
  baselineQuote: null,
  proposedQuote: null,
  dirty: false,
  map: null,
  pickupMarker: null,
  customerMarkers: new Map(), // orderId → AdvancedMarkerElement
  routeLines: [], // google.maps.Polyline[]
  openInfoWindow: null,
};

// ── Boot ──────────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  setStatus("loading map…");
  try {
    const cfg = await loadGoogleMaps();
    initMap(cfg);
    await loadBatches();
  } catch (e) {
    setStatus(`failed to load map: ${e.message ?? e}`);
    return;
  }

  document.getElementById("batch-picker").addEventListener("change", (e) => {
    const id = parseInt(e.target.value, 10);
    if (Number.isFinite(id)) loadBatch(id);
  });
  document.getElementById("optimize-fresh").addEventListener("click", optimizeFresh);
  document.getElementById("recalculate").addEventListener("click", recalculateCost);
  document.getElementById("save-tweak").addEventListener("click", saveTweak);
});

async function loadGoogleMaps() {
  const cfg = await fetch(`${API}/config`).then((r) => r.json());
  if (!cfg.googleMapsApiKey) throw new Error("GOOGLE_MAPS_API_KEY not set on server");

  if (window.google?.maps?.marker) return cfg;

  await new Promise((resolve, reject) => {
    window.__namiMapsInit = () => resolve();
    const s = document.createElement("script");
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.searchParams.set("key", cfg.googleMapsApiKey);
    url.searchParams.set("v", "weekly");
    url.searchParams.set("libraries", "marker,geometry");
    url.searchParams.set("callback", "__namiMapsInit");
    s.src = url.toString();
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("Google Maps script failed to load"));
    document.head.appendChild(s);
  });

  return cfg;
}

function initMap(cfg) {
  // mapId is required for AdvancedMarkerElement to render correctly. Even
  // though we override the visual via StyledMapType, we still pass mapId
  // to keep AdvancedMarkerElement happy. Falls back to the legacy mode if
  // no mapId is configured.
  const opts = {
    center: { lat: -23.55, lng: -46.63 },
    zoom: 12,
    streetViewControl: false,
    mapTypeControl: false, // we use our own picker
    fullscreenControl: true,
    rotateControl: false,
    gestureHandling: "greedy",
  };
  const primaryMapId = cfg.mapStyles?.[0]?.mapId;
  if (primaryMapId) opts.mapId = primaryMapId;

  state.map = new google.maps.Map(document.getElementById("map"), opts);

  // Register custom map types so we can switch via setMapTypeId without
  // recreating the map. Pattern lifted verbatim from cpg-labs.
  const styledLight = new google.maps.StyledMapType(null, { name: "Light" });
  const styledGray = new google.maps.StyledMapType(GRAYSCALE_MAP_STYLES, {
    name: "Grayscale",
  });
  const styledDark = new google.maps.StyledMapType(DARK_MAP_STYLES, {
    name: "Dark",
  });
  state.map.mapTypes.set("light", styledLight);
  state.map.mapTypes.set("grayscale", styledGray);
  state.map.mapTypes.set("dark", styledDark);

  // Restore user's last choice; default to dark (cpg-labs default).
  const saved = localStorage.getItem("ld-sim-map-style");
  const validIds = STYLE_OPTIONS.map((s) => s.id);
  const initial = validIds.includes(saved) ? saved : "dark";
  state.map.setMapTypeId(initial);

  // Populate the style picker.
  const picker = document.getElementById("style-picker");
  picker.innerHTML = "";
  for (const s of STYLE_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.label;
    if (s.id === initial) opt.selected = true;
    picker.appendChild(opt);
  }
  picker.hidden = false;
  picker.addEventListener("change", (e) => switchMapStyle(e.target.value));
}

function switchMapStyle(id) {
  if (!STYLE_OPTIONS.some((s) => s.id === id)) return;
  localStorage.setItem("ld-sim-map-style", id);
  state.map.setMapTypeId(id);
}

// ── Data fetch ────────────────────────────────────────────────────────────────

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function loadBatches() {
  setStatus("loading batches…");
  const res = await fetch(`${API}/batches`);
  const json = await res.json();
  state.batches = json.batches;
  const sel = document.getElementById("batch-picker");
  sel.innerHTML = "";
  if (state.batches.length === 0) {
    sel.innerHTML = `<option>(no batches — run fetch-history.ts)</option>`;
    setStatus("no batches");
    return;
  }
  sel.innerHTML = `<option value="">— pick a batch —</option>`;
  const today = todayIso();
  for (const b of state.batches) {
    const opt = document.createElement("option");
    opt.value = b.id;
    const live = b.date === today ? "● LIVE  " : "";
    opt.textContent = `${live}${b.date} • ${b.locationName} • ${b.orderCount} orders / ${b.routeCount} routes`;
    sel.appendChild(opt);
  }
  setStatus(`${state.batches.length} batches`);

  // Deep-link support: ?batch=N opens that batch directly.
  const params = new URLSearchParams(location.search);
  const deepBatch = params.get("batch");
  if (deepBatch) {
    const id = parseInt(deepBatch, 10);
    if (Number.isFinite(id) && state.batches.some((b) => b.id === id)) {
      sel.value = String(id);
      loadBatch(id);
    }
  }
}

async function loadBatch(id) {
  setStatus("loading batch…");
  const res = await fetch(`${API}/batches/${id}`);
  const { batch, tweaks } = await res.json();
  const payload = batch.payload || { orders: [], routes: [], unassigned: [] };
  state.current = {
    id: batch.id,
    date: batch.date,
    locationId: batch.locationId,
    locationName: batch.locationName,
    pickupLat: batch.pickupLat,
    pickupLng: batch.pickupLng,
    orders: payload.orders,
    routes: structuredClone(payload.routes),
    unassigned: structuredClone(payload.unassigned ?? []),
    historicalRoutes: payload.routes,
    tweaks,
    readOnly: batch.date === todayIso(),
  };
  state.baselineQuote = null;
  state.proposedQuote = null;
  state.dirty = false;
  document.getElementById("readonly-flag").hidden = !state.current.readOnly;
  render();
  setStatus(`loaded #${id}${state.current.readOnly ? " (read-only)" : ""}`);
}

// ── Render ────────────────────────────────────────────────────────────────────

function render() {
  renderMap();
  renderSidePanel();
  document.getElementById("annotation-block").hidden = false;
  refreshDirtyFlag();
}

function clearMap() {
  if (state.pickupMarker) {
    state.pickupMarker.map = null;
    state.pickupMarker = null;
  }
  for (const m of state.customerMarkers.values()) m.map = null;
  for (const l of state.routeLines) l.setMap(null);
  state.customerMarkers.clear();
  state.routeLines = [];
  if (state.openInfoWindow) {
    state.openInfoWindow.close();
    state.openInfoWindow = null;
  }
}

// Lighten a hex color by mixing toward white; returns rgb() string.
// Used for the badge background tint per route color.
function lightenHex(hex, amount = 0.65) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr}, ${lg}, ${lb})`;
}

// Pill-shape badge with optional emoji + text. Pattern ported from
// cpg-labs `buildLabel` (app.local-delivery.tsx).
function buildLabel(text, emoji, badgeStyle) {
  const wrapper = document.createElement("div");
  wrapper.className = "map-label-container";

  const label = document.createElement("div");
  label.className = "map-label-badge";

  if (emoji) {
    const emojiLine = document.createElement("div");
    emojiLine.className = "map-label-emoji";
    emojiLine.textContent = emoji;
    label.appendChild(emojiLine);
  }

  const textLine = document.createElement("div");
  textLine.className = "map-label-order";
  textLine.textContent = text;
  label.appendChild(textLine);

  if (badgeStyle) {
    Object.assign(label.style, badgeStyle);
  }

  wrapper.appendChild(label);
  return wrapper;
}

function makeOrderMarkerElement(color, orderName, addressInvalid) {
  const emoji = addressInvalid ? "🟡" : "📦";
  return buildLabel(orderName, emoji, {
    backgroundColor: lightenHex(color, 0.55),
    borderColor: "#111111",
  });
}

function makePickupMarkerElement(label) {
  return buildLabel(label, "🏬");
}

function renderMap() {
  clearMap();
  const c = state.current;
  if (c.pickupLat != null && c.pickupLng != null) {
    state.pickupMarker = new google.maps.marker.AdvancedMarkerElement({
      position: { lat: c.pickupLat, lng: c.pickupLng },
      map: state.map,
      content: makePickupMarkerElement(c.locationName),
      title: c.locationName,
      zIndex: 1000,
    });
    state.map.setCenter({ lat: c.pickupLat, lng: c.pickupLng });
    state.map.setZoom(13);
  }

  const orderColor = new Map();
  // Unassigned orders render with a white-background pill (no tint, no
  // polyline) so they're visually distinct from route 1 (red).
  for (const oid of c.unassigned ?? []) {
    orderColor.set(oid, "#ffffff");
  }
  c.routes.forEach((r, i) => {
    const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
    for (const oid of r.orderIds) orderColor.set(oid, color);
    const path = [];
    if (c.pickupLat != null && c.pickupLng != null) {
      path.push({ lat: c.pickupLat, lng: c.pickupLng });
    }
    for (const oid of r.orderIds) {
      const o = c.orders.find((x) => x.id === oid);
      if (o && o.shippingAddress.latitude != null && o.shippingAddress.longitude != null) {
        path.push({
          lat: o.shippingAddress.latitude,
          lng: o.shippingAddress.longitude,
        });
      }
    }
    if (path.length >= 2) {
      const line = new google.maps.Polyline({
        path,
        strokeColor: color,
        strokeOpacity: 0.65,
        strokeWeight: 2.5,
        // Dashed while we wait for the routed polyline.
        icons: [
          {
            icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
            offset: "0",
            repeat: "12px",
          },
        ],
        map: state.map,
      });
      state.routeLines.push(line);
    }
  });

  // Kick off async routed-polyline fetch — replaces straight lines when ready.
  void fetchAndRenderRoutedPolylines(c, orderColor);

  for (const o of c.orders) {
    const lat = o.shippingAddress.latitude;
    const lng = o.shippingAddress.longitude;
    if (lat == null || lng == null) continue;
    const color = orderColor.get(o.id) ?? "#888";
    // address-invalid heuristic: blank or missing address1/zip flags 🟡
    const invalid = !o.shippingAddress.address1 || !o.shippingAddress.zip;
    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: { lat, lng },
      map: state.map,
      content: makeOrderMarkerElement(color, o.name, invalid),
      title: o.name,
    });
    marker.addListener("click", () => {
      if (state.openInfoWindow) state.openInfoWindow.close();
      const iw = new google.maps.InfoWindow({ content: buildOrderPopup(o) });
      iw.open({ map: state.map, anchor: marker });
      state.openInfoWindow = iw;
    });
    state.customerMarkers.set(o.id, marker);
  }
}

async function fetchAndRenderRoutedPolylines(c, orderColor) {
  const body = {
    routes: c.routes.map((r, i) => ({ routeIndex: i, orderIds: r.orderIds })),
  };
  let json;
  try {
    const res = await fetch(`${API}/batches/${c.id}/polylines`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return;
    json = await res.json();
  } catch {
    return;
  }
  // If the user navigated away while we were fetching, abort.
  if (state.current?.id !== c.id) return;

  // Drop the dashed straight lines and replace with routed polylines.
  for (const line of state.routeLines) line.setMap(null);
  state.routeLines = [];

  for (const r of json.routes ?? []) {
    if (!r.ok) continue;
    const path = google.maps.geometry.encoding.decodePath(r.polyline);
    // Prepend pickup so the routed line visually starts at the depot marker.
    if (c.pickupLat != null && c.pickupLng != null) {
      path.unshift(new google.maps.LatLng(c.pickupLat, c.pickupLng));
    }
    const color = ROUTE_COLORS[r.routeIndex % ROUTE_COLORS.length];
    const line = new google.maps.Polyline({
      path,
      strokeColor: color,
      strokeOpacity: 0.85,
      strokeWeight: 4,
      map: state.map,
    });
    state.routeLines.push(line);
  }
}

function buildOrderPopup(o) {
  const a = o.shippingAddress;
  const name = [a.firstName, a.lastName].filter(Boolean).join(" ");
  return `<div class="iw"><b>${o.name}</b> — ${name}<br>${a.address1 ?? ""}${a.address2 ? ", " + a.address2 : ""}<br>${a.city ?? ""} ${a.zip ?? ""}</div>`;
}

function renderSidePanel() {
  const c = state.current;
  const container = document.getElementById("routes-container");
  container.innerHTML = "";
  const unassigned = c.unassigned ?? [];
  if (unassigned.length > 0) {
    const card = document.createElement("div");
    card.className = "route-card";
    card.innerHTML = `
      <div class="route-header">
        <span class="swatch swatch-unassigned"></span>
        <span class="route-name">Unassigned (${unassigned.length} stops)</span>
      </div>
      <div class="stops"></div>
    `;
    const stops = card.querySelector(".stops");
    unassigned.forEach((oid) => {
      const o = c.orders.find((x) => x.id === oid);
      const pill = document.createElement("span");
      pill.className = "stop-pill";
      pill.textContent = o ? o.name : oid;
      pill.title = "Click to assign to a route";
      pill.addEventListener("click", (ev) => openRoutePicker(ev, oid, -2));
      stops.appendChild(pill);
    });
    container.appendChild(card);
  }
  c.routes.forEach((r, i) => {
    const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
    const card = document.createElement("div");
    card.className = "route-card";
    const cost = costForRoute(i);
    card.innerHTML = `
      <div class="route-header">
        <span class="swatch" style="background:${color}"></span>
        <span class="route-name">Route ${i + 1} (${r.orderIds.length} stops)</span>
        <span class="cost">${cost}</span>
      </div>
      <div class="stops"></div>
    `;
    const stops = card.querySelector(".stops");
    r.orderIds.forEach((oid) => {
      const o = c.orders.find((x) => x.id === oid);
      const pill = document.createElement("span");
      pill.className = "stop-pill";
      pill.textContent = o ? o.name : oid;
      pill.title = "Click to pick destination route";
      pill.addEventListener("click", (ev) => openRoutePicker(ev, oid, i));
      stops.appendChild(pill);
    });
    container.appendChild(card);
  });
  if (state.proposedQuote || state.baselineQuote) {
    const totals = document.createElement("div");
    totals.className = "totals";
    const baseline = state.baselineQuote ? parseFloat(state.baselineQuote.total) : null;
    const proposed = state.proposedQuote ? parseFloat(state.proposedQuote.total) : null;
    let html = "";
    if (baseline != null) html += `<div>Historical: R$ ${baseline.toFixed(2)}</div>`;
    if (proposed != null) html += `<div>Proposed: R$ ${proposed.toFixed(2)}</div>`;
    if (baseline != null && proposed != null) {
      const delta = proposed - baseline;
      const cls = delta > 0 ? "delta-positive" : "delta-negative";
      html += `<div class="${cls}">Δ R$ ${delta.toFixed(2)}</div>`;
    }
    totals.innerHTML = html;
    container.appendChild(totals);
  }
}

function costForRoute(i) {
  const q = state.proposedQuote ?? state.baselineQuote;
  if (!q) return "";
  const r = q.routes.find((x) => x.routeIndex === i);
  if (!r || !r.ok) return "—";
  return `R$ ${parseFloat(r.priceTotal).toFixed(2)}`;
}

// ── Tweak: move order between routes ──────────────────────────────────────────

function moveOrderToRoute(orderId, fromIdx, toIdx) {
  if (state.current?.readOnly) {
    setStatus("read-only — today's dispatch is managed in cpg-labs");
    return;
  }
  if (fromIdx === toIdx) return;
  const c = state.current;
  if (fromIdx === -2) {
    // Coming from the unassigned bucket.
    c.unassigned = (c.unassigned ?? []).filter((x) => x !== orderId);
  } else {
    c.routes[fromIdx].orderIds = c.routes[fromIdx].orderIds.filter((x) => x !== orderId);
  }
  if (toIdx === -1) {
    // -1 = "new route" — append a new empty route, then push.
    c.routes.push({
      routeNumber: c.routes.length + 1,
      routeTag: `tweak-new-${c.routes.length + 1}`,
      orderIds: [],
    });
    toIdx = c.routes.length - 1;
  }
  c.routes[toIdx].orderIds.push(orderId);
  // Drop empty routes at the tail.
  while (c.routes.length > 0 && c.routes[c.routes.length - 1].orderIds.length === 0) {
    c.routes.pop();
  }
  state.dirty = true;
  state.proposedQuote = null;
  render();
}

function openRoutePicker(ev, orderId, fromIdx) {
  ev.stopPropagation();
  closeRoutePicker();

  const c = state.current;
  const menu = document.createElement("div");
  menu.className = "route-picker";
  c.routes.forEach((r, i) => {
    if (i === fromIdx) return; // skip current
    const item = document.createElement("button");
    item.type = "button";
    const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
    item.innerHTML = `<span class="swatch" style="background:${color}"></span>Route ${i + 1} <span class="muted">(${r.orderIds.length} stops)</span>`;
    item.addEventListener("click", () => {
      closeRoutePicker();
      moveOrderToRoute(orderId, fromIdx, i);
    });
    menu.appendChild(item);
  });
  // "New route" option — useful when splitting.
  const newRoute = document.createElement("button");
  newRoute.type = "button";
  newRoute.innerHTML = `<span class="swatch swatch-new"></span>+ New route`;
  newRoute.addEventListener("click", () => {
    closeRoutePicker();
    moveOrderToRoute(orderId, fromIdx, -1);
  });
  menu.appendChild(newRoute);

  // Position relative to the clicked pill.
  const rect = ev.target.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${rect.left}px`;
  document.body.appendChild(menu);
  state.openRoutePicker = menu;
  // Close on outside click.
  setTimeout(() => {
    document.addEventListener("click", closeRoutePicker, { once: true });
  }, 0);
}

function closeRoutePicker() {
  if (state.openRoutePicker) {
    state.openRoutePicker.remove();
    state.openRoutePicker = null;
  }
}

// ── Quote / optimize / save ──────────────────────────────────────────────────

async function recalculateCost() {
  if (!state.current) return;
  setStatus("quoting…");
  const body = {
    routes: state.current.routes.map((r, i) => ({
      routeIndex: i,
      orderIds: r.orderIds,
    })),
  };
  const res = await fetch(`${API}/batches/${state.current.id}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    setStatus(`quote error: ${json.error ?? res.status}`);
    return;
  }
  if (state.dirty) state.proposedQuote = json;
  else state.baselineQuote = json;
  renderSidePanel();
  setStatus(`quoted (R$ ${parseFloat(json.total).toFixed(2)})`);
}

async function optimizeFresh() {
  if (!state.current) return;
  setStatus("optimizing…");
  const res = await fetch(`${API}/batches/${state.current.id}/optimize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const json = await res.json();
  if (!res.ok) {
    setStatus(`optimize error: ${json.error ?? res.status}`);
    return;
  }
  if (!json.result?.ok) {
    setStatus(`optimize: ${json.result?.error ?? "failed"}`);
    return;
  }
  state.current.routes = json.result.routes.map((r) => ({
    routeNumber: r.routeIndex + 1,
    routeTag: `optimizer-fresh-${r.routeIndex}`,
    orderIds: r.orderIds,
  }));
  state.dirty = true;
  state.proposedQuote = {
    routes: json.result.routes.map((r) => ({
      routeIndex: r.routeIndex,
      ok: true,
      priceTotal: r.costTotal,
      currency: r.costCurrency,
    })),
    total: json.result.summary.totalCost,
    currency: json.result.summary.costCurrency,
  };
  render();
  setStatus(`optimizer: ${json.result.summary.routeCount} routes / R$ ${parseFloat(json.result.summary.totalCost).toFixed(2)}`);
}

async function saveTweak() {
  if (!state.current) return;
  if (state.current.readOnly) {
    setStatus("read-only — today's dispatch is managed in cpg-labs");
    return;
  }
  const annotation = document.getElementById("annotation").value.trim();
  const tags = Array.from(document.querySelectorAll(".tag-chips input:checked"))
    .map((el) => el.value)
    .join(",");
  setStatus("saving tweak…");
  const body = {
    proposedRoutes: state.current.routes.map((r, i) => ({
      routeIndex: i,
      orderIds: r.orderIds,
    })),
    proposedQuote: state.proposedQuote,
    baselineQuote: state.baselineQuote,
    annotation,
    tags,
  };
  const res = await fetch(`${API}/batches/${state.current.id}/save-tweak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    setStatus(`save error: ${res.status}`);
    return;
  }
  state.dirty = false;
  refreshDirtyFlag();
  document.getElementById("annotation").value = "";
  for (const el of document.querySelectorAll(".tag-chips input:checked")) {
    el.checked = false;
  }
  setStatus("tweak saved");
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setStatus(msg) {
  document.getElementById("status").textContent = msg;
}

function refreshDirtyFlag() {
  document.getElementById("dirty-flag").hidden = !state.dirty;
}
