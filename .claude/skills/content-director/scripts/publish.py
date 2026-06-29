#!/usr/bin/env python3
"""
publish.py — push finished copy to the live Shopify store. MUTATING. Stdlib only.

Two subcommands:
    blog  -> articleCreate: a new blog article (body HTML + summary + SEO metafields)
    pdp   -> productUpdate: a product's descriptionHtml + SEO title/description

SAFETY MODEL (the whole point):
  - Without --confirm, this is a DRY RUN: it resolves and prints the exact payload,
    target, and character-count checks, and mutates NOTHING.
  - With --confirm, it executes the mutation.
  The /content-director brain ALWAYS runs the dry run first, shows it to the user,
  and only re-runs with --confirm after explicit approval. Never wire --confirm into
  an unattended loop.

GraphQL shapes validated against Admin API 2026-01 (shopify-dev-mcp).

Scopes:
  - blog: write_content + write_online_store_pages   (token must have BOTH)
  - pdp : write_products

Examples:
    python publish.py blog --tenant gebeauty --blog-handle news \
        --title "Como proteger a cor do cabelo no verao" --author "GE Beauty" \
        --html post.html --metafields post_metafields.md            # dry run
    python publish.py blog ... --publish --confirm                   # publish live

    python publish.py pdp --tenant gebeauty \
        --product-gid gid://shopify/Product/123 --body-html desc.html \
        --seo-title "..." --seo-description "..."                     # dry run
    python publish.py pdp ... --confirm                              # write live
"""

import argparse
import json
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]

DASHES = {"—": "-", "–": "-", "‒": "-", "―": "-"}


def sanitize(text: str) -> str:
    """Final mechanical sweep: kill em/en dashes (AI markers) per the no-em-dash rule."""
    if not text:
        return text
    for bad, good in DASHES.items():
        text = text.replace(bad, good)
    return text


def load_env(tenant: str) -> dict:
    env_path = REPO_ROOT / "sandbox" / tenant / ".env"
    if not env_path.exists():
        sys.exit(f"ERROR: tenant env not found at {env_path}")
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def make_graphql(env: dict):
    domain = env.get("SHOPIFY_SHOP_DOMAIN", "")
    token = env.get("SHOPIFY_ADMIN_ACCESS_TOKEN") or env.get("SHOPIFY_ACCESS_TOKEN")
    version = env.get("SHOPIFY_API_VERSION", "2026-01")
    if not domain or not token:
        sys.exit("ERROR: SHOPIFY_SHOP_DOMAIN / SHOPIFY_ADMIN_ACCESS_TOKEN missing in tenant .env")
    if domain.startswith(("http://", "https://")):
        domain = domain.split("://", 1)[1]
    url = f"https://{domain.rstrip('/')}/admin/api/{version}/graphql.json"

    def graphql(query, variables=None):
        body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
        req = urllib.request.Request(
            url, data=body,
            headers={"Content-Type": "application/json", "X-Shopify-Access-Token": token},
        )
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                if data.get("errors"):
                    sys.exit(f"GraphQL errors: {json.dumps(data['errors'], ensure_ascii=False)}")
                return data["data"]
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < 4:
                    time.sleep(2 ** attempt)
                    continue
                sys.exit(f"HTTP {e.code}: {e.read().decode('utf-8', 'ignore')}")
        sys.exit("Exhausted retries against Shopify GraphQL")

    return graphql


# ---- metafields.md parsing (crew output format) ----------------------------

META_KEYS = ["meta_title", "meta_description", "summary_html", "related_products"]


def parse_metafields(md_path: Path) -> dict:
    """Parse the crew-style metafields.md (key: value, possibly multi-line)."""
    fields = {k: "" for k in META_KEYS}
    if not md_path or not md_path.exists():
        return fields
    current = None
    for raw in md_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip().lstrip("-* ").strip()
        m = re.match(r"^\**(" + "|".join(META_KEYS) + r")\**\s*:\s*(.*)$", line, re.IGNORECASE)
        if m:
            current = m.group(1).lower()
            fields[current] = m.group(2).strip()
        elif current and line:
            fields[current] += " " + line
    for k in fields:
        fields[k] = sanitize(fields[k].strip().strip("`").strip())
    return fields


def warn_len(label: str, text: str, lo: int, hi: int):
    n = len(text or "")
    flag = "OK" if lo <= n <= hi else "OUT OF RANGE"
    print(f"   {label}: {n} chars (target {lo}-{hi}) [{flag}]")


# ---- blog ------------------------------------------------------------------

def resolve_blog_id(graphql, handle: str):
    cursor = None
    while True:
        data = graphql(
            "query($c:String){ blogs(first:50, after:$c){ pageInfo{hasNextPage endCursor} nodes{ id handle title } } }",
            {"c": cursor},
        )
        for b in data["blogs"]["nodes"]:
            if b["handle"] == handle:
                return b["id"]
        if not data["blogs"]["pageInfo"]["hasNextPage"]:
            return None
        cursor = data["blogs"]["pageInfo"]["endCursor"]


