"""
Wire 4 "related collection" metafields onto EVERY blog article in the GE Beauty
Shopify store (LIVE + DRAFT), across all blogs except the test blog "{testes}".

Idempotent and re-runnable: reads existing values and skips articles whose 4
slots already match the canonical targets below.

Sets, in this exact order:
    custom.colecao_relacionada_1 = gid://shopify/Collection/515330376000  (body & hair mists)
    custom.colecao_relacionada_2 = gid://shopify/Collection/498288263488  (finalizadores)
    custom.colecao_relacionada_3 = gid://shopify/Collection/494063518016  (para todo dia)
    custom.colecao_relacionada_4 = gid://shopify/Collection/494063649088  (boosters)

Overwrites any prior values; the order above is canonical.

Run: C:/Python314/python.exe gebeauty/scripts/wire_blog_related_collections.py
"""

import io
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

# --- env (resolve .env from script location, not cwd) ---
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip()
    return env


ENV = load_env(ENV_PATH)
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
API_VERSION = ENV.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{SHOP}/admin/api/{API_VERSION}/graphql.json"

NAMESPACE = "custom"
TEST_BLOG_TITLE = "{testes}"

# canonical targets, in order: (key, collection GID)
TARGETS = [
    ("colecao_relacionada_1", "gid://shopify/Collection/515330376000"),
    ("colecao_relacionada_2", "gid://shopify/Collection/498288263488"),
    ("colecao_relacionada_3", "gid://shopify/Collection/494063518016"),
    ("colecao_relacionada_4", "gid://shopify/Collection/494063649088"),
]


def graphql(query, variables=None):
    body = json.dumps(
        {"query": query, **({"variables": variables} if variables else {})}
    ).encode("utf-8")
    req = urllib.request.Request(
        URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": TOKEN,
        },
    )
    while True:
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2)
                continue
            raise
    if "errors" in data:
        raise RuntimeError(f"GraphQL errors: {json.dumps(data['errors'])}")
    return data


def respect_throttle(data):
    cost = data.get("extensions", {}).get("cost", {})
    ts = cost.get("throttleStatus", {})
    avail = ts.get("currentlyAvailable")
    restore = ts.get("restoreRate", 200)
    if avail is not None and avail < 200:
        # sleep enough to climb back to a comfortable margin
        need = 400 - avail
        time.sleep(max(0.0, need / max(restore, 1)))


BLOGS_QUERY = """
query Blogs($after: String) {
  blogs(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle }
  }
}
"""

ARTICLES_QUERY = """
query Articles($id: ID!, $after: String) {
  blog(id: $id) {
    articles(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        m1: metafield(namespace: "custom", key: "colecao_relacionada_1") { value }
        m2: metafield(namespace: "custom", key: "colecao_relacionada_2") { value }
        m3: metafield(namespace: "custom", key: "colecao_relacionada_3") { value }
        m4: metafield(namespace: "custom", key: "colecao_relacionada_4") { value }
      }
    }
  }
}
"""

METAFIELDS_SET = """
mutation Set($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
"""


def fetch_blogs():
    blogs = []
    after = None
    while True:
        data = graphql(BLOGS_QUERY, {"after": after})
        respect_throttle(data)
        conn = data["data"]["blogs"]
        blogs.extend(conn["nodes"])
        if not conn["pageInfo"]["hasNextPage"]:
            break
        after = conn["pageInfo"]["endCursor"]
    return blogs


def fetch_articles(blog_id):
    arts = []
    after = None
    while True:
        data = graphql(ARTICLES_QUERY, {"id": blog_id, "after": after})
        respect_throttle(data)
        conn = data["data"]["blog"]["articles"]
        for n in conn["nodes"]:
            existing = {
                "colecao_relacionada_1": (n.get("m1") or {}).get("value"),
                "colecao_relacionada_2": (n.get("m2") or {}).get("value"),
                "colecao_relacionada_3": (n.get("m3") or {}).get("value"),
                "colecao_relacionada_4": (n.get("m4") or {}).get("value"),
            }
            arts.append({"id": n["id"], "existing": existing})
        if not conn["pageInfo"]["hasNextPage"]:
            break
        after = conn["pageInfo"]["endCursor"]
    return arts


def is_already_correct(existing):
    return all(existing.get(key) == gid for key, gid in TARGETS)


def build_metafields(article_id):
    return [
        {
            "ownerId": article_id,
            "namespace": NAMESPACE,
            "key": key,
            "type": "collection_reference",
            "value": gid,
        }
        for key, gid in TARGETS
    ]


def main():
    print(f"Store: {SHOP}  API: {API_VERSION}")
    blogs = fetch_blogs()
    target_blogs = [b for b in blogs if b["title"] != TEST_BLOG_TITLE]
    skipped_blogs = [b for b in blogs if b["title"] == TEST_BLOG_TITLE]
    print(f"Blogs found: {len(blogs)}  | processing: {len(target_blogs)}"
          f"  | skipping test blog(s): {[b['title'] for b in skipped_blogs]}")

    total_wired = 0
    total_skipped = 0
    total_seen = 0
    all_user_errors = []

    for blog in target_blogs:
        articles = fetch_articles(blog["id"])
        print(f"  blog '{blog['title']}' ({blog['handle']}): {len(articles)} articles")

        # articles that need writes
        to_write = [a for a in articles if not is_already_correct(a["existing"])]
        total_skipped += len(articles) - len(to_write)

        # batch: max 25 metafields/call = 6 articles (24 metafields) per call
        BATCH = 6
        for i in range(0, len(to_write), BATCH):
            batch = to_write[i:i + BATCH]
            metafields = []
            for a in batch:
                metafields.extend(build_metafields(a["id"]))
            data = graphql(METAFIELDS_SET, {"metafields": metafields})
            respect_throttle(data)
            errs = data["data"]["metafieldsSet"]["userErrors"]
            if errs:
                all_user_errors.extend(errs)
            else:
                total_wired += len(batch)

            total_seen += len(batch)
            if total_seen // 100 != (total_seen - len(batch)) // 100:
                print(f"    ... progress: {total_wired} wired, {total_skipped} skipped so far")

    print("\n=== SUMMARY ===")
    print(f"Total blogs processed: {len(target_blogs)}")
    print(f"Total articles wired: {total_wired}")
    print(f"Total skipped (already correct): {total_skipped}")
    print(f"Total userErrors: {len(all_user_errors)}")
    if all_user_errors:
        for e in all_user_errors:
            print(f"  - {e}")


if __name__ == "__main__":
    main()
