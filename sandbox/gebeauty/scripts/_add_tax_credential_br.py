"""Patch the 4 CPF-reissue drafts with localizedFields[TAX_CREDENTIAL_BR].

Shopify rejected draft completion with "Enter a valid CPF/CNPJ" because the
proper slot is the Brazil-localized TAX_CREDENTIAL_BR field, not company.
This script calls draftOrderUpdate on each draft to add it.

Also adds SHIPPING_CREDENTIAL_BR (same CPF) for safety, since Brazilian fiscal
flows sometimes need both.
"""
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"

DRAFTS = [
    # (draft_id, cpf, original_order_name)
    ("1281283981632", "66512514149", "77351"),
    ("1281284047168", "16885963801", "77348"),
    ("1281284079936", "29410777828", "77336"),
    ("1281284112704", "41311124420", "77327"),
]


def load_env():
    env = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


ENV = load_env()
TOKEN = ENV["SHOPIFY_ADMIN_ACCESS_TOKEN"]
SHOP = ENV["SHOPIFY_SHOP_DOMAIN"]
VER = ENV.get("SHOPIFY_API_VERSION", "2026-01")
GQL_URL = f"https://{SHOP}/admin/api/{VER}/graphql.json"


def gql(query, variables=None):
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(GQL_URL, data=body, headers={
        "X-Shopify-Access-Token": TOKEN,
        "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


UPDATE_MUT = """
mutation DraftPatchCPF($id: ID!, $input: DraftOrderInput!) {
  draftOrderUpdate(id: $id, input: $input) {
    draftOrder {
      id
      name
      totalPrice
      billingAddress { company }
      localizedFields(first: 10) { nodes { key title value countryCode } }
    }
    userErrors { field message }
  }
}
"""


def main():
    results = []
    for draft_id, cpf, orig in DRAFTS:
        gid = f"gid://shopify/DraftOrder/{draft_id}"
        inp = {
            "localizedFields": [
                {"key": "TAX_CREDENTIAL_BR", "value": cpf},
                {"key": "SHIPPING_CREDENTIAL_BR", "value": cpf},
            ],
        }
        print(f"\n=== draft {draft_id} (from #{orig}) -> CPF {cpf} ===")
        resp = gql(UPDATE_MUT, {"id": gid, "input": inp})
        errs = (resp.get("data", {}).get("draftOrderUpdate", {}) or {}).get("userErrors") or []
        top = resp.get("errors") or []
        if errs or top:
            print("  [FAIL]")
            for e in errs:
                print(f"     userError: field={e.get('field')} message={e.get('message')}")
            for e in top:
                print(f"     topError : {e.get('message')}")
            results.append((orig, draft_id, False, errs or top))
            continue
        d = resp["data"]["draftOrderUpdate"]["draftOrder"]
        lfs = (d.get("localizedFields") or {}).get("nodes") or []
        tax = next((f for f in lfs if f.get("key") == "tax_credential_br"), None)
        ship = next((f for f in lfs if f.get("key") == "shipping_credential_br"), None)
        print(f"  [OK] {d['name']}  totalPrice=R${d['totalPrice']}")
        print(f"     tax_credential_br      = {tax and tax.get('value')!r}")
        print(f"     shipping_credential_br = {ship and ship.get('value')!r}")
        print(f"     billing.company        = {(d.get('billingAddress') or {}).get('company')!r}")
        ok = (tax and tax.get("value") == cpf)
        results.append((orig, draft_id, ok, None))

    print("\n\n=== SUMMARY ===")
    for orig, draft_id, ok, err in results:
        status = "OK " if ok else "FAIL"
        print(f"  [{status}] #{orig} draft={draft_id}  {err or ''}")


if __name__ == "__main__":
    main()
