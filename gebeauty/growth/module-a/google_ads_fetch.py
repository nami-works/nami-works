"""
Module A - Google Ads pull (REST + urllib, read-only).

Answers H1: how much of Google's efficiency is branded search (harvesting demand) vs
non-branded (true acquisition headroom). Pulls campaign spend/ROAS + the search-term
breakdown, classifies each query branded vs non-branded, and prints the split.

Auth from gebeauty/.env (mint with google_ads_auth.py first):
  GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
  GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID, [GOOGLE_ADS_LOGIN_CUSTOMER_ID]

Usage:
  python google_ads_fetch.py --days 30
  python google_ads_fetch.py --since 2026-06-01 --until 2026-07-01 --out gads-jun.json

NOTE: untested until real creds exist. Confirm GOOGLE_ADS_API_VERSION against
https://developers.google.com/google-ads/api/docs/release-notes before first run.
"""
import argparse
import datetime as dt
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = HERE.parents[1] / ".env"  # gebeauty/.env
API_VERSION = "v21"  # v18/v19 = 404 retired; v20 deprecated/blocked (probed 2026-07-22)
TOKEN_URI = "https://oauth2.googleapis.com/token"

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Queries that count as BRANDED (harvesting existing demand). Lowercased substring match.
BRAND_TERMS = ["ge beauty", "gebeauty", "ge beaty", "ge beleza", "primer cachos",
               "primer liso", "melon mood", "beautyback"]


def load_env():
    creds = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            creds[k.strip()] = v.strip()
    return creds


def access_token(creds):
    data = urllib.parse.urlencode({
        "client_id": creds["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": creds["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": creds["GOOGLE_ADS_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request(TOKEN_URI, data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())["access_token"]


def gaql(creds, token, query):
    cid = "".join(ch for ch in creds["GOOGLE_ADS_CUSTOMER_ID"] if ch.isdigit())
    url = f"https://googleads.googleapis.com/{API_VERSION}/customers/{cid}/googleAds:searchStream"
    headers = {
        "Authorization": f"Bearer {token}",
        "developer-token": creds["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "Content-Type": "application/json",
    }
    login = "".join(ch for ch in creds.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "") if ch.isdigit())
    if login:
        headers["login-customer-id"] = login
    req = urllib.request.Request(url, data=json.dumps({"query": query}).encode(),
                                 headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            batches = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"Google Ads API {e.code} on {API_VERSION}:\n{e.read().decode()[:900]}")
    rows = []
    for b in batches:
        rows.extend(b.get("results", []))
    return rows


def is_branded(term):
    t = (term or "").lower()
    return any(bt in t for bt in BRAND_TERMS)


def brl(micros):
    return round(int(micros or 0) / 1_000_000, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--since")
    ap.add_argument("--until")
    ap.add_argument("--out", default="gads-read.json")
    args = ap.parse_args()

    if args.since:
        where = f"segments.date BETWEEN '{args.since}' AND '{args.until or dt.date.today().isoformat()}'"
    else:
        where = f"segments.date DURING LAST_{args.days}_DAYS" if args.days in (7, 14, 30) \
            else f"segments.date >= '{(dt.date.today()-dt.timedelta(days=args.days)).isoformat()}'"

    creds = load_env()
    missing = [k for k in ("GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID",
               "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN",
               "GOOGLE_ADS_CUSTOMER_ID") if not creds.get(k)]
    if missing:
        print("Missing in gebeauty/.env:", ", ".join(missing))
        print("Run google_ads_auth.py + get the dev token / customer id first.")
        sys.exit(1)

    token = access_token(creds)

    camp_q = ("SELECT campaign.name, campaign.id, metrics.cost_micros, metrics.conversions, "
              "metrics.conversions_value, metrics.impressions, metrics.clicks "
              f"FROM campaign WHERE {where} AND metrics.cost_micros > 0")
    term_q = ("SELECT search_term_view.search_term, campaign.name, metrics.cost_micros, "
              "metrics.conversions, metrics.conversions_value "
              f"FROM search_term_view WHERE {where} AND metrics.cost_micros > 0")

    camps = gaql(creds, token, camp_q)
    terms = gaql(creds, token, term_q)

    campaigns = [{
        "name": r["campaign"]["name"],
        "spend": brl(r["metrics"].get("costMicros")),
        "conversions": round(float(r["metrics"].get("conversions", 0)), 2),
        "conv_value": round(float(r["metrics"].get("conversionsValue", 0)), 2),
    } for r in camps]

    split = {"branded": {"spend": 0.0, "conv": 0.0, "value": 0.0, "terms": 0},
             "nonbranded": {"spend": 0.0, "conv": 0.0, "value": 0.0, "terms": 0}}
    for r in terms:
        term = r["searchTermView"]["searchTerm"]
        b = "branded" if is_branded(term) else "nonbranded"
        split[b]["spend"] += brl(r["metrics"].get("costMicros"))
        split[b]["conv"] += float(r["metrics"].get("conversions", 0))
        split[b]["value"] += float(r["metrics"].get("conversionsValue", 0))
        split[b]["terms"] += 1

    for k in split:
        s = split[k]
        s["spend"] = round(s["spend"], 2); s["conv"] = round(s["conv"], 1)
        s["value"] = round(s["value"], 2)
        s["roas"] = round(s["value"] / s["spend"], 2) if s["spend"] else None

    total_spend = round(sum(c["spend"] for c in campaigns), 2)
    result = {"window": where, "total_spend": total_spend,
              "campaigns": sorted(campaigns, key=lambda c: -c["spend"]), "branded_split": split}
    (HERE / args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n=== GOOGLE ADS ({where}) ===")
    print(f"total spend: R${total_spend:,.0f}  across {len(campaigns)} campaigns")
    for k in ("branded", "nonbranded"):
        s = split[k]
        sh = (s["spend"] / (split['branded']['spend'] + split['nonbranded']['spend']) * 100) \
            if (split['branded']['spend'] + split['nonbranded']['spend']) else 0
        print(f"  {k:11s} spend R${s['spend']:,.0f} ({sh:.0f}%)  ROAS {s['roas']}  ({s['terms']} terms)")
    print("H1 read: high branded share => Google is largely harvesting demand, not creating it.")
    print(f"\nwrote {HERE/args.out}  (verify API_VERSION={API_VERSION} if it 404s)")


if __name__ == "__main__":
    main()
