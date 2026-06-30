#!/usr/bin/env python3
"""
audit_scan.py - Layer-1 deterministic content audit for /content-director audit mode.

Scores live blog articles against the deterministic parts of references/eval-rubric.md,
grounded in the LIVE Shopify catalog. No LLM. Stdlib only (urllib). Read-only.

Catches the high-confidence gate failures cheaply and reproducibly:
  TRUTH gates  : thermal claim != 230C, product-link handle not in catalog,
                 miracle/banned words, hallucinated product-shaped names (review),
                 invented-stat candidates (review)
  HOUSE gates  : em/en dash, mangled tagline
  HYGIENE      : <meta> cruft in summary, empty tags, <h1>, inline style, <script>,
                 heading-level skips

The subjective dimensions (voice tone, ingredient attribution, claim safety nuance)
are left to the Layer-2 adversarial judge.

Usage:
  python audit_scan.py --tenant gebeauty --author "Redação GE Beauty"
  python audit_scan.py --tenant gebeauty --author "Kelviane Lima"   # calibration
  python audit_scan.py --tenant gebeauty --author "Redação GE Beauty" --out report.json
"""
import argparse
import json
import re
import sys
import time
import urllib.request
import urllib.error
from html import unescape
from pathlib import Path
from collections import Counter, defaultdict

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.stdout.reconfigure(encoding="utf-8")

# --- claim canon (from references/eval-rubric.md / brand-sources.md) ---
THERMAL_CANON = 230  # the only valid thermal-protection number
MIRACLE_WORDS = [
    "milagroso", "milagrosa", "milagre", "revolucionário", "revolucionária",
    "revoluciona", "transforma totalmente", "resolve tudo", "cabelo perfeito",
    "cabelo dos sonhos", "resultado garantido", "elimina o frizz para sempre",
]
TAGLINE = "no seu tempo, do seu jeito"
# product-shaped phrases we extract to test against the catalog
PRODUCT_PREFIXES = r"(?:Booster|Primer|Máscara|Mascara|Leave-?in|Shampoo|Finalizador|Escova|Splash|Body\s*&?\s*Hair|Kit)"


