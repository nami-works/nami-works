"""
Local route-map renderer — workspace-side replacement for the deprecated
cpg-labs `render-routes` server intent.

Calls `nami_control.py state` for each location, builds a Google Static
Maps URL per location with pickup + per-route colored markers (legend
matches LOCAL-DELIVERY-PLAYBOOK.md §4), downloads to
`sandbox/gebeauty/route-maps/YYYY-MM-DD/<location_slug>.png`, and prints
the same `routeMaps[]` shape the playbook's optimize response promises.

Usage:
  python sandbox/gebeauty/scripts/render_routes_local.py
  python sandbox/gebeauty/scripts/render_routes_local.py --location gid://shopify/Location/97784398144
  python sandbox/gebeauty/scripts/render_routes_local.py --out /tmp/maps

Pickup coords are sourced in this priority order:
  1) `dispatch.stops[0].coordinates` from a `state --live` response (most
     accurate; this is what Lalamove actually used).
  2) Shopify Admin GraphQL `location { address { latitude longitude } }`
     (works even before any dispatch has been placed).

Marker convention (§4):
  - Pickup: black "P"
  - Routes 1-7: red, blue, green, orange, purple, yellow, brown
    (matches ld_rota-01 .. ld_rota-07 in order)
  - Stops within a route: A, B, C, … in Shopify-ID order

Stdlib only — no third-party deps. Mirrors `nami_control.py` style.
"""

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).parent.resolve()
WORKSPACE_ROOT = SCRIPT_DIR.parent
PYTHON_EXE = sys.executable

ROUTE_COLORS = ["red", "blue", "green", "orange", "purple", "yellow", "brown"]
MAX_MARKERS_PER_ROUTE = 26  # A..Z
DEFAULT_SIZE = "800x800"

SHOPIFY_SHOP_DOMAIN = "ge-beauty-cosmeticos.myshopify.com"
SHOPIFY_API_VERSION = "2026-01"


def load_env():
    env_path = WORKSPACE_ROOT / ".env"
    env = {}
    if env_path.exists():
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_google_key(env):
    """Return (key, source) — source describes where it came from for the report."""
    import os
    if env.get("GOOGLE_MAPS_API_KEY"):
        return env["GOOGLE_MAPS_API_KEY"], "sandbox/gebeauty/.env"
    if os.environ.get("GOOGLE_MAPS_API_KEY"):
        return os.environ["GOOGLE_MAPS_API_KEY"], "process env"
    return None, None


def shopify_gql(token, query, variables=None):
    body = {"query": query}
    if variables:
        body["variables"] = variables
    url = f"https://{SHOPIFY_SHOP_DOMAIN}/admin/api/{SHOPIFY_API_VERSION}/graphql.json"
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": token,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_state(location_id, live=True):
    """Shell out to nami_control.py state. Stdlib subprocess; we want the same
    auth + endpoint resolution the rest of the workspace uses."""
    cmd = [
        PYTHON_EXE,
        str(SCRIPT_DIR / "nami_control.py"),
        "state",
        "--location",
        location_id,
    ]
    if live:
        cmd.append("--live")
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0 and not proc.stdout:
        return {"ok": False, "error": f"state call failed: {proc.stderr[:300]}"}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"state JSON parse failed: {e}", "stdout": proc.stdout[:500]}


def list_active_route_locations(env):
    """Discover locations that currently have route tags assigned. Two-phase:
       (1) enumerate Shopify locations, (2) state-probe each one. Filter to
       those returning ≥1 route with ≥1 order. Cheap enough for 4 locations."""
    token = env.get("SHOPIFY_ADMIN_ACCESS_TOKEN")
    if not token:
        return None, "SHOPIFY_ADMIN_ACCESS_TOKEN missing — can't enumerate locations"

    resp = shopify_gql(
        token,
        """
        query {
          locations(first: 25, includeInactive: false) {
            edges { node { id name } }
          }
        }
        """,
    )
    if resp.get("errors"):
        return None, f"locations query failed: {resp['errors']}"

    locations = [e["node"] for e in resp["data"]["locations"]["edges"]]
    active = []
    for loc in locations:
        s = fetch_state(loc["id"], live=False)
        if not s.get("ok"):
            continue
        routes = s.get("routes", [])
        if any(r.get("orders") for r in routes):
            active.append(loc["id"])
    return active, None


def slug(name):
    return (name or "location").strip().lower().replace(" ", "_").replace("/", "_")


