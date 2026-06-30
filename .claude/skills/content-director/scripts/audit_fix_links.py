#!/usr/bin/env python3
"""
audit_fix_links.py - resolve + fix dead product links in blog articles.

For each blog article by --author, finds /products/<handle> links whose handle is
NOT in the live catalog, then resolves the correct live handle via (in order):
  1. Shopify URL redirect (authoritative: /products/<dead> -> target)
  2. suffix strip ( -ge-beauty-250ml -> short handle )
  3. token-prefix match ( melon-mood-body-hair-splash -> -mist )
HIGH = redirect/suffix-strip · MEDIUM = prefix/splash-mist · UNRESOLVED = flag only.

Dry-run by default (writes a plan). --confirm applies via articleUpdate.
Name mismatches (e.g. anchor says "Splash", live product is "Mist") are reported for
human review, never auto-changed.

Usage:
  python audit_fix_links.py --tenant gebeauty --author "Redação GE Beauty"
  python audit_fix_links.py --tenant gebeauty --author "Redação GE Beauty" --confirm
  python audit_fix_links.py ... --confirm --limit 1   # canary: fix one post first
"""
import argparse, json, re, sys, time, urllib.request, urllib.error
from pathlib import Path
from collections import Counter

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.stdout.reconfigure(encoding="utf-8")


def load_env(t):
    env = {}
    for line in (REPO_ROOT / "sandbox" / t / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("="); env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def make_gql(env):
    domain = env["SHOPIFY_SHOP_DOMAIN"]; token = env.get("SHOPIFY_ADMIN_ACCESS_TOKEN") or env.get("SHOPIFY_ACCESS_TOKEN")
    ver = env.get("SHOPIFY_API_VERSION", "2026-01")
    if domain.startswith(("http://", "https://")): domain = domain.split("://", 1)[1]
    url = f"https://{domain.rstrip('/')}/admin/api/{ver}/graphql.json"
    def gql(q, v=None):
        body = json.dumps({"query": q, "variables": v or {}}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token})
        for i in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    d = json.loads(r.read().decode("utf-8"))
                if d.get("errors"): print("GQL errors:", json.dumps(d["errors"], ensure_ascii=False), file=sys.stderr)
                return d
            except urllib.error.HTTPError as e:
                if e.code == 429: time.sleep(2 * (i + 1)); continue
                print("HTTP", e.code, e.read().decode("utf-8", "replace")[:300], file=sys.stderr); raise
        raise SystemExit("retries exhausted")
    return gql


def fetch_catalog_handles(gql):
    q = "query($c:String){products(first:100,after:$c){pageInfo{hasNextPage endCursor}nodes{handle}}}"
    out, c = set(), None
    while True:
        conn = gql(q, {"c": c})["data"]["products"]; out |= {n["handle"] for n in conn["nodes"]}
        if conn["pageInfo"]["hasNextPage"]: c = conn["pageInfo"]["endCursor"]; time.sleep(0.2)
        else: return out


def fetch_redirects(gql):
    q = "query($c:String){urlRedirects(first:250,after:$c){pageInfo{hasNextPage endCursor}nodes{path target}}}"
    m, c = {}, None
    while True:
        conn = gql(q, {"c": c})["data"]["urlRedirects"]
        for n in conn["nodes"]:
            p, t = n["path"], n["target"]
            if "/products/" in p:
                m[p.rstrip("/").split("/products/")[-1].split("/")[0]] = t.rstrip("/").split("/products/")[-1].split("/")[0] if "/products/" in t else t
        if conn["pageInfo"]["hasNextPage"]: c = conn["pageInfo"]["endCursor"]; time.sleep(0.2)
        else: return m


def fetch_articles(gql, author):
    blogs = gql("{blogs(first:50){nodes{id title}}}")["data"]["blogs"]["nodes"]
    q = "query($b:ID!,$c:String){blog(id:$b){articles(first:50,after:$c){pageInfo{hasNextPage endCursor}nodes{id title handle author{name} publishedAt body}}}}"
    out = []
    for b in blogs:
        c = None
        while True:
            conn = gql(q, {"b": b["id"], "c": c})["data"]["blog"]["articles"]
            out += [a for a in conn["nodes"] if (a.get("author") or {}).get("name") == author]
            if conn["pageInfo"]["hasNextPage"]: c = conn["pageInfo"]["endCursor"]; time.sleep(0.2)
            else: break
    return out


