"""
Reconcile arm tags to the approved scheme (Lucas 2026-07-07):
  cohort                         broad (stable)                  wave-specific (dated)
  reactivation SEND  ->  retention-reactivation           retention-reactivation_26-07-06
  reactivation HOLD  ->  retention-reactivation_control   retention-reactivation_control_26-07-06
  refill SEND        ->  retention-refill                 retention-refill_26-07-07
  refill HOLD        ->  retention-refill_control         retention-refill_control_26-07-07

Each customer gets TWO tags (broad + dated). Supersedes the old wave-* names.

Phase A: remove old 'wave-*' tags from customers who already got them (tag-arms-state.json).
Phase B: add [broad, dated] to all customers in sends.jsonl.
Idempotent + resumable (tagsRemove of an absent tag / tagsAdd of an existing tag are no-ops).

  python retag_arms.py           # dry run: counts
  python retag_arms.py --apply   # reconcile (both phases)
"""
import json, sys, time, argparse, urllib.request, threading
from pathlib import Path
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = Path(__file__).resolve().parent
TEN = HERE.parent
SENDS = HERE / "learning" / "sends.jsonl"
OLD_STATE = HERE / "tag-arms-state.json"          # gids that received old wave-* tags
RM_STATE = HERE / "retag-remove-state.json"
ADD_STATE = HERE / "retag-add-state.json"

# (wave, arm) -> (broad, dated, old_dated_to_remove)
COHORT = {
    ("2026-07-06-ge60d", "SEND"): ("retention-reactivation", "retention-reactivation_26-07-06", "wave-reactivation-send-2026-07-06"),
    ("2026-07-06-ge60d", "HOLD"): ("retention-reactivation_control", "retention-reactivation_control_26-07-06", "wave-reactivation-hold-2026-07-06"),
    ("2026-07-07-ge45-59d-refill", "SEND"): ("retention-refill", "retention-refill_26-07-07", "wave-refill-send-2026-07-07"),
    ("2026-07-07-ge45-59d-refill", "HOLD"): ("retention-refill_control", "retention-refill_control_26-07-07", "wave-refill-hold-2026-07-07"),
    # August wave (Lucas, 2026-08-07) -- same broad umbrella as the July reactivation wave,
    # new dated tag. old_dated_to_remove is inert here (no prior wave-* tags exist for this
    # cohort, Phase A only ever touches gids in tag-arms-state.json's July migration set).
    ("2026-08-07-ge60d", "SEND"): ("retention-reactivation", "retention-reactivation_26-08-07", "wave-reactivation-send-2026-08-07"),
    ("2026-08-07-ge60d", "HOLD"): ("retention-reactivation_control", "retention-reactivation_control_26-08-07", "wave-reactivation-hold-2026-08-07"),
}
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

def log(*a): print(*a); sys.stdout.flush()
env = {}
ENV_FILE = TEN / ".env" if (TEN / ".env").exists() else TEN.parent / ".env"
for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1); env[k.strip()] = v.strip()
URL = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]
def gql(q, v):
    body = json.dumps({"query": q, "variables": v}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json",
        "X-Shopify-Access-Token": TOKEN, "User-Agent": UA})
    return json.loads(urllib.request.urlopen(req).read().decode())

def plan():
    """gid -> (broad, dated, old_dated)."""
    p = {}
    for line in SENDS.open(encoding="utf-8"):
        try: o = json.loads(line)
        except: continue
        c = COHORT.get((o.get("wave"), o.get("arm")))
        if c and o.get("customer_gid"): p[o["customer_gid"]] = c
    return p

def run_phase(name, items, mut, state_path):
    # state_path is an append-only .jsonl of {"gid":...} rows, not a rewritten JSON list --
    # a whole-file rewrite corrupted under a mid-write kill earlier this session (dual_arm_issue.py
    # incident, see retention-experiments.md notes) and caused 55 duplicate credit issuances.
    # Never repeat that pattern: derive "done" live from the append-only log instead.
    done = set()
    if state_path.exists():
        for line in state_path.open(encoding="utf-8"):
            line = line.strip()
            if not line: continue
            try: done.add(json.loads(line)["gid"])
            except Exception: continue
    todo = [x for x in items if x[0] not in done]
    log(f"[{name}] {len(todo)} to do, {len(done)} already done")
    ok = err = 0
    lock = threading.Lock()
    lf = state_path.open("a", encoding="utf-8")
    key = "tagsRemove" if "tagsRemove" in mut else "tagsAdd"

    def do_one(item):
        gid, tags = item
        try:
            res = gql(mut, {"id": gid, "tags": tags})
            ue = res.get("data", {}).get(key, {}).get("userErrors") or res.get("errors")
            if ue: return ("err", gid, str(ue))
            return ("ok", gid, None)
        except Exception as e:
            return ("err", gid, repr(e)[:100])

    with ThreadPoolExecutor(max_workers=16) as ex:
        futs = [ex.submit(do_one, item) for item in todo]
        for i, fut in enumerate(as_completed(futs), 1):
            status, gid, err_msg = fut.result()
            with lock:
                if status == "err":
                    err += 1; log(f"  [err] {gid}: {err_msg}")
                else:
                    ok += 1
                    lf.write(json.dumps({"gid": gid}) + "\n"); lf.flush()
                if i % 250 == 0:
                    log(f"  {name} progress: {i}/{len(todo)} ok={ok} err={err}")
    lf.close()
    log(f"[{name}] done ok={ok} err={err}")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--apply", action="store_true"); args = ap.parse_args()
    P = plan()
    log("=== RETAG RECONCILE ===")
    log("new tags per cohort (broad + dated):")
    for k, (b, d, o) in COHORT.items():
        n = sum(1 for v in P.values() if v == (b, d, o))
        log(f"  {k[1]:4} {k[0]:26} -> {b} , {d}   ({n})")
    old_ids = set(json.loads(OLD_STATE.read_text()) if OLD_STATE.exists() else [])
    log(f"\nPhase A (remove old wave-* tags): {len(old_ids)} customers")
    log(f"Phase B (add broad+dated): {len(P)} customers")
    if not args.apply:
        log("\n[dry run] nothing changed. Re-run with --apply."); return
    # Phase A: remove old dated tag from those that got it
    RM = "mutation($id:ID!,$tags:[String!]!){tagsRemove(id:$id,tags:$tags){userErrors{field message}}}"
    rm_items = [(g, [P[g][2]]) for g in old_ids if g in P]
    run_phase("REMOVE", rm_items, RM, RM_STATE)
    # Phase B: add broad + dated to all
    ADD = "mutation($id:ID!,$tags:[String!]!){tagsAdd(id:$id,tags:$tags){userErrors{field message}}}"
    add_items = [(g, [b, d]) for g, (b, d, o) in P.items()]
    run_phase("ADD", add_items, ADD, ADD_STATE)
    log("\n[done] reconcile complete.")

if __name__ == "__main__":
    main()
