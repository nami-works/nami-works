"""
CPG Labs Control API client — Python wrapper for
/api/control/* endpoints on the deployed app.

Lets Claude Code (or any script) observe + drive the Local Delivery
pipeline without going through the embedded UI.

Env vars (add to sandbox/gebeauty/.env):
  CPG_LABS_CONTROL_URL    — base URL, e.g. https://omnify.cpg-labs.io/full
  CPG_LABS_CONTROL_TOKEN  — bearer token matching the server env

Usage (MVP):
  python cpg_control.py state --location gid://shopify/Location/97784398144
  python cpg_control.py unassign --route ld_rota-02 --orders gid://... gid://...

Programmatic:
  from cpg_control import Control
  c = Control()
  state = c.state(location_id)
  c.unassign("ld_rota-02", ["gid://shopify/Order/..."])
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

SCRIPT_DIR = Path(__file__).parent.resolve()
WORKSPACE_ROOT = SCRIPT_DIR.parent


def load_env():
    env_path = WORKSPACE_ROOT / ".env"
    env = {}
    with env_path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Control:
    def __init__(self, base_url=None, token=None):
        env = load_env()
        self.base_url = (base_url or env.get("CPG_LABS_CONTROL_URL") or "").rstrip("/")
        self.token = token or env.get("CPG_LABS_CONTROL_TOKEN")
        if not self.base_url or not self.token:
            sys.exit(
                "Missing CPG_LABS_CONTROL_URL or CPG_LABS_CONTROL_TOKEN in .env. "
                "See cpg_control.py docstring."
            )

    def _request(self, method, path, body=None):
        url = f"{self.base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                return payload
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")[:500]
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = {"ok": False, "error": f"HTTP {e.code}: {raw}"}
            parsed.setdefault("status", e.code)
            return parsed

    def state(self, location_id, live=False):
        qs = f"locationId={urllib.parse.quote(location_id)}"
        if live:
            qs += "&live=true"
        return self._request("GET", f"/api/control/state?{qs}")

    def unassign(self, route_tag, order_ids):
        return self._request("POST", "/api/control/unassign", {
            "routeTag": route_tag,
            "orderIds": order_ids,
        })

    def dispatch(self, location_id, route_index):
        return self._request("POST", "/api/control/dispatch", {
            "locationId": location_id,
            "routeIndex": route_index,
        })

    def optimize(self, location_id, max_per_route=None, flag_address_issues=True):
        body = {"locationId": location_id, "flagAddressIssues": flag_address_issues}
        if max_per_route is not None:
            body["maxPerRoute"] = max_per_route
        return self._request("POST", "/api/control/optimize", body)

    def reorder(self, location_id, route_index):
        return self._request("POST", "/api/control/reorder", {
            "locationId": location_id,
            "routeIndex": route_index,
        })

    def mark_delivered(self, location_id, route_index, cancel_pending_lalamove=True,
                       create_shopify_fulfillment=True, notify_customer=False):
        return self._request("POST", "/api/control/mark-delivered", {
            "locationId": location_id,
            "routeIndex": route_index,
            "cancelPendingLalamove": cancel_pending_lalamove,
            "createShopifyFulfillment": create_shopify_fulfillment,
            "notifyCustomer": notify_customer,
        })

    def check_dispatches(self):
        return self._request("POST", "/api/control/check-dispatches", {})

    def quote(self, location_id, routes):
        """routes: list of lists of order gids. Each inner list is one route to price-check."""
        return self._request("POST", "/api/control/quote", {
            "locationId": location_id,
            "routes": [{"orderIds": r} for r in routes],
        })

    def render_routes(self, location_id=None):
        body = {}
        if location_id:
            body["locationId"] = location_id
        return self._request("POST", "/api/control/render-routes", body)

    def close_route(self, location_id, route_index):
        """Phase A: archive ld_rota tags + mark DB job FULFILLED. No Shopify fulfillment."""
        return self._request("POST", "/api/control/close-route", {
            "locationId": location_id,
            "routeIndex": route_index,
        })

    def fulfill_route(self, location_id, route_index, notify_customer=False):
        """Phase B: create Shopify fulfillment + DELIVERED event. Tags already archived."""
        return self._request("POST", "/api/control/fulfill-route", {
            "locationId": location_id,
            "routeIndex": route_index,
            "notifyCustomer": notify_customer,
        })

    def mark_all_today(self, location_id, notify_customer=False):
        return self._request("POST", "/api/control/mark-all-today", {
            "locationId": location_id,
            "notifyCustomer": notify_customer,
        })


# urllib.parse was used above; import at top to keep reads consistent
import urllib.parse  # noqa: E402


def main():
    parser = argparse.ArgumentParser(prog="cpg_control")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_state = sub.add_parser("state", help="Read current routes state at a location")
    p_state.add_argument("--location", required=True, help="Location gid or legacy id")
    p_state.add_argument("--live", action="store_true", help="Refresh active dispatches via Lalamove API (adds ~1-2s per route)")

    p_un = sub.add_parser("unassign", help="Remove a route tag from one or more orders")
    p_un.add_argument("--route", required=True, help="Route tag, e.g. ld_rota-02")
    p_un.add_argument("--orders", nargs="+", required=True, help="Order gids")

    p_disp = sub.add_parser("dispatch", help="Place a Lalamove order for one route")
    p_disp.add_argument("--location", required=True, help="Location gid")
    p_disp.add_argument("--route-index", type=int, required=True, help="Route index (0-based, so Route 01 = 0)")

    p_opt = sub.add_parser("optimize", help="Cluster unassigned LOCAL orders at a location into routes")
    p_opt.add_argument("--location", required=True, help="Location gid")
    p_opt.add_argument("--max-per-route", type=int, default=None, help="Cap orders per route (default 10)")
    p_opt.add_argument("--no-flag-addresses", action="store_true", help="Skip tagging ld_address_review on problematic orders")

    p_ro = sub.add_parser("reorder", help="Cancel active Lalamove dispatch and re-request a new driver")
    p_ro.add_argument("--location", required=True, help="Location gid")
    p_ro.add_argument("--route-index", type=int, required=True, help="Route index (0-based)")

    p_md = sub.add_parser("mark-delivered", help="Close route outside the webhook flow (archives tags, marks job FULFILLED)")
    p_md.add_argument("--location", required=True, help="Location gid")
    p_md.add_argument("--route-index", type=int, required=True, help="Route index (0-based)")
    p_md.add_argument("--keep-lalamove", action="store_true", help="Do NOT cancel the pending Lalamove order (default: cancel)")
    p_md.add_argument("--skip-shopify-fulfillment", action="store_true", help="Do NOT create a Shopify fulfillment (default: creates one, flipping order status to Fulfilled)")
    p_md.add_argument("--notify-customer", action="store_true", help="Trigger Shopify's customer notification email when fulfilling (default: off)")

    p_cd = sub.add_parser("check-dispatches", help="Poll driver GPS on all in-flight dispatches; flag drivers not approaching the pickup (suggests reorder after 3 consecutive non-approach samples)")

    p_qt = sub.add_parser("quote", help="Price-check one or more route compositions without placing an order")
    p_qt.add_argument("--location", required=True, help="Location gid")
    p_qt.add_argument("--route", action="append", required=True,
                      help="Comma-separated order gids for one route. Repeat for multiple routes.")

    p_rr = sub.add_parser("render-routes", help="Render Google Static Maps PNGs (one per active-route location) so Claude can spatially review the clustering. Downloads to sandbox/gebeauty/route-maps/YYYY-MM-DD/.")
    p_rr.add_argument("--location", default=None, help="Optional location gid (omit to render all)")
    p_rr.add_argument("--output-dir", default=None, help="Override output directory (default: sandbox/gebeauty/route-maps/YYYY-MM-DD/)")
    p_rr.add_argument("--prune-days", type=int, default=30, help="Auto-prune older date-folders (default: 30)")

    p_cr = sub.add_parser("close-route", help="Phase A: archive ld_rota tags (ld_rota-NN → ld_rota-NN_YY.MM.DD) and close DB job. No Shopify fulfillment.")
    p_cr.add_argument("--location", required=True, help="Location gid")
    p_cr.add_argument("--route-index", type=int, required=True, help="Route index (0-based)")

    p_fr = sub.add_parser("fulfill-route", help="Phase B: create Shopify fulfillment + DELIVERED event for orders in this route. Tags already archived by close-route.")
    p_fr.add_argument("--location", required=True, help="Location gid")
    p_fr.add_argument("--route-index", type=int, required=True, help="Route index (0-based)")
    p_fr.add_argument("--notify-customer", action="store_true", help="Trigger Shopify customer notification email (default off)")

    p_mat = sub.add_parser("mark-all-today", help="Close EVERY dispatch job from the last 24h at a location (fulfill + DELIVERED event)")
    p_mat.add_argument("--location", required=True, help="Location gid")
    p_mat.add_argument("--notify-customer", action="store_true", help="Trigger customer notification emails (default: off)")

    args = parser.parse_args()
    ctrl = Control()

    if args.cmd == "state":
        result = ctrl.state(args.location, live=args.live)
    elif args.cmd == "unassign":
        result = ctrl.unassign(args.route, args.orders)
    elif args.cmd == "dispatch":
        result = ctrl.dispatch(args.location, args.route_index)
    elif args.cmd == "optimize":
        result = ctrl.optimize(
            args.location,
            max_per_route=args.max_per_route,
            flag_address_issues=not args.no_flag_addresses,
        )
        # Always render Google Static Maps PNGs after a successful optimize so
        # Claude can Read them and apply spatial reasoning the coordinate-math
        # centroid rule misses (water barriers, neighborhood gravity, traffic
        # corridors). User chose "always after optimize" trigger on 2026-04-23.
        if result.get("ok"):
            try:
                from datetime import date, timedelta
                import shutil
                render_res = ctrl.render_routes(location_id=args.location)
                if render_res.get("ok"):
                    base_root = WORKSPACE_ROOT / "route-maps" / date.today().isoformat()
                    base_root.mkdir(parents=True, exist_ok=True)
                    downloaded = []
                    for r in render_res.get("renders", []):
                        if not r.get("url"): continue
                        loc_slug = (r.get("locationName") or r.get("locationId","")).split("/")[-1].replace(" ","_").lower()
                        png_path = base_root / f"{loc_slug}.png"
                        try:
                            with urllib.request.urlopen(r["url"], timeout=30) as resp:
                                png_path.write_bytes(resp.read())
                            downloaded.append(str(png_path))
                        except Exception as e:
                            downloaded.append(f"(failed {loc_slug}: {e})")
                    # Prune folders older than 30 days
                    maps_root = WORKSPACE_ROOT / "route-maps"
                    cutoff = date.today() - timedelta(days=30)
                    for child in maps_root.iterdir() if maps_root.exists() else []:
                        if not child.is_dir(): continue
                        try:
                            if date.fromisoformat(child.name) < cutoff:
                                shutil.rmtree(child, ignore_errors=True)
                        except ValueError: pass
                    result["routeMaps"] = downloaded
            except Exception as e:
                result["routeMapsError"] = str(e)[:200]
    elif args.cmd == "reorder":
        result = ctrl.reorder(args.location, args.route_index)
    elif args.cmd == "mark-delivered":
        result = ctrl.mark_delivered(
            args.location,
            args.route_index,
            cancel_pending_lalamove=not args.keep_lalamove,
            create_shopify_fulfillment=not args.skip_shopify_fulfillment,
            notify_customer=args.notify_customer,
        )
    elif args.cmd == "render-routes":
        from datetime import date, datetime, timedelta
        import shutil
        res = ctrl.render_routes(location_id=args.location)
        if not res.get("ok"):
            print(json.dumps(res, indent=2, ensure_ascii=False))
            sys.exit(1)
        base_root = Path(args.output_dir) if args.output_dir else (WORKSPACE_ROOT / "route-maps" / date.today().isoformat())
        base_root.mkdir(parents=True, exist_ok=True)
        downloaded = []
        for r in res.get("renders", []):
            if not r.get("url"):
                note = r.get("note", "")
                print(f"  {r.get('locationName') or r.get('locationId')}: skip ({note})")
                continue
            loc_slug = (r.get("locationName") or r.get("locationId","")).split("/")[-1].replace(" ","_").lower()
            png_path = base_root / f"{loc_slug}.png"
            try:
                with urllib.request.urlopen(r["url"], timeout=30) as resp:
                    png_path.write_bytes(resp.read())
                legend_bits = ", ".join(f"{l['tag']}={l['color']} ({l['orderCount']})" for l in r.get("legend",[]))
                print(f"  {r.get('locationName') or loc_slug}: {png_path} · {r.get('routeCount')} routes · {r.get('orderCount')} orders · {legend_bits}")
                downloaded.append(str(png_path))
            except Exception as e:
                print(f"  {r.get('locationName') or loc_slug}: DOWNLOAD FAILED {e}")
        # Prune old date-folders
        maps_root = WORKSPACE_ROOT / "route-maps"
        if maps_root.exists():
            cutoff = date.today() - timedelta(days=args.prune_days)
            pruned = 0
            for child in maps_root.iterdir():
                if not child.is_dir(): continue
                try:
                    folder_date = date.fromisoformat(child.name)
                except ValueError:
                    continue
                if folder_date < cutoff:
                    shutil.rmtree(child, ignore_errors=True)
                    pruned += 1
            if pruned > 0:
                print(f"pruned {pruned} route-map folder(s) older than {args.prune_days}d")
        result = {"ok": True, "downloaded": downloaded, "renders": res.get("renders", [])}
    elif args.cmd == "close-route":
        result = ctrl.close_route(args.location, args.route_index)
    elif args.cmd == "fulfill-route":
        result = ctrl.fulfill_route(args.location, args.route_index, notify_customer=args.notify_customer)
    elif args.cmd == "mark-all-today":
        result = ctrl.mark_all_today(args.location, notify_customer=args.notify_customer)
    elif args.cmd == "check-dispatches":
        result = ctrl.check_dispatches()
    elif args.cmd == "quote":
        routes = [[oid.strip() for oid in r.split(",") if oid.strip()] for r in args.route]
        result = ctrl.quote(args.location, routes)
    else:
        sys.exit(f"Unknown command: {args.cmd}")

    print(json.dumps(result, indent=2, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