def cmd_blog(args, env):
    graphql = make_graphql(env)
    body = sanitize(Path(args.html).read_text(encoding="utf-8"))
    meta = parse_metafields(Path(args.metafields)) if args.metafields else {k: "" for k in META_KEYS}
    title = sanitize(args.title)

    metafields = []
    if meta["meta_title"]:
        metafields.append({"namespace": "global", "key": "title_tag",
                           "type": "single_line_text_field", "value": meta["meta_title"]})
    if meta["meta_description"]:
        metafields.append({"namespace": "global", "key": "description_tag",
                           "type": "single_line_text_field", "value": meta["meta_description"]})

    article = {
        "blogId": None,  # filled after resolve
        "title": title,
        "body": body,
        "summary": meta["summary_html"] or None,
        "author": {"name": args.author},
        "isPublished": bool(args.publish),
        "metafields": metafields or None,
    }

    print(f"== BLOG {'PUBLISH' if args.confirm else 'DRY RUN'} ==")
    print(f"   blog handle : {args.blog_handle}")
    print(f"   title       : {title}")
    print(f"   author      : {args.author}")
    print(f"   state       : {'PUBLISHED' if args.publish else 'DRAFT'}")
    print(f"   body        : {len(body)} chars of HTML")
    warn_len("meta_title", meta["meta_title"], 45, 70)
    warn_len("meta_description", meta["meta_description"], 140, 160)
    if meta["summary_html"]:
        warn_len("summary_html", meta["summary_html"], 150, 160)
    if meta["related_products"]:
        print(f"   related     : {meta['related_products']}")

    if not args.confirm:
        print("\n   DRY RUN -- nothing written. Re-run with --confirm to publish.")
        return

    blog_id = resolve_blog_id(graphql, args.blog_handle)
    if not blog_id:
        sys.exit(f"ERROR: no blog with handle '{args.blog_handle}' on this store.")
    article["blogId"] = blog_id
    article = {k: v for k, v in article.items() if v is not None}

    data = graphql(
        "mutation($a:ArticleCreateInput!){ articleCreate(article:$a){ article{ id handle } userErrors{ field message } } }",
        {"a": article},
    )
    res = data["articleCreate"]
    if res["userErrors"]:
        sys.exit(f"userErrors: {json.dumps(res['userErrors'], ensure_ascii=False)}")
    print(f"\n   PUBLISHED -> {res['article']['id']}  (/{res['article']['handle']})")


# ---- pdp -------------------------------------------------------------------

def cmd_pdp(args, env):
    graphql = make_graphql(env)
    body = sanitize(Path(args.body_html).read_text(encoding="utf-8"))
    product = {"id": args.product_gid, "descriptionHtml": body}
    seo = {}
    if args.seo_title:
        seo["title"] = sanitize(args.seo_title)
    if args.seo_description:
        seo["description"] = sanitize(args.seo_description)
    if seo:
        product["seo"] = seo

    print(f"== PDP {'UPDATE' if args.confirm else 'DRY RUN'} ==")
    print(f"   product     : {args.product_gid}")
    print(f"   body        : {len(body)} chars of HTML")
    if args.seo_title:
        warn_len("seo_title", args.seo_title, 45, 70)
    if args.seo_description:
        warn_len("seo_description", args.seo_description, 140, 160)

    if not args.confirm:
        print("\n   DRY RUN -- nothing written. Re-run with --confirm to update the product.")
        return

    data = graphql(
        "mutation($p:ProductUpdateInput!){ productUpdate(product:$p){ product{ id handle } userErrors{ field message } } }",
        {"p": product},
    )
    res = data["productUpdate"]
    if res["userErrors"]:
        sys.exit(f"userErrors: {json.dumps(res['userErrors'], ensure_ascii=False)}")
    print(f"\n   UPDATED -> {res['product']['id']}  (/{res['product']['handle']})")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Publish copy to the live Shopify store (gated).")
    ap.add_argument("--tenant", default="gebeauty")
    sub = ap.add_subparsers(dest="mode", required=True)

    b = sub.add_parser("blog", help="create a blog article")
    b.add_argument("--tenant", default="gebeauty")
    b.add_argument("--blog-handle", required=True)
    b.add_argument("--title", required=True)
    b.add_argument("--author", default="GE Beauty")
    b.add_argument("--html", required=True, help="path to body HTML")
    b.add_argument("--metafields", help="path to metafields.md")
    b.add_argument("--publish", action="store_true", help="publish live (default: create as draft)")
    b.add_argument("--confirm", action="store_true", help="actually mutate (default: dry run)")

    p = sub.add_parser("pdp", help="update a product's description + SEO")
    p.add_argument("--tenant", default="gebeauty")
    p.add_argument("--product-gid", required=True)
    p.add_argument("--body-html", required=True, help="path to descriptionHtml")
    p.add_argument("--seo-title")
    p.add_argument("--seo-description")
    p.add_argument("--confirm", action="store_true", help="actually mutate (default: dry run)")

    args = ap.parse_args()
    env = load_env(args.tenant)
    if args.mode == "blog":
        cmd_blog(args, env)
    else:
        cmd_pdp(args, env)


if __name__ == "__main__":
    main()
