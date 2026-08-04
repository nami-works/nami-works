# =============================================================================
# STATUS: COMPLETED ONE-SHOT — DO NOT RE-RUN.
#   Ran --apply on 2026-07-13 (correct-keeper-state.json recorded 109 corrected sets).
#   Idempotent + rested; re-running those sets is a no-op.
#   WAVE-PINNED: the redemption-guard reads _cache/orders_since_2026-07-06.jsonl, which is
#   specific to the 2026-07-06 reactivation wave. Running this against any OTHER wave would use
#   the wrong guard cache and could double-give credit. It is NOT part of the ongoing loop.
#   Kept as an AUDIT ARTIFACT + reference for (a) the fairness rule (largest emailed credit wins,
#   on the emailed account) and (b) the redemption-guard pattern.
#   Durable fix for future waves = dedup-before-issue (match on phone AND name, never phone alone).
#   Runtime deps (all gitignored/PII, Desktop-local): .env, learning/sends.jsonl,
#   _cache/orders_since_2026-07-06.jsonl, + imports consolidate_dupes.py (present at canonical).
# =============================================================================
"""
Keeper-rule correction. The original consolidation kept the MOST-RECENT-ORDER account, which
sometimes held a SMALLER credit than another account we EMAILED the customer (e.g. Gabriela:
emailed R$85,90 on gabi_np, but we kept R$44,18 on her other account). Fairness rule now:

  each SAME-PERSON duplicate keeps their LARGEST emailed credit, on the account it was emailed to.

Per same-person set (name-match; different-people sets are left alone — each already keeps their own):
  target = max issued-credit account (M).
  - REDEMPTION GUARD: if anyone in the set already spent store credit (order w/ credit gateway
    since 07-06), SKIP + flag (avoid double-giving); handle manually.
  - else: credit target up to M (restore what we dropped), zero every non-target account.
Result: one credit = the largest amount we promised, on the emailed account. notify=false.

Idempotent (target already == M and others 0 -> no-op) + state file. DRY-RUN by default.
  python correct_keeper.py            # plan + amounts + skips
  python correct_keeper.py --apply
"""
import json, sys, re, argparse, time, importlib.util, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
STATE = HERE / "correct-keeper-state.json"
ORDERS_CACHE = HERE / "_cache" / "orders_since_2026-07-06.jsonl"