def resolve(dead, redirects, cat):
    if dead in redirects and redirects[dead] in cat:
        return redirects[dead], "HIGH:redirect"
    stripped = re.sub(r"-ge-beauty(-\d+\s*ml)?$", "", dead)
    if stripped != dead and stripped in cat:
        return stripped, "HIGH:suffix-strip"
    if "splash" in dead and dead.replace("splash", "mist") in cat:
        return dead.replace("splash", "mist"), "MEDIUM:splash-mist"
    toks = dead.split("-")
    for n in range(len(toks), 2, -1):
        pref = "-".join(toks[:n])
        cands = [h for h in cat if h == pref or h.startswith(pref + "-")]
        if len(cands) == 1:
            return cands[0], f"MEDIUM:prefix({n}tok)"
    return None, "UNRESOLVED"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", default="gebeauty"); ap.add_argument("--author", default="Redação GE Beauty")
    ap.add_argument("--confirm", action="store_true"); ap.add_argument("--limit", type=int)
    ap.add_argument("--out")
    args = ap.parse_args()
    gql = make_gql(load_env(args.tenant))
    print("Fetching catalog handles, redirects, articles…", file=sys.stderr)
    cat = fetch_catalog_handles(gql); reds = fetch_redirects(gql); arts = fetch_articles(gql, args.author)
    print(f"  {len(cat)} products · {len(reds)} product-redirects · {len(arts)} articles\n", file=sys.stderr)

    plan, conf_counter, name_review = [], Counter(), set()
    HREF = re.compile(r'href="([^"]*?/products/([^"#?/]+)[^"]*?)"')
    for a in arts:
        body = a.get("body") or ""; changes = []; new_body = body
        for full, handle in set(HREF.findall(body)):
            if handle in cat:
                continue
            tgt, conf = resolve(handle, reds, cat)
            conf_counter[conf] += 1
            if tgt:
                new_full = full.replace(f"/products/{handle}", f"/products/{tgt}")
                changes.append({"dead": handle, "live": tgt, "conf": conf, "from": full, "to": new_full})
                if conf.startswith(("HIGH", "MEDIUM")):
                    new_body = new_body.replace(full, new_full)
                if "splash" in handle and "mist" in (tgt or ""):
                    name_review.add("Anchor/handle says 'Splash' but live product is 'Mist' (melon-mood)")
            else:
                changes.append({"dead": handle, "live": None, "conf": conf, "from": full, "to": None})
        if changes:
            plan.append({"id": a["id"], "title": a["title"], "draft": a.get("publishedAt") is None,
                         "changes": changes, "new_body": new_body, "applied": False})

    fixable = sum(1 for p in plan for c in p["changes"] if c["live"] and c["conf"].startswith(("HIGH", "MEDIUM")))
    unresolved = sorted({c["dead"] for p in plan for c in p["changes"] if not c["live"]})
    print(f"{'='*70}\nLINK FIX PLAN — {args.author!r}\n{'='*70}")
    print(f"Posts with dead links: {len(plan)} · fixable link-instances: {fixable}")
    print(f"Confidence: {dict(conf_counter)}")
    print(f"\nDead->Live mapping (unique):")
    seen = {}
    for p in plan:
        for c in p["changes"]:
            if c["live"] and c["dead"] not in seen:
                seen[c["dead"]] = (c["live"], c["conf"]); print(f"  [{c['conf']:18}] {c['dead']}  ->  {c['live']}")
    print(f"\nUNRESOLVED (flag, not auto-fixed) — {len(unresolved)}:")
    for h in unresolved: print(f"  ?? {h}")
    print(f"\nNAME MISMATCH for your review:")
    for n in sorted(name_review): print(f"  ! {n}")

    if args.out:
        Path(args.out).write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nPlan written to {args.out}", file=sys.stderr)

    if not args.confirm:
        print(f"\n[DRY-RUN] No writes. Re-run with --confirm to apply (HIGH+MEDIUM links).")
        return
    # apply
    targets = [p for p in plan if p["new_body"] != (next((a for a in arts if a["id"] == p["id"]), {}).get("body"))]
    if args.limit: targets = targets[:args.limit]
    mut = "mutation($id:ID!,$a:ArticleUpdateInput!){articleUpdate(id:$id,article:$a){article{id}userErrors{field message}}}"
    applied = 0
    for p in targets:
        r = gql(mut, {"id": p["id"], "a": {"body": p["new_body"]}})
        errs = (((r.get("data") or {}).get("articleUpdate") or {}).get("userErrors")) or []
        if errs: print(f"  ERROR {p['title'][:50]}: {errs}", file=sys.stderr)
        else: applied += 1; print(f"  fixed: {p['title'][:60]}")
        time.sleep(0.3)
    print(f"\nApplied to {applied}/{len(targets)} posts.")


if __name__ == "__main__":
    main()