def load_env(tenant):
    p = REPO_ROOT / "sandbox" / tenant / ".env"
    env = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def make_gql(env):
    domain = env["SHOPIFY_SHOP_DOMAIN"]
    token = env.get("SHOPIFY_ADMIN_ACCESS_TOKEN") or env.get("SHOPIFY_ACCESS_TOKEN")
    ver = env.get("SHOPIFY_API_VERSION", "2026-01")
    if domain.startswith(("http://", "https://")):
        domain = domain.split("://", 1)[1]
    url = f"https://{domain.rstrip('/')}/admin/api/{ver}/graphql.json"

    def gql(query, variables=None):
        body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={
            "Content-Type": "application/json", "X-Shopify-Access-Token": token})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.loads(r.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    time.sleep(2 * (attempt + 1)); continue
                raise
        raise SystemExit("retries exhausted")
    return gql


def fetch_catalog(gql):
    q = """
    query($cursor: String) {
      products(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { handle title status }
      }
    }"""
    prods, cursor = [], None
    while True:
        conn = gql(q, {"cursor": cursor})["data"]["products"]
        prods.extend(conn["nodes"])
        if conn["pageInfo"]["hasNextPage"]:
            cursor = conn["pageInfo"]["endCursor"]; time.sleep(0.2)
        else:
            break
    return prods


def fetch_articles(gql, author):
    blogs = gql("{ blogs(first: 50){ nodes { id title } } }")["data"]["blogs"]["nodes"]
    q = """
    query($bid: ID!, $cursor: String) {
      blog(id: $bid) { articles(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { title handle author { name } publishedAt tags summary body }
      } }
    }"""
    out = []
    for b in blogs:
        cursor = None
        while True:
            conn = gql(q, {"bid": b["id"], "cursor": cursor})["data"]["blog"]["articles"]
            for a in conn["nodes"]:
                if (a.get("author") or {}).get("name") == author:
                    a["blogTitle"] = b["title"]; out.append(a)
            if conn["pageInfo"]["hasNextPage"]:
                cursor = conn["pageInfo"]["endCursor"]; time.sleep(0.2)
            else:
                break
    return out


TAG_RE = re.compile(r"<[^>]+>")


def to_text(html):
    h = re.sub(r"(?i)</(p|div|h[1-6]|li|br)>", "\n", html or "")
    return unescape(TAG_RE.sub("", h))


def norm(s):
    s = s.lower()
    s = re.sub(r"\bge beauty\b", "", s)
    s = re.sub(r"\d+\s*ml\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def scan_post(a, cat_handles, cat_names):
    body = a.get("body") or ""
    text = to_text(body)
    low = text.lower()
    findings = []

    def add(cat, sev, msg):
        findings.append({"cat": cat, "sev": sev, "msg": msg})

    # TRUTH: thermal canon
    therm = re.findall(r"(\d{2,3})\s*[°º]\s*[cC]|(\d{2,3})\s*graus", text)
    bad_therm = sorted({int(x or y) for x, y in therm if (int(x or y) not in (0, THERMAL_CANON) and int(x or y) >= 180)})
    if bad_therm:
        add("truth:claim-canon", "blocker", f"thermal claim(s) {bad_therm}°C != canon {THERMAL_CANON}°C")

    # TRUTH: product-link resolution (handles must be in catalog)
    hrefs = re.findall(r'href="([^"]*/products/[^"#?]+)', body, re.I)
    bad_links = []
    for h in hrefs:
        handle = h.rstrip("/").split("/products/")[-1].split("/")[0]
        if handle and handle not in cat_handles:
            bad_links.append(handle)
    if bad_links:
        add("truth:product-link", "blocker", f"PDP link handle(s) not in catalog: {sorted(set(bad_links))}")

    # TRUTH: miracle / banned words
    hits = [w for w in MIRACLE_WORDS if w in low]
    if hits:
        add("truth:miracle", "blocker", f"miracle/banned phrase(s): {hits}")

    # TRUTH (review): hallucinated product-shaped names not in catalog
    cand = re.findall(rf"\b{PRODUCT_PREFIXES}\s+[A-ZÀ-Ý][\wÀ-ÿ]+(?:\s+[A-ZÀ-Ý][\wÀ-ÿ]+)?", text)
    unknown = []
    for c in set(cand):
        nc = norm(c)
        if len(nc) < 6:
            continue
        if not any(nc in cn or cn in nc for cn in cat_names):
            unknown.append(c.strip())
    if "Booster Purificante" in text:
        add("truth:hallucinated-product", "blocker", "names 'Booster Purificante' (does not exist)")
    if unknown:
        add("truth:product-name", "review", f"product-shaped phrases not matched to catalog: {sorted(set(unknown))[:8]}")

    # TRUTH (review): invented-stat candidates (exclude legit 100% clean claims)
    pcts = re.findall(r"(\d{1,3})\s*%", text)
    sus_pct = sorted({int(p) for p in pcts if int(p) != 100})
    nx = re.findall(r"\b(\d+)\s*x\b\s*(mais|menos)", low)
    if sus_pct:
        add("truth:invented-stat", "review", f"non-100% figure(s) to verify: {sus_pct}")
    if nx:
        add("truth:invented-stat", "review", f"'Nx mais/menos' claim(s): {[a+'x '+b for a,b in nx]}")

    # HOUSE: em/en dash
    em = body.count("—") + body.count("–")
    if em:
        add("house:em-dash", "blocker", f"{em} em/en dash(es)")

    # HOUSE: mangled tagline (present but not exact)
    if "seu tempo" in low and "seu jeito" in low and TAGLINE not in low:
        add("house:tagline", "blocker", "tagline present but not exact 'no seu tempo, do seu jeito.'")

    # HYGIENE
    summary = a.get("summary") or ""
    if "<meta" in summary or "charset" in summary:
        add("hygiene:meta-cruft", "minor", "summary carries leftover <meta>/charset markup")
    if not (a.get("tags") or []):
        add("hygiene:tags", "minor", "no tags (zero topical clustering)")
    if re.search(r"(?i)<h1[ >]", body):
        add("hygiene:h1", "minor", "emits <h1> (Shopify generates it)")
    if re.search(r'(?i)style\s*=\s*"', body):
        add("hygiene:inline-style", "minor", "inline style= present")
    if re.search(r"(?i)<script|<iframe", body):
        add("hygiene:script", "major", "<script>/<iframe> present")
    # heading skip: h3 before any h2
    if re.search(r"(?i)<h3", body) and not re.search(r"(?i)<h2", body):
        add("hygiene:heading", "minor", "uses <h3> with no <h2> (hierarchy skip)")

    # provisional verdict
    truth_block = any(f["sev"] == "blocker" and f["cat"].startswith("truth") for f in findings)
    house_block = any(f["sev"] == "blocker" and f["cat"].startswith("house") for f in findings)
    review = any(f["sev"] == "review" for f in findings)
    if truth_block:
        verdict = "REJECT"
    elif house_block or any(f["sev"] == "major" for f in findings):
        verdict = "NEEDS-FIX"
    elif review:
        verdict = "NEEDS-JUDGE"
    else:
        verdict = "NEEDS-JUDGE"  # Layer-1 clean; voice still needs the judge
    return {
        "title": a["title"], "handle": a.get("handle"),
        "draft": a.get("publishedAt") is None,
        "words": len(re.findall(r"\w+", text)), "verdict": verdict, "findings": findings,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", default="gebeauty")
    ap.add_argument("--author", default="Redação GE Beauty")
    ap.add_argument("--out")
    args = ap.parse_args()

    gql = make_gql(load_env(args.tenant))
    print(f"Fetching catalog…", file=sys.stderr)
    cat = fetch_catalog(gql)
    cat_handles = {p["handle"] for p in cat}
    cat_names = {norm(p["title"]) for p in cat if norm(p["title"])}
    print(f"  {len(cat)} products.", file=sys.stderr)
    print(f"Fetching articles by {args.author!r}…", file=sys.stderr)
    arts = fetch_articles(gql, args.author)
    print(f"  {len(arts)} articles.\n", file=sys.stderr)

    cards = [scan_post(a, cat_handles, cat_names) for a in arts]

    # rollup
    verdicts = Counter(c["verdict"] for c in cards)
    cat_freq = Counter()
    for c in cards:
        for f in {fd["cat"] for fd in c["findings"]}:  # one per post per category
            cat_freq[f] += 1

    print(f"{'='*70}\nLAYER-1 AUDIT — author={args.author!r} — {len(cards)} posts\n{'='*70}")
    print(f"Drafts: {sum(1 for c in cards if c['draft'])}/{len(cards)}")
    print(f"\nProvisional verdicts: {dict(verdicts)}")
    print(f"\nGate/finding frequency (posts affected):")
    for cat_, n in sorted(cat_freq.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {n:4d}  {cat_}")

    print(f"\n--- REJECT posts (truth-gate failures) ---")
    for c in cards:
        if c["verdict"] == "REJECT":
            msgs = "; ".join(f["msg"] for f in c["findings"] if f["sev"] == "blocker" and f["cat"].startswith("truth"))
            print(f"  [{c['words']:4d}w] {c['title'][:70]}\n          -> {msgs}")

    if args.out:
        Path(args.out).write_text(json.dumps(
            {"author": args.author, "n": len(cards), "verdicts": dict(verdicts),
             "cat_freq": dict(cat_freq), "cards": cards}, ensure_ascii=False, indent=2),
            encoding="utf-8")
        print(f"\nWrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
