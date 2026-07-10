"""Batch-set custom.ingredients (approved friendly 'for dummies' copy) on the 11
remaining core products (GEB 001 already done). Targets only the real product-type
SKU per code, never [rappi]/[brinde]/assinatura dupes. Approved by Lucas 2026-07-02.
"""
import json
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = HERE.parent / ".env"

COPY = {
    "GEB 002": "Nutrição e maciez profunda: óleos de abacate, crambe, girassol, macadâmia e gergelim, manteigas de murumuru e cupuaçu, chia e linhaça.",
    "GEB 003": "Proteção térmica e nutrição: extrato de chia, trehalose, manteigas de murumuru e cupuaçu, óleos de abacate, girassol e crambe.",
    "GEB 020": "Hidratação e brilho: óleos de macadâmia, oliva, girassol e gergelim, com ômegas 3, 6, 7 e 9.",
    "GEB 021": "Definição com movimento: extratos de chia e linhaça e xilitol.",
    "GEB 022": "Controle de frizz e umidade: óleo de coco, extrato de chia e trehalose.",
    "GEB 023": "Proteção antioxidante: chá verde, D-pantenol, xilitol, extrato de chia, trehalose e galactoarabinana.",
    "GEB 024": "Brilho e hidratação perfumada: AcquaBio (extrato de angico) que hidrata a pele e ProShine que traz brilho ao fio.",
    "GEB 101": "Definição sem rigidez: extratos de chia e linhaça, complexo Omega Plus, óleos de macadâmia, coco, oliva, girassol e gergelim, trehalose e vitamina E.",
    "GEB 102": "Liso alinhado e protegido: óleos de crambe, abacate, girassol e coco, trehalose e vitamina E.",
    "GEB 120": "Leveza, brilho e proteção: D-pantenol, arginina, óleos de girassol, crambe e abacate, extratos de chia e linhaça, trehalose e vitamina E.",
    "GEB 121": "Reconstrução intensa: arginina e D-pantenol, óleos de abacate, girassol, macadâmia e gergelim, crambe, extratos de chia e linhaça.",
}


def load_env(path):
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


cfg = load_env(ENV)
DOMAIN = cfg.get("SHOPIFY_SHOP_DOMAIN", "ge-beauty-cosmeticos.myshopify.com")
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VERSION = cfg.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{DOMAIN}/admin/api/{VERSION}/graphql.json"

MUT = """
mutation($mf: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $mf) {
    metafields { key value ownerType }
    userErrors { field message }
  }
}
"""


def graphql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def resolve_ids():
    """Map each target SKU -> the single real product gid (product type, active,
    not rappi/brinde/assinatura)."""
    d = json.loads((HERE / "_catalog_shopify_dump.out.json").read_text(encoding="utf-8"))
    ids = {}
    for n in d:
        if (n.get("productType") or "").lower() != "product" or n["status"] != "ACTIVE":
            continue
        t = n["title"].lower()
        if t.startswith("[") or "assinatura" in t:
            continue
        for v in n["variants"]["nodes"]:
            sku = (v.get("sku") or "").strip()
            if sku in COPY:
                if sku in ids:
                    raise SystemExit(f"AMBIGUOUS {sku}: {ids[sku]} vs {n['id']} ({n['title']})")
                ids[sku] = n["id"]
    missing = [s for s in COPY if s not in ids]
    if missing:
        raise SystemExit(f"unresolved SKUs: {missing}")
    return ids


def main():
    ids = resolve_ids()
    mf = [{"ownerId": ids[sku], "namespace": "custom", "key": "ingredients",
           "type": "single_line_text_field", "value": COPY[sku]} for sku in COPY]
    d = graphql(MUT, {"mf": mf})
    errs = d.get("data", {}).get("metafieldsSet", {}).get("userErrors", [])
    if errs or "errors" in d:
        print("ERRORS:", json.dumps(d, ensure_ascii=False, indent=2)); return
    ok = d["data"]["metafieldsSet"]["metafields"]
    print(f"wrote custom.ingredients on {len(ok)} products:")
    for sku in COPY:
        print(f"  {sku}  {ids[sku].split('/')[-1]}")


if __name__ == "__main__":
    main()