def derive_pickup_coords(state_resp, env):
    """Try dispatch.stops[0] first (most accurate); fall back to Shopify
       location.address.latitude/longitude."""
    for r in state_resp.get("routes", []):
        d = r.get("dispatch") or {}
        stops = d.get("stops") or []
        if stops and stops[0].get("coordinates"):
            c = stops[0]["coordinates"]
            try:
                return float(c["lat"]), float(c["lng"]), "dispatch.stops[0]"
            except (KeyError, ValueError, TypeError):
                pass

    token = env.get("SHOPIFY_ADMIN_ACCESS_TOKEN")
    loc_id = state_resp.get("location", {}).get("id")
    if not (token and loc_id):
        return None, None, None
    try:
        resp = shopify_gql(
            token,
            "query($id: ID!) { location(id: $id) { address { latitude longitude } } }",
            {"id": loc_id},
        )
        addr = (resp.get("data", {}).get("location") or {}).get("address") or {}
        lat, lng = addr.get("latitude"), addr.get("longitude")
        if lat is not None and lng is not None:
            return float(lat), float(lng), "shopify.location.address"
    except Exception:
        pass
    return None, None, None


def build_static_map_url(pickup, route_groups, api_key, size=DEFAULT_SIZE):
    """route_groups: list of (color, [(lat,lng), ...]) in slot order.
       Markers per route capped at 26 (A..Z); caller logs warnings on overflow.

       Per Google Static Maps API: marker style descriptors must appear BEFORE
       the first coordinate within a `markers=` block. Once a coordinate is
       parsed, the style is locked for the rest of that block — mid-stream
       `label:X` changes are silently ignored OR cause Google to reject the
       URL with `g.co/staticmaperror` (observed 2026-05-09 sweep). To label
       each stop A, B, C, …, we must emit ONE `markers=` parameter per stop.
       URL gets longer but stays well under Google's 16384-char limit for any
       realistic route count."""
    parts = [f"size={size}", "maptype=roadmap"]
    parts.append(f"markers=color:black|label:P|{pickup[0]:.6f},{pickup[1]:.6f}")
    for color, stops in route_groups:
        if not stops:
            continue
        labels = [chr(ord("A") + i) for i in range(min(len(stops), MAX_MARKERS_PER_ROUTE))]
        for label, (lat, lng) in zip(labels, stops):
            parts.append(f"markers=color:{color}|label:{label}|{lat:.6f},{lng:.6f}")
    parts.append(f"key={urllib.parse.quote(api_key, safe='')}")
    return "https://maps.googleapis.com/maps/api/staticmap?" + "&".join(parts)


def render_one_location(state_resp, env, api_key, out_root, dry_run=False):
    location = state_resp.get("location", {})
    loc_id = location.get("id", "")
    loc_name = location.get("name") or loc_id.split("/")[-1]
    loc_slug = slug(loc_name)

    pickup_lat, pickup_lng, pickup_src = derive_pickup_coords(state_resp, env)
    if pickup_lat is None:
        return {
            "ok": False,
            "locationId": loc_id,
            "locationName": loc_name,
            "note": "missing pickup coords (no dispatch and Shopify location lacks lat/lng)",
        }

    route_groups = []
    legend = []
    skipped_orders = []
    overflow_warnings = []
    routes = state_resp.get("routes", [])
    routes_with_orders = [r for r in routes if r.get("orders")]
    for idx, route in enumerate(routes_with_orders):
        color = ROUTE_COLORS[idx] if idx < len(ROUTE_COLORS) else ROUTE_COLORS[-1]
        # Sort by Shopify ID (numeric tail) so labels A,B,C... are stable.
        sorted_orders = sorted(
            route["orders"],
            key=lambda o: int(o["id"].split("/")[-1]) if o.get("id", "").split("/")[-1].isdigit() else 0,
        )
        coords = []
        for o in sorted_orders:
            addr = o.get("address") or {}
            lat, lng = addr.get("lat"), addr.get("lng")
            if lat is None or lng is None:
                skipped_orders.append({
                    "orderName": o.get("name"),
                    "routeTag": route.get("tag"),
                    "reason": "null coords",
                })
                continue
            coords.append((lat, lng))
        if len(coords) > MAX_MARKERS_PER_ROUTE:
            overflow_warnings.append(
                f"{route.get('tag')} has {len(coords)} stops (cap {MAX_MARKERS_PER_ROUTE}); "
                "should not happen under §6.1's 7-cap"
            )
            coords = coords[:MAX_MARKERS_PER_ROUTE]
        route_groups.append((color, coords))
        legend.append({
            "tag": route.get("tag"),
            "color": color,
            "orderCount": len(coords),
        })

    if not any(coords for _, coords in route_groups):
        return {
            "ok": False,
            "locationId": loc_id,
            "locationName": loc_name,
            "note": "no routes with geocoded orders",
        }

    url = build_static_map_url((pickup_lat, pickup_lng), route_groups, api_key)
    out_path = out_root / f"{loc_slug}.png"

    if dry_run:
        return {
            "ok": True,
            "locationId": loc_id,
            "locationName": loc_name,
            "url": url,
            "localPath": str(out_path),
            "pickupSource": pickup_src,
            "legend": legend,
            "routeCount": len(legend),
            "orderCount": sum(l["orderCount"] for l in legend),
            "skippedOrders": skipped_orders,
            "overflowWarnings": overflow_warnings,
            "dryRun": True,
        }

    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = resp.read()
        out_path.write_bytes(data)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        return {
            "ok": False,
            "locationId": loc_id,
            "locationName": loc_name,
            "note": f"download failed HTTP {e.code}: {body}",
            "url": url,
        }
    except Exception as e:
        return {
            "ok": False,
            "locationId": loc_id,
            "locationName": loc_name,
            "note": f"download failed: {e}",
            "url": url,
        }

    return {
        "ok": True,
        "locationId": loc_id,
        "locationName": loc_name,
        "url": url,
        "localPath": str(out_path),
        "pickupSource": pickup_src,
        "legend": legend,
        "routeCount": len(legend),
        "orderCount": sum(l["orderCount"] for l in legend),
        "skippedOrders": skipped_orders,
        "overflowWarnings": overflow_warnings,
    }


