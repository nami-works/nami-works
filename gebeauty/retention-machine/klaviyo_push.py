"""
Klaviyo profile-property push — store_credit + credit_expiry (+ first_name) for the winback broadcast.

Live-reads Shopify (post-consolidation balances) for every SEND holder (both waves), keeps those with
LIVE balance > 0 and an email, formats store_credit as "R$ 85,90" + credit_expiry "17/07", and upserts
them to Klaviyo profiles (bulk import job, matched by email).

  python klaviyo_push.py            # DRY RUN: count + sample, writes learning/klaviyo-enrichment.jsonl. No Klaviyo calls.
  python klaviyo_push.py --apply    # push to Klaviyo (bulk profile-import jobs, <=10k/job)
"""
import json, sys, time, argparse, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
SENDS = HERE / "learning" / "sends.jsonl"
ENRICH = HERE / "learning" / "klaviyo-enrichment.jsonl"
WAVES = {"2026-07-06-ge60d", "2026-07-07-ge45-59d-refill"}
CREDIT_EXPIRY = "17/07"
KLAVIYO_REVISION = "2024-10-15"

def log(*a): print(*a); sys.stdout.flush()
env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
SURL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
STOK = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
def sgql(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(SURL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": STOK})
    return json.loads(urllib.request.urlopen(r).read().decode())

def brl(x): return ("R$ %.2f" % float(x)).replace(".", ",")

def send_gids():
    seen = set(); out = []
    for line in SENDS.open(encoding="utf-8"):
        o = json.loads(line)
        if o.get("wave") in WAVES and o.get("arm") == "SEND" and o.get("customer_gid") not in seen:
            seen.add(o["customer_gid"]); out.append(o["customer_gid"])
    return out

Q = """query($ids:[ID!]!){nodes(ids:$ids){... on Customer{id email firstName
  storeCreditAccounts(first:5){nodes{balance{amount}}}}}}"""

def build_enrichment():
    gids = send_gids()
    log(f"SEND holders (both waves): {len(gids)}")
    rows = []; no_email = 0; zero = 0
    B = 200
    for i in range(0, len(gids), B):
        chunk = gids[i:i + B]
        for attempt in range(4):
            try:
                d = sgql(Q, {"ids": chunk}); nodes = d["data"]["nodes"]; break
            except Exception as e:
                log(f"  batch {i//B} retry {attempt}: {repr(e)[:80]}"); time.sleep(2 * (attempt + 1))
        else:
            continue
        for n in nodes:
            if not n: continue
            bal = round(sum(float(x["balance"]["amount"]) for x in n["storeCreditAccounts"]["nodes"]), 2)
            if bal <= 0: zero += 1; continue
            em = (n.get("email") or "").strip()
            if not em: no_email += 1; continue
            rows.append({"email": em, "first_name": n.get("firstName") or "",
                         "store_credit": brl(bal), "credit_expiry": CREDIT_EXPIRY})
        if (i // B) % 10 == 0:
            log(f"  scanned {min(i+B,len(gids))}/{len(gids)}  holders={len(rows)}"); time.sleep(0.4)
    ENRICH.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    log(f"\nlive holders (balance>0, w/ email): {len(rows)}   zero-balance skipped: {zero}   no-email skipped: {no_email}")
    log(f"enrichment -> {ENRICH.name}")
    log("sample:")
    for r in rows[:6]: log(f"  {r['email']:38} {r['store_credit']:>10}  exp {r['credit_expiry']}  ({r['first_name']})")
    return rows

def klaviyo_push(rows):
    KEY = env["KLAVIYO_API_KEY"]
    URL = "https://a.klaviyo.com/api/profile-bulk-import-jobs/"
    for i in range(0, len(rows), 10000):
        chunk = rows[i:i + 10000]
        profiles = [{"type": "profile", "attributes": {"email": r["email"],
                     "properties": {"store_credit": r["store_credit"]}}}  # expiry hardcoded in email
                    for r in chunk]
        body = {"data": {"type": "profile-bulk-import-job", "attributes": {"profiles": {"data": profiles}}}}
        req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={
            "Authorization": f"Klaviyo-API-Key {KEY}", "revision": KLAVIYO_REVISION,
            "Content-Type": "application/vnd.api+json", "accept": "application/vnd.api+json"})
        try:
            with urllib.request.urlopen(req) as r:
                resp = json.loads(r.read().decode()); jid = resp.get("data", {}).get("id")
                log(f"  job {i//10000}: {r.status} id={jid} ({len(chunk)} profiles)")
        except urllib.error.HTTPError as e:
            log(f"  job {i//10000}: HTTP {e.code} {e.read().decode('utf-8','ignore')[:300]}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--from-file", action="store_true", help="push the existing enrichment file, skip the Shopify re-scan")
    args = ap.parse_args()
    if args.from_file and ENRICH.exists():
        rows = [json.loads(l) for l in ENRICH.open(encoding="utf-8") if l.strip()]
        log(f"loaded {len(rows)} rows from {ENRICH.name} (no Shopify re-scan)")
    else:
        rows = build_enrichment()
    if not args.apply:
        log("\n[dry run] no Klaviyo calls. Re-run with --apply to push these to Klaviyo profiles.")
        return
    log(f"\n[apply] pushing {len(rows)} profiles to Klaviyo (bulk import)…")
    klaviyo_push(rows)
    log("[done] bulk import job(s) submitted. Klaviyo processes async; check Profiles in a few minutes.")

if __name__ == "__main__":
    main()
