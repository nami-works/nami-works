"""Create 3 Body & Hair Splash products as DRAFT skeletons (Rose Ritual, Pear Fresh,
Santal Skin), mirroring the Melon Mood template's structure. R$129,00 each.

Skeleton = title/handle/vendor/type/category/tags/status + variant (sku, barcode,
price, 0.2kg weight, HS 330720, tracked) + NCM metafield. Copy/INCI/images/stock deferred.

DRY-RUN by default; pass --execute to write. Idempotent: skips if handle already exists.
"""
import json, sys, urllib.request, os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
TOKEN = os.environ["SHOPIFY_ADMIN_ACCESS_TOKEN"]
URL = "https://ge-beauty-cosmeticos.myshopify.com/admin/api/2026-01/graphql.json"
DRY = "--execute" not in sys.argv

CATEGORY = "gid://shopify/TaxonomyCategory/hb-3-2-8-1"  # Body Mists
TAGS = ["avulso", "formula", "full-size", "lancto", "lancto-essencial",
        "para-todo-dia", "produto-full-size", "stockable"]

# (sku, storefront title, handle, barcode/ean, fragrance-notes placeholder desc)
SPLASHES = [
    ("GEB 025", "rose ritual | body & hair splash", "rose-ritual-body-hair-splash",
     "0631911748226", "rosas, musk e sândalo"),
    ("GEB 026", "pear fresh | body & hair splash", "pear-fresh-body-hair-splash",
     "0631911748219", "pêra, frésia e lírio"),
    ("GEB 027", "santal skin | body & hair splash", "santal-skin-body-hair-splash",
     "0631911748233", "sândalo, cardamomo e patchouli"),
]


def gql(q, v=None):
    b = json.dumps({"query": q, "variables": v or {}}).encode()
    r = urllib.request.Request(URL, data=b, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(r, timeout=60).read())


PRODUCT_CREATE = """
mutation($input: ProductInput!) {
  productCreate(input: $input) {
    product { id title handle status variants(first: 1) { edges { node { id } } } }
    userErrors { field message }
  }
}
"""
VARIANT_UPDATE = """
mutation($pid: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $pid, variants: $variants) {
    productVariants {
      id price barcode
      inventoryItem { sku tracked harmonizedSystemCode measurement { weight { value unit } } }
    }
    userErrors { field message }
  }
}
"""


def handle_exists(h):
    r = gql('query($q:String!){ products(first:1, query:$q){ edges{ node{ id handle } } } }',
            {"q": f"handle:{h}"})
    e = r["data"]["products"]["edges"]
    return e[0]["node"]["id"] if e else None


print(f"=== {'DRY-RUN' if DRY else 'EXECUTING'} :: create 3 DRAFT splash skeletons ===\n")
for sku, title, handle, ean, notes in SPLASHES:
    existing = handle_exists(handle)
    if existing:
        print(f"SKIP {title}: handle '{handle}' already exists ({existing})")
        continue

    p_input = {
        "title": title,
        "handle": handle,
        "vendor": "GE Beauty",
        "productType": "product",
        "status": "DRAFT",
        "tags": TAGS,
        "category": CATEGORY,
        "descriptionHtml": f"<p>Bruma perfumada para cabelo e corpo com fragrância de {notes}.</p>",
        "metafields": [
            {"namespace": "fullcomm", "key": "ncm", "type": "single_line_text_field",
             "value": "33072010"},
        ],
    }
    print(f"{title}  [{sku}]  handle={handle}  price=129.00  barcode={ean}")
    if DRY:
        print("   (dry-run) productCreate input:", json.dumps(p_input, ensure_ascii=False))
        print("   (dry-run) variant: sku, barcode, price 129.00, 0.2kg, HS 330720, tracked\n")
        continue

    r = gql(PRODUCT_CREATE, {"input": p_input})
    pc = r["data"]["productCreate"]
    if pc["userErrors"]:
        print("   productCreate ERROR:", json.dumps(pc["userErrors"], ensure_ascii=False)); continue
    pid = pc["product"]["id"]
    vid = pc["product"]["variants"]["edges"][0]["node"]["id"]

    vin = [{
        "id": vid,
        "price": "129.00",
        "barcode": ean,
        "taxable": True,
        "inventoryItem": {
            "sku": sku,
            "tracked": True,
            "requiresShipping": True,
            "harmonizedSystemCode": "330720",
            "measurement": {"weight": {"value": 0.2, "unit": "KILOGRAMS"}},
        },
    }]
    rv = gql(VARIANT_UPDATE, {"pid": pid, "variants": vin})
    vu = rv["data"]["productVariantsBulkUpdate"]
    if vu["userErrors"]:
        print(f"   created {pid} but variant ERROR:", json.dumps(vu["userErrors"], ensure_ascii=False)); continue
    pv = vu["productVariants"][0]
    print(f"   OK  product={pid.rsplit('/',1)[-1]}  variant set: sku={pv['inventoryItem']['sku']} "
          f"price={pv['price']} barcode={pv['barcode']} HS={pv['inventoryItem']['harmonizedSystemCode']} "
          f"wt={pv['inventoryItem']['measurement']['weight']}\n")

if DRY:
    print("(DRY-RUN — nothing written. Re-run with --execute.)")