def log(*a): print(*a); sys.stdout.flush()
env = {}
for line in (TEN / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
def gql(q, v):
    r = urllib.request.Request(URL, data=json.dumps({"query": q, "variables": v}).encode(),
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": env["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    return json.loads(urllib.request.urlopen(r).read().decode())

# reuse the duplicate-set builder + same-person classifier
spec = importlib.util.spec_from_file_location("cd", str(HERE / "consolidate_dupes.py"))
cd = importlib.util.module_from_spec(spec); spec.loader.exec_module(cd)  # import only (no main); argv preserved
def fn(o): return (o.get("first_name") or "").strip().lower()
def similar(a, b):
    if not a or not b: return True
    return a == b or a.startswith(b) or b.startswith(a) or a[:4] == b[:4]
def same_person(recs):
    names = [fn(r) for r in recs]
    return all(similar(names[i], names[j]) for i in range(len(names)) for j in range(i + 1, len(names)))

def redeemers():
    """customer gids who used store credit on an order since 07-06 (from measure cache)."""
    s = set()
    if not ORDERS_CACHE.exists(): return s
    for line in ORDERS_CACHE.open(encoding="utf-8"):
        o = json.loads(line)
        if "/Order/" not in o.get("id", ""): continue
        if any("credit" in (g or "").lower() for g in (o.get("paymentGatewayNames") or [])):
            gid = (o.get("customer") or {}).get("id")
            if gid: s.add(gid)
    return s

BAL = """query($id:ID!){customer(id:$id){storeCreditAccounts(first:5){nodes{balance{amount currencyCode}}}}}"""
CREDIT = """mutation($id:ID!,$in:StoreCreditAccountCreditInput!){storeCreditAccountCredit(id:$id,creditInput:$in){
  storeCreditAccountTransaction{...on StoreCreditAccountCreditTransaction{account{balance{amount}}}} userErrors{field message}}}"""
DEBIT = """mutation($id:ID!,$in:StoreCreditAccountDebitInput!){storeCreditAccountDebit(id:$id,debitInput:$in){
  storeCreditAccountTransaction{...on StoreCreditAccountDebitTransaction{account{balance{amount}}}} userErrors{field message}}}"""
def bal(gid):
    n = gql(BAL, {"id": gid})["data"]["customer"]["storeCreditAccounts"]["nodes"]
    return (sum(float(x["balance"]["amount"]) for x in n), (n[0]["balance"]["currencyCode"] if n else "BRL"))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--apply", action="store_true"); args = ap.parse_args()
    sets = [s for s in cd.plan() if same_person([s["primary"]] + s["secondaries"])]
    red = redeemers()
    log(f"same-person duplicate sets: {len(sets)}")
    fixes = []; skip_red = 0; already_ok = 0
    for s in sets:
        recs = [s["primary"]] + s["secondaries"]
        if any(r["customer_gid"] in red for r in recs): skip_red += 1; continue
        target = max(recs, key=lambda r: r.get("credit_amount") or 0)
        M = round(target.get("credit_amount") or 0, 2)
        others = [r for r in recs if r["customer_gid"] != target["customer_gid"]]
        fixes.append({"target": target, "M": M, "others": others,
                      "exp": target.get("expires_at") or "2026-07-13T23:59:59Z"})
    log(f"  redeemer sets skipped (manual review): {skip_red}")
    log(f"  candidate fixes: {len(fixes)}")

    done = set(json.loads(STATE.read_text()) if STATE.exists() else [])
    applied = topped = zeroed = err = 0; added = 0.0
    for i, f in enumerate(fixes, 1):
        tgid = f["target"]["customer_gid"]
        if tgid in done: already_ok += 1; continue
        try:
            tb, cur = bal(tgid)
            need = round(f["M"] - tb, 2)
            action = []
            if need > 0.01:
                action.append(f"+R${need:.2f} -> {f['target'].get('email')} (to R${f['M']:.2f})")
            for o in f["others"]:
                ob, oc = bal(o["customer_gid"])
                if ob > 0.01: action.append(f"zero R${ob:.2f} {o.get('email')}")
            if not action:
                done.add(tgid); already_ok += 1; continue
            if not args.apply:
                log("  FIX " + " | ".join(action));
                if need > 0.01: added += need
                continue
            # apply: top up target, then zero others
            if need > 0.01:
                exp = f["exp"] if "T" in f["exp"] else f["exp"] + "T23:59:59Z"
                r = gql(CREDIT, {"id": tgid, "in": {"creditAmount": {"amount": f"{need:.2f}", "currencyCode": cur},
                        "expiresAt": exp, "notify": False}})
                ue = r.get("data", {}).get("storeCreditAccountCredit", {}).get("userErrors")
                if ue: err += 1; log(f"  [err credit] {f['target'].get('email')}: {ue}"); continue
                topped += 1; added += need
            for o in f["others"]:
                ob, oc = bal(o["customer_gid"])
                if ob > 0.01:
                    r = gql(DEBIT, {"id": o["customer_gid"], "in": {"debitAmount": {"amount": f"{ob:.2f}", "currencyCode": oc}}})
                    ue = r.get("data", {}).get("storeCreditAccountDebit", {}).get("userErrors")
                    if ue: err += 1; log(f"  [err debit] {o.get('email')}: {ue}"); continue
                    zeroed += 1
            applied += 1; done.add(tgid)
        except Exception as e:
            err += 1; log(f"  [err] {f['target'].get('email')}: {repr(e)[:100]}")
        if i % 25 == 0:
            STATE.write_text(json.dumps(sorted(done))); log(f"  {i}/{len(fixes)} applied={applied} err={err}"); time.sleep(0.5)
    STATE.write_text(json.dumps(sorted(done)))
    if not args.apply:
        log(f"\n[dry run] would fix {len([1 for _ in fixes])} sets, ~R${added:,.2f} credit restored to largest-emailed accounts.")
        log("Re-run with --apply.")
    else:
        log(f"\n[done] sets fixed={applied} (top-ups={topped}, zeros={zeroed}), R${added:,.2f} restored, already-ok={already_ok}, err={err}")

if __name__ == "__main__":
    main()
