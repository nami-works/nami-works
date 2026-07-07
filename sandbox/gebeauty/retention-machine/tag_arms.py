"""
Tag each customer in the learning cohort with a wave+arm tag, so Shopify customer
segments / reports can compare SEND vs HOLD natively (in-Admin), alongside the
precise API measurement in measure_reactivation.py.

Source of truth = learning/sends.jsonl (frozen arms per wave). Tag map:
  2026-07-06-ge60d          SEND -> wave-reactivation-send-2026-07-06
  2026-07-06-ge60d          HOLD -> wave-reactivation-hold-2026-07-06
  2026-07-07-ge45-59d-refill SEND -> wave-refill-send-2026-07-07
  2026-07-07-ge45-59d-refill HOLD -> wave-refill-hold-2026-07-07

Tags are exact strings; the email branch checks the EXACT tag 'credit-reactivation'
(Liquid array `contains` = exact element), so these markers never affect rendering.

Idempotent (tagsAdd of an existing tag is a no-op) + resumable via state file.
  python tag_arms.py           # dry run: counts per tag
  python tag_arms.py --apply   # apply (batched, resumable)
"""
import json, sys, time, argparse, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
SENDS = HERE / "learning" / "sends.jsonl"
STATE = HERE / "tag-arms-state.json"

TAGMAP = {
    ("2026-07-06-ge60d", "SEND"): "wave-reactivation-send-2026-07-06",
    ("2026-07-06-ge60d", "HOLD"): "wave-reactivation-hold-2026-07-06",
    ("2026-07-07-ge45-59d-refill", "SEND"): "wave-refill-send-2026-07-07",
    ("2026-07-07-ge45-59d-refill", "HOLD"): "wave-refill-hold-2026-07-07",
}
# Stable, undated program tags (both arms) - survive dated-tag pruning; for long-term revenue
# following + suppression. Rigorous per-wave lift still comes from dated tags / sends.jsonl.
STABLEMAP = {
    ("2026-07-06-ge60d", "SEND"): "retention-credit-reactivation-send",
    ("2026-07-06-ge60d", "HOLD"): "retention-credit-reactivation-hold",
    ("2026-07-07-ge45-59d-refill", "SEND"): "retention-credit-refill-send",
    ("2026-07-07-ge45-59d-refill", "HOLD"): "retention-credit-refill-hold",
}
STATE_STABLE = HERE / "tag-arms-stable-state.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def log(*a): print(*a); sys.stdout.flush()

env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN, "User-Agent": UA})
    return json.loads(urllib.request.urlopen(req).read().decode())

def build_plan(mapping):
    """gid -> tag (waves are disjoint by recency, so one tag per customer here)."""
    plan = {}
    for line in SENDS.open(encoding="utf-8"):
        try: o = json.loads(line)
        except: continue
        tag = mapping.get((o.get("wave"), o.get("arm")))
        if tag and o.get("customer_gid"):
            plan[o["customer_gid"]] = tag
    return plan

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--stable", action="store_true", help="apply stable program tags instead of dated arm tags")
    args = ap.parse_args()

    mapping = STABLEMAP if args.stable else TAGMAP
    state_file = STATE_STABLE if args.stable else STATE
    plan = build_plan(mapping)
    from collections import Counter
    log("=== ARM TAGGING ===")
    for tag, n in sorted(Counter(plan.values()).items()):
        log(f"  {tag}: {n}")
    log(f"  total customers: {len(plan)}")

    if not args.apply:
        log("\n[dry run] nothing tagged. Re-run with --apply.")
        return

    done = set(json.loads(state_file.read_text()) if state_file.exists() else [])
    todo = [(g, t) for g, t in plan.items() if g not in done]
    log(f"\n[apply] {len(todo)} to tag, {len(done)} already done")
    M = "mutation($id:ID!,$tags:[String!]!){tagsAdd(id:$id,tags:$tags){userErrors{field message}}}"
    ok = err = 0
    for i, (gid, tag) in enumerate(todo, 1):
        try:
            res = gql(M, {"id": gid, "tags": [tag]})
            ue = res.get("data", {}).get("tagsAdd", {}).get("userErrors") or res.get("errors")
            if ue: err += 1; log(f"  [err] {gid}: {ue}"); continue
            ok += 1; done.add(gid)
        except Exception as e:
            err += 1; log(f"  [err] {gid}: {repr(e)[:100]}")
        if i % 250 == 0:
            state_file.write_text(json.dumps(sorted(done)))
            log(f"  progress: {i}/{len(todo)}  ok={ok} err={err}"); time.sleep(0.5)
    state_file.write_text(json.dumps(sorted(done)))
    log(f"\n[done] tagged={ok} err={err}. State -> {state_file.name}")

if __name__ == "__main__":
    main()
