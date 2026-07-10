#!/usr/bin/env python3
"""
gsc_fetch.py — pull GE Beauty's REAL search performance from Google Search Console.
FREE (first-party Google data). Stdlib only (urllib). The highest-leverage,
zero-cost keyword source: actual queries, impressions, clicks, CTR, and position
for the brand's own pages.

AUTH (dependency-free OAuth refresh-token flow — no RSA signing, no google libs):
  One-time setup, then put these in sandbox/<tenant>/.env:
    GSC_CLIENT_ID=...
    GSC_CLIENT_SECRET=...
    GSC_REFRESH_TOKEN=...
    GSC_SITE_URL=sc-domain:gebeauty.com.br      # or https://gebeauty.com.br/
  The script exchanges the refresh token for a short-lived access token over HTTPS.
  Until those vars exist, it prints setup instructions and exits 0 (so the skill
  knows GSC is not yet wired) — same ship-now / activate-later pattern as the
  keyword accelerator.

REPORTS:
  striking  positions 11-20, sorted by impressions  -> one refresh from page 1
  lowctr    positions <=10, high impressions, low CTR -> rewrite title/meta
  top       top queries by clicks
  raw       query x page rows (for custom analysis)

Usage:
  python gsc_fetch.py --tenant gebeauty --report striking
  python gsc_fetch.py --report lowctr --days 90 --min-impressions 100
  python gsc_fetch.py --report raw --days 180 --out gsc.json
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
TOKEN_URL = "https://oauth2.googleapis.com/token"
GSC_API = "https://www.googleapis.com/webmasters/v3/sites"

SETUP = """\
GSC not configured. To enable this FREE first-party data source (one-time):

  1. In Google Cloud Console: create a project, enable the "Search Console API".
  2. Create an OAuth client ID of type "Desktop app". Note client_id + client_secret.
  3. Mint a refresh token once (e.g. via the OAuth Playground at
     developers.google.com/oauthplayground using scope
     https://www.googleapis.com/auth/webmasters.readonly, with your own client),
     OR any one-time consent flow. Copy the refresh_token.
  4. Ensure the Google account is a verified owner/full user of the GSC property
     for gebeauty.com.br.
  5. Add to sandbox/<tenant>/.env:
       GSC_CLIENT_ID=...
       GSC_CLIENT_SECRET=...
       GSC_REFRESH_TOKEN=...
       GSC_SITE_URL=sc-domain:gebeauty.com.br
"""


def load_env(tenant: str) -> dict:
    env_path = REPO_ROOT / "sandbox" / tenant / ".env"
    if not env_path.exists():
        return {}
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_access_token(env: dict) -> str:
    body = urllib.parse.urlencode({
        "client_id": env["GSC_CLIENT_ID"],
        "client_secret": env["GSC_CLIENT_SECRET"],
        "refresh_token": env["GSC_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode("utf-8")
    req = urllib.request.Request(TOKEN_URL, data=body,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))["access_token"]
    except urllib.error.HTTPError as e:
        sys.exit(f"OAuth token error {e.code}: {e.read().decode('utf-8', 'ignore')}")


def query_gsc(token: str, site: str, start: str, end: str, dimensions: list,
              row_limit: int = 25000) -> list:
    url = f"{GSC_API}/{urllib.parse.quote(site, safe='')}/searchAnalytics/query"
    rows, start_row = [], 0
    while True:
        body = json.dumps({
            "startDate": start, "endDate": end, "dimensions": dimensions,
            "rowLimit": row_limit, "startRow": start_row,
        }).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={
            "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            sys.exit(f"GSC query error {e.code}: {e.read().decode('utf-8', 'ignore')}")
        batch = data.get("rows", [])
        rows.extend(batch)
        if len(batch) < row_limit:
            break
        start_row += row_limit
    return rows


def to_record(row: dict, dimensions: list) -> dict:
    rec = {dim: row["keys"][i] for i, dim in enumerate(dimensions)}
    rec.update({"clicks": row.get("clicks", 0), "impressions": row.get("impressions", 0),
                "ctr": round(row.get("ctr", 0), 4), "position": round(row.get("position", 0), 1)})
    return rec


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Fetch GE Beauty search performance from Google Search Console (free).")
    ap.add_argument("--tenant", default="gebeauty")
    ap.add_argument("--report", default="striking", choices=["striking", "lowctr", "top", "raw"])
    ap.add_argument("--days", type=int, default=90, help="lookback window (max ~480)")
    ap.add_argument("--site", help="override GSC_SITE_URL")
    ap.add_argument("--min-impressions", type=int, default=50)
    ap.add_argument("--max-ctr", type=float, default=0.02, help="lowctr threshold")
    ap.add_argument("--limit", type=int, default=50, help="rows to return in the report")
    ap.add_argument("--out")
    args = ap.parse_args()

    env = load_env(args.tenant)
    required = ["GSC_CLIENT_ID", "GSC_CLIENT_SECRET", "GSC_REFRESH_TOKEN"]
    if not all(env.get(k) for k in required):
        print(SETUP)
        return
    site = args.site or env.get("GSC_SITE_URL")
    if not site:
        sys.exit("ERROR: no GSC_SITE_URL in .env and no --site provided.")

    end = date.today() - timedelta(days=3)      # GSC data lags ~2-3 days
    start = end - timedelta(days=min(args.days, 480))
    token = get_access_token(env)

    dims = ["query", "page"] if args.report == "raw" else ["query"]
    rows = [to_record(r, dims) for r in query_gsc(token, site, start.isoformat(), end.isoformat(), dims)]

    if args.report == "raw":
        report = rows
    elif args.report == "striking":
        report = sorted([r for r in rows if 10.5 <= r["position"] <= 20.5
                         and r["impressions"] >= args.min_impressions],
                        key=lambda r: r["impressions"], reverse=True)[:args.limit]
    elif args.report == "lowctr":
        report = sorted([r for r in rows if r["position"] <= 10.5
                         and r["impressions"] >= args.min_impressions
                         and r["ctr"] <= args.max_ctr],
                        key=lambda r: r["impressions"], reverse=True)[:args.limit]
    else:  # top
        report = sorted(rows, key=lambda r: r["clicks"], reverse=True)[:args.limit]

    payload = json.dumps({
        "report": args.report, "site": site,
        "range": {"start": start.isoformat(), "end": end.isoformat()},
        "count": len(report), "rows": report,
    }, ensure_ascii=False, indent=2)

    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
        print(f"Wrote {args.report} report ({len(report)} rows) to {args.out}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
