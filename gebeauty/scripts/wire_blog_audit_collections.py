"""
Phase 2 of the content-director full audit: write per-post related collections
(custom.colecao_relacionada_1..4) onto the 137 VISIBLE GE Beauty blog posts,
per the audit plan (products + topic matching).

Overwrites the earlier blanket canonical-4 wire FOR VISIBLE POSTS ONLY with the
per-post relevant collections, in ranked order. Slots beyond the post's collection
count are cleared (a post now with 2 collections gets slots 3-4 deleted).

Idempotent: reads existing slot values, sets only what differs, clears stale slots.
Dry-run by default; mutates only with --confirm.

Run (dry):    C:/Python314/python.exe gebeauty/scripts/wire_blog_audit_collections.py
Run (commit): C:/Python314/python.exe gebeauty/scripts/wire_blog_audit_collections.py --confirm
"""

import json, sys, time, urllib.request, urllib.error
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
S = (r"C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--claude"
     r"/0de7f476-47ed-49a6-a5ea-6f213d8fa03c/scratchpad")
PLAN_PATH = Path(S + "/audit_plan.json")
GIDS_PATH = Path(S + "/collection_gids.json")
CONFIRM = "--confirm" in sys.argv
KEYS = [f"colecao_relacionada_{i}" for i in range(1, 5)]


def load_env(path):
    env = {}
    for l in path.read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, _, v = l.partition("="); env[k.strip()] = v.strip().strip('"').strip()
    return env


ENV = load_env(ENV_PATH)
SHOP, TOKEN = ENV["SHOPIFY_SHOP_DOMAIN"], ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = f"https://{SHOP}/admin/api/{ENV.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"


def gq(q, v=None):
    b = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    r = urllib.request.Request(URL, data=b, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    while True:
        try:
            with urllib.request.urlopen(r) as resp:
                d = json.loads(resp.read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2); continue
            raise
    if "errors" in d:
        raise RuntimeError(json.dumps(d["errors"]))
    return d


def throttle(d):
    ts = d.get("extensions", {}).get("cost", {}).get("throttleStatus", {})
    a = ts.get("currentlyAvailable")
    if a is not None and a < 200:
        time.sleep(max(0.0, (400 - a) / max(ts.get("restoreRate", 200), 1)))


NODES = """
query($ids:[ID!]!){ nodes(ids:$ids){ ... on Article { id
  m1: metafield(namespace:"custom",key:"colecao_relacionada_1"){value}
  m2: metafield(namespace:"custom",key:"colecao_relacionada_2"){value}
  m3: metafield(namespace:"custom",key:"colecao_relacionada_3"){value}
  m4: metafield(namespace:"custom",key:"colecao_relacionada_4"){value} } } }
"""
SET = "mutation($m:[MetafieldsSetInput!]!){metafieldsSet(metafields:$m){userErrors{field message}}}"
DEL = "mutation($m:[MetafieldIdentifierInput!]!){metafieldsDelete(metafields:$m){deletedMetafields{key} userErrors{field message}}}"


def main():
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    h2g = json.loads(GIDS_PATH.read_text(encoding="utf-8"))
    title = {e["gid"]: e["title"] for e in plan}
    desired = {e["gid"]: [h2g[c] for c in e["collections"]] for e in plan}  # ordered gids
    ids = list(desired.keys())

    existing = {}
    for i in range(0, len(ids), 50):
        d = gq(NODES, {"ids": ids[i:i + 50]}); throttle(d)
        for n in d["data"]["nodes"]:
            if n:
                existing[n["id"]] = [(n.get(f"m{j}") or {}).get("value") for j in range(1, 5)]

    sets, dels, ok = [], [], 0
    for aid in ids:
        want = desired[aid]; have = existing.get(aid, [None] * 4)
        clean = True
        for slot in range(4):
            w = want[slot] if slot < len(want) else None
            h = have[slot] if slot < len(have) else None
            if w and h != w:
                sets.append((aid, KEYS[slot], w)); clean = False
            elif not w and h:
                dels.append((aid, KEYS[slot])); clean = False
        if clean:
            ok += 1

    print(f"Store: {SHOP} | mode: {'COMMIT' if CONFIRM else 'DRY-RUN'}")
    print(f"posts: {len(ids)} | already correct: {ok} | slot-sets: {len(sets)} | slot-clears: {len(dels)}")
    g2h = {v: k for k, v in h2g.items()}
    print("\n-- sample --")
    seen = set()
    for aid, key, gid in sets:
        if aid not in seen and len(seen) < 6:
            seen.add(aid)
            print(f"  {title[aid][:46]:46} <- {[g2h.get(g, g) for g in desired[aid]]}")

    if not CONFIRM:
        print("\nDRY-RUN only. Re-run with --confirm to write.")
        return

    wired = 0
    for i in range(0, len(sets), 25):
        batch = sets[i:i + 25]
        mfs = [{"ownerId": aid, "namespace": "custom", "key": key, "type": "collection_reference", "value": gid}
               for aid, key, gid in batch]
        d = gq(SET, {"m": mfs}); throttle(d)
        errs = d["data"]["metafieldsSet"]["userErrors"]
        if errs:
            print("SET ERRORS:", errs)
        else:
            wired += len(batch)
        print(f"  set {wired}/{len(sets)}")

    cleared = 0
    for i in range(0, len(dels), 25):
        batch = dels[i:i + 25]
        ids_in = [{"ownerId": aid, "namespace": "custom", "key": key} for aid, key in batch]
        d = gq(DEL, {"m": ids_in}); throttle(d)
        errs = d["data"]["metafieldsDelete"]["userErrors"]
        if errs:
            print("DEL ERRORS:", errs)
        else:
            cleared += len(batch)

    print(f"\n=== SUMMARY === slot-sets: {wired} | slot-clears: {cleared}")


if __name__ == "__main__":
    main()
