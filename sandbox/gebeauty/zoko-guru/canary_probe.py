"""
Canary probe: does Zoko/Guru read Shopify metafields / metaobjects, or only the
product description body?

Plants distinct, unguessable tokens in three field types on ONE existing synced
product, then (after Zoko's 1-24h sync) you ask Guru to repeat the code and see which
token(s) come back. See read-scope-stress-test.md for the protocol + interpretation.

Two of the canaries are INVISIBLE to customers (unrendered custom metafields + a
metaobject not referenced by the theme). The body sentinel IS customer-visible and is
OFF by default (enable with --with-body); its original body is saved for exact revert.

Usage:
  python canary_probe.py plant            # invisible canaries only
  python canary_probe.py plant --with-body# also append a body sentinel (visible)
  python canary_probe.py revert           # remove everything, restore body

Read-only creds from ../.env. NOTHING runs until you invoke it; confirm with Lucas first
(HARD rule: confirm before Shopify mutations).
"""
import json, sys, urllib.request
from pathlib import Path

TARGET_HANDLE = "booster-antifrizz"   # existing, active, catalog-synced
TOK_META = "VERGGB-META-4417"
TOK_OBJ  = "VERGGB-OBJ-9265"
TOK_BODY = "VERGGB-BODY-1130"
MO_TYPE  = "zoko_canary"
STATE    = Path(__file__).resolve().parent / "canary_probe.state.json"

ENV = Path(__file__).resolve().parent.parent / ".env"
creds = {}
for line in ENV.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        creds[k.strip()] = v.strip().strip('"').strip("'")
DOMAIN, TOKEN = creds["SHOPIFY_SHOP_DOMAIN"], creds["SHOPIFY_ADMIN_ACCESS_TOKEN"]
VER = creds.get("SHOPIFY_API_VERSION", "2026-01")
URL = f"https://{DOMAIN}/admin/api/{VER}/graphql.json"