def prune_old_folders(maps_root, days=30):
    if not maps_root.exists():
        return 0
    import shutil
    cutoff = date.today() - timedelta(days=days)
    pruned = 0
    for child in maps_root.iterdir():
        if not child.is_dir():
            continue
        try:
            folder_date = date.fromisoformat(child.name)
        except ValueError:
            continue
        if folder_date < cutoff:
            shutil.rmtree(child, ignore_errors=True)
            pruned += 1
    return pruned


def main():
    parser = argparse.ArgumentParser(prog="render_routes_local")
    parser.add_argument("--location", default=None,
                        help="Optional location gid (omit → render every location with active routes)")
    parser.add_argument("--out", default=None,
                        help="Override output dir (default: sandbox/gebeauty/route-maps/YYYY-MM-DD/)")
    parser.add_argument("--prune-days", type=int, default=30,
                        help="Auto-prune older date-folders (default: 30)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Build URLs and print metadata without downloading PNGs")
    args = parser.parse_args()

    env = load_env()
    api_key, key_source = get_google_key(env)
    if not api_key and not args.dry_run:
        print(json.dumps({
            "ok": False,
            "error": "GOOGLE_MAPS_API_KEY missing — checked sandbox/gebeauty/.env and process env",
            "fix": "Add GOOGLE_MAPS_API_KEY=... to sandbox/gebeauty/.env (Static Maps + Geocoding scope) and re-run",
        }, indent=2))
        sys.exit(1)
    if not api_key:
        api_key = "DRY_RUN_NO_KEY"  # used only for URL construction in --dry-run

    if args.location:
        location_ids = [args.location]
    else:
        location_ids, err = list_active_route_locations(env)
        if err:
            print(json.dumps({"ok": False, "error": err}, indent=2))
            sys.exit(1)
        if not location_ids:
            print(json.dumps({"ok": True, "routeMaps": [], "note": "no locations with active routes"}, indent=2))
            sys.exit(0)

    out_root = Path(args.out) if args.out else (WORKSPACE_ROOT / "route-maps" / date.today().isoformat())
    out_root.mkdir(parents=True, exist_ok=True)

    renders = []
    for loc_id in location_ids:
        state_resp = fetch_state(loc_id, live=True)
        if not state_resp.get("ok"):
            renders.append({
                "ok": False,
                "locationId": loc_id,
                "note": f"state call failed: {state_resp.get('error', state_resp)}",
            })
            continue
        result = render_one_location(state_resp, env, api_key, out_root, dry_run=args.dry_run)
        renders.append(result)

    pruned = prune_old_folders(WORKSPACE_ROOT / "route-maps", days=args.prune_days)

    summary = {
        "ok": all(r.get("ok") for r in renders) if renders else True,
        "googleMapsKeySource": key_source or "none (dry run)",
        "outputDir": str(out_root),
        "prunedFolders": pruned,
        "routeMaps": [
            {k: v for k, v in r.items() if k not in ("url",)} | {"url": r.get("url")}
            for r in renders
        ],
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    sys.exit(0 if summary["ok"] else 1)


if __name__ == "__main__":
    main()
