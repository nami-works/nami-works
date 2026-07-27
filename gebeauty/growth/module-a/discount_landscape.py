"""
Module A - discount-code landscape (deliverable 5).

Lists every discount node (active / scheduled / expired) with type, status, code
count, redemptions (asyncUsageCount), window, and a compact description of the
benefit. Read-only. Used to (a) flag naming collisions for proposed campaign codes
and (b) benchmark redemption of past BxGy / % -off / primer promos.

Usage: python discount_landscape.py
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = HERE.parent.parent / ".env"
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

creds = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); creds[k.strip()] = v.strip()
SHOP = creds.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
TOKEN = creds["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API = creds.get("SHOPIFY_API_VERSION", "2026-01")
GQL = f"https://{SHOP}/admin/api/{API}/graphql.json"


def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode()
    req = urllib.request.Request(GQL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    for a in range(6):
        try:
            with urllib.request.urlopen(req) as r:
                out = json.loads(r.read().decode())
            if out.get("errors"): raise RuntimeError(out["errors"])
            return out["data"]
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503): time.sleep(2 ** a); continue
            raise
    raise RuntimeError("retries exhausted")

Q = """
query($cursor:String){
 discountNodes(first:250, after:$cursor){
  pageInfo{hasNextPage endCursor}
  nodes{
   id
   discount{
    __typename
    ... on DiscountCodeBasic { title status startsAt endsAt asyncUsageCount usageLimit
      codes(first:3){nodes{code}} codesCount{count}
      customerGets{ value{ __typename
        ... on DiscountPercentage{percentage}
        ... on DiscountAmount{amount{amount}} } } }
    ... on DiscountCodeBxgy { title status startsAt endsAt asyncUsageCount usageLimit
      codes(first:3){nodes{code}} codesCount{count} }
    ... on DiscountCodeFreeShipping { title status startsAt endsAt asyncUsageCount
      codes(first:3){nodes{code}} codesCount{count} }
    ... on DiscountAutomaticBasic { title status startsAt endsAt asyncUsageCount }
    ... on DiscountAutomaticBxgy { title status startsAt endsAt asyncUsageCount }
    ... on DiscountAutomaticFreeShipping { title status startsAt endsAt asyncUsageCount }
   }
  }
 }
}
"""

def main():
    cursor = None
    rows = []
    while True:
        d = gql(Q, {"cursor": cursor})["discountNodes"]
        for n in d["nodes"]:
            dc = n["discount"]
            code = None
            cc = dc.get("codesCount")
            codes = [c["code"] for c in (dc.get("codes") or {}).get("nodes", [])]
            gets = ""
            cg = dc.get("customerGets")
            if cg and cg.get("value"):
                v = cg["value"]
                if v.get("__typename") == "DiscountPercentage":
                    gets = f"{round(v['percentage']*100)}% off"
                elif v.get("__typename") == "DiscountAmount":
                    gets = f"R${v['amount']['amount']} off"
            rows.append({
                "type": dc["__typename"],
                "title": dc.get("title"),
                "status": dc.get("status"),
                "codes_sample": codes,
                "codes_count": (cc or {}).get("count") if isinstance(cc, dict) else cc,
                "redemptions": dc.get("asyncUsageCount"),
                "usage_limit": dc.get("usageLimit"),
                "gets": gets,
                "starts": dc.get("startsAt"),
                "ends": dc.get("endsAt"),
            })
        if not d["pageInfo"]["hasNextPage"]: break
        cursor = d["pageInfo"]["endCursor"]

    (HERE / "discounts.out.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"total discount nodes: {len(rows)}")
    from collections import Counter
    print("by status:", dict(Counter(r["status"] for r in rows)))
    print("by type:", dict(Counter(r["type"] for r in rows)))
    print("\n=== ACTIVE / SCHEDULED ===")
    for r in sorted(rows, key=lambda x: -(x["redemptions"] or 0)):
        if r["status"] in ("ACTIVE", "SCHEDULED"):
            print(f"[{r['status']:9s}] {r['type'][:22]:22s} {str(r['codes_sample'])[:40]:40s} {r['gets']:10s} redeem={r['redemptions']} ends={r['ends']}")
    print("\n=== TOP REDEEMED (any status) - benchmark ===")
    for r in sorted(rows, key=lambda x: -(x["redemptions"] or 0))[:40]:
        t = (r["title"] or (r["codes_sample"][0] if r["codes_sample"] else ""))[:36]
        print(f"{r['redemptions'] or 0:>7} | {r['status']:9s} | {r['type'][:20]:20s} | {r['gets']:10s} | {t}")

if __name__ == "__main__":
    main()