def gql(q, v=None):
    body = json.dumps({"query": q, **({"variables": v} if v else {})}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    with urllib.request.urlopen(req) as r:
        d = json.loads(r.read().decode())
    if "errors" in d:
        raise SystemExit(f"GraphQL error: {json.dumps(d['errors'], ensure_ascii=False)}")
    return d["data"]

def product(handle):
    d = gql("""query($h:String!){ productByHandle(handle:$h){ id title descriptionHtml } }""",
            {"h": handle})
    p = d["productByHandle"]
    if not p:
        raise SystemExit(f"Product '{handle}' not found")
    return p

def plant(with_body):
    p = product(TARGET_HANDLE)
    pid = p["id"]
    state = {"product": pid, "handle": TARGET_HANDLE, "with_body": with_body}

    # 1) metaobject definition (create if missing; fetch id if already TAKEN)
    d = gql("""mutation($def:MetaobjectDefinitionCreateInput!){
      metaobjectDefinitionCreate(definition:$def){
        metaobjectDefinition{ id } userErrors{ field message code } } }""",
      {"def": {"name": "Zoko Canary", "type": MO_TYPE,
               "fieldDefinitions": [{"key": "codigo", "name": "codigo",
                                     "type": "single_line_text_field"}]}})
    res = d["metaobjectDefinitionCreate"]
    errs = [e for e in res["userErrors"] if e.get("code") != "TAKEN"]
    if errs:
        raise SystemExit(f"def errors: {errs}")
    mo_def_id = (res["metaobjectDefinition"] or {}).get("id")
    if not mo_def_id:
        mo_def_id = gql("""query($t:String!){ metaobjectDefinitionByType(type:$t){ id } }""",
                        {"t": MO_TYPE})["metaobjectDefinitionByType"]["id"]
    state["def_id"] = mo_def_id

    # 2) metaobject entry with the OBJ token (find-or-create — avoid duplicates on re-run)
    existing = gql("""query($t:String!){ metaobjects(type:$t, first:10){
        nodes{ id fields{ key value } } } }""", {"t": MO_TYPE})["metaobjects"]["nodes"]
    mo_id = next((n["id"] for n in existing
                  if any(f["key"] == "codigo" and f["value"] == TOK_OBJ for f in n["fields"])), None)
    if not mo_id:
        res = gql("""mutation($mo:MetaobjectCreateInput!){
          metaobjectCreate(metaobject:$mo){ metaobject{ id } userErrors{ field message } } }""",
          {"mo": {"type": MO_TYPE, "fields": [{"key": "codigo", "value": TOK_OBJ}]}})["metaobjectCreate"]
        if res["userErrors"]:
            raise SystemExit(f"metaobject errors: {res['userErrors']}")
        mo_id = res["metaobject"]["id"]
    state["metaobject"] = mo_id

    # 3) metafield DEFINITION for the reference (metaobject_reference requires one)
    d = gql("""mutation($def:MetafieldDefinitionInput!){
      metafieldDefinitionCreate(definition:$def){
        createdDefinition{ id } userErrors{ field message code } } }""",
      {"def": {"name": "Zoko Canary Ref", "namespace": "custom", "key": "zoko_canary_ref",
               "type": "metaobject_reference", "ownerType": "PRODUCT",
               "validations": [{"name": "metaobject_definition_id", "value": mo_def_id}]}})
    res = d["metafieldDefinitionCreate"]
    errs = [e for e in res["userErrors"] if e.get("code") != "TAKEN"]
    if errs:
        raise SystemExit(f"metafield-def errors: {errs}")
    if res["createdDefinition"]:
        state["mf_def_id"] = res["createdDefinition"]["id"]

    # 4) product metafields: scalar text (ad-hoc) + metaobject reference
    d = gql("""mutation($mf:[MetafieldsSetInput!]!){
      metafieldsSet(metafields:$mf){ metafields{ key } userErrors{ field message } } }""",
      {"mf": [
        {"ownerId": pid, "namespace": "custom", "key": "zoko_canary_text",
         "type": "single_line_text_field", "value": TOK_META},
        {"ownerId": pid, "namespace": "custom", "key": "zoko_canary_ref",
         "type": "metaobject_reference", "value": mo_id},
      ]})
    if d["metafieldsSet"]["userErrors"]:
        raise SystemExit(f"metafield errors: {d['metafieldsSet']['userErrors']}")

    # 4) optional body sentinel (visible) — save original for exact revert
    if with_body:
        state["orig_body"] = p["descriptionHtml"]
        new_body = (p["descriptionHtml"] or "") + f"\n<p>Codigo de verificacao interno: {TOK_BODY}.</p>"
        d = gql("""mutation($id:ID!,$b:String!){
          productUpdate(input:{id:$id, descriptionHtml:$b}){ userErrors{ field message } } }""",
          {"id": pid, "b": new_body})
        if d["productUpdate"]["userErrors"]:
            raise SystemExit(f"body errors: {d['productUpdate']['userErrors']}")

    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print("=== planted ===")
    print(f"  product      : {p['title']} ({TARGET_HANDLE})")
    print(f"  metafield    : custom.zoko_canary_text = {TOK_META}  (invisible)")
    print(f"  metaobject   : {MO_TYPE}.codigo = {TOK_OBJ} via custom.zoko_canary_ref  (invisible)")
    print(f"  body sentinel: {'yes = '+TOK_BODY+' (VISIBLE)' if with_body else 'no'}")
    print(f"  state -> {STATE.name}")
    print("\nWait for Zoko sync (1-24h), then ask Guru: 'Qual e o codigo de verificacao interno do Booster Antifrizz?'")

def revert():
    if not STATE.exists():
        raise SystemExit("no state file; nothing to revert")
    s = json.loads(STATE.read_text(encoding="utf-8"))
    pid = s["product"]
    # scalar text metafield (ad-hoc, no definition)
    gql("""mutation($mf:[MetafieldIdentifierInput!]!){
      metafieldsDelete(metafields:$mf){ deletedMetafields{ key } userErrors{ field message } } }""",
      {"mf": [{"ownerId": pid, "namespace": "custom", "key": "zoko_canary_text"}]})
    # ref metafield definition (cascades the ref metafield value)
    if s.get("mf_def_id"):
        gql("""mutation($id:ID!){ metafieldDefinitionDelete(id:$id, deleteAllAssociatedMetafields:true){
          deletedDefinitionId userErrors{ message } } }""", {"id": s["mf_def_id"]})
    if s.get("metaobject"):
        gql("""mutation($id:ID!){ metaobjectDelete(id:$id){ deletedId userErrors{ message } } }""",
            {"id": s["metaobject"]})
    if s.get("def_id"):
        gql("""mutation($id:ID!){ metaobjectDefinitionDelete(id:$id){ deletedId userErrors{ message } } }""",
            {"id": s["def_id"]})
    if s.get("with_body") and "orig_body" in s:
        gql("""mutation($id:ID!,$b:String!){
          productUpdate(input:{id:$id, descriptionHtml:$b}){ userErrors{ message } } }""",
          {"id": pid, "b": s["orig_body"] or ""})
    STATE.unlink()
    print("=== reverted === store left as found")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "plant":
        plant("--with-body" in sys.argv)
    elif cmd == "revert":
        revert()
    else:
        raise SystemExit("usage: canary_probe.py [plant [--with-body] | revert]")
