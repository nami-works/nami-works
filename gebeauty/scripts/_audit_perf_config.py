"""Read-only Shopify Admin config probe for the performance-leverage audit.

Checks which matrix features are configured server-side (themes, script tags,
metaobject definitions, selling plans/subscriptions, native bundles, deployed
Functions, markets, plan tier). Read-only: no mutations. Each query is isolated
so a missing scope or unsupported field never aborts the run.
"""
import json
import os
import urllib.request
import urllib.error
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
DOMAIN = os.environ["SHOPIFY_SHOP_DOMAIN"]
VERSION = os.environ.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{DOMAIN}/admin/api/{VERSION}/graphql.json"


def graphql(query, variables=None):
    body = json.dumps({"query": query, **({"variables": variables} if variables else {})}).encode()
    req = urllib.request.Request(
        URL,
        data=body,
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode()[:500]}
    except Exception as e:  # noqa: BLE001
        return {"_error": str(e)}


QUERIES = {
    "shop_plan": """{ shop { name myshopifyDomain plan { displayName partnerDevelopment shopifyPlus } } }""",
    "script_tags": """{ scriptTags(first: 50) { nodes { src displayScope } } }""",
    "metaobject_defs": """{ metaobjectDefinitions(first: 60) { nodes { type name metaobjectsCount } } }""",
    "selling_plan_groups": """{ sellingPlanGroups(first: 30) { nodes { name merchantCode summary } } }""",
    "shopify_functions": """{ shopifyFunctions(first: 60) { nodes { title apiType app { title } } } }""",
    "markets": """{ markets(first: 20) { nodes { name handle enabled primary } } }""",
    "automatic_discounts": """{ automaticDiscountNodes(first: 30) { nodes { automaticDiscount { __typename ... on DiscountAutomaticBasic { title status } ... on DiscountAutomaticBxgy { title status } ... on DiscountAutomaticApp { title status } } } } }""",
    "bundle_products": """{ products(first: 50, query: \"tag:bundle OR tag:kits OR tag:dupla\") { nodes { handle title hasOnlyDefaultVariant } } }""",
    "publications": """{ publications(first: 20) { nodes { name } } }""",
}

# Native-bundle check: sample a few variants for components.
BUNDLE_COMPONENT_PROBE = """
{
  products(first: 10, query: "tag:bundle OR tag:kits") {
    nodes {
      title
      variants(first: 3) {
        nodes {
          title
          components(first: 5) { nodes { quantity productVariant { product { title } } } }
        }
      }
    }
  }
}
"""

out = {}
for key, q in QUERIES.items():
    out[key] = graphql(q)

out["bundle_component_probe"] = graphql(BUNDLE_COMPONENT_PROBE)

dest = Path(__file__).resolve().parent / "_audit_perf_config.out.json"
dest.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Wrote {dest}")

# Compact console summary
def summ(node_path, key):
    d = out.get(key, {})
    if "_http_error" in d:
        return f"ACCESS/ERROR http {d['_http_error']}"
    if "_error" in d:
        return f"ERROR {d['_error']}"
    errs = d.get("errors")
    if errs:
        return f"GQL-ERR {errs[0].get('message','')[:80]}"
    data = d.get("data", {})
    cur = data
    for p in node_path:
        cur = (cur or {}).get(p, {})
    nodes = (cur or {}).get("nodes", []) if isinstance(cur, dict) else cur
    return f"{len(nodes)} items" if isinstance(nodes, list) else str(cur)

print("plan:", json.dumps(out.get("shop_plan", {}).get("data", {}).get("shop", {}).get("plan", out.get("shop_plan"))))
print("script_tags:", summ(["scriptTags"], "script_tags"))
print("metaobject_defs:", summ(["metaobjectDefinitions"], "metaobject_defs"))
print("selling_plan_groups:", summ(["sellingPlanGroups"], "selling_plan_groups"))
print("shopify_functions:", summ(["shopifyFunctions"], "shopify_functions"))
print("markets:", summ(["markets"], "markets"))
print("automatic_discounts:", summ(["automaticDiscountNodes"], "automatic_discounts"))
print("bundle_products:", summ(["products"], "bundle_products"))
