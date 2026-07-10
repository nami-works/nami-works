"""Finalize PDP media: (1) reorder GEB 008 to hero>benefits>ingredients>usage,
(2) set descriptive alt on all previously-blank images (024, 121, 001, 008, 019,
101, 102) so the blank-alt defect is fixed and the order/Amazon feed are correct.
Idempotent. Approved by Lucas 2026-07-06."""
import json
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ENV = Path(__file__).resolve().parent.parent / ".env"


def load_env(p):
    o = {}
    for l in p.read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1)
            o[k.strip()] = v.strip().strip('"').strip("'")
    return o


cfg = load_env(ENV)
URL = f"https://{cfg['SHOPIFY_SHOP_DOMAIN']}/admin/api/{cfg.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
TOKEN = cfg["SHOPIFY_ADMIN_ACCESS_TOKEN"]


def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}}).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN})
    return json.loads(urllib.request.urlopen(req).read().decode("utf-8"))


# alt text per previously-blank MediaImage id
ALT = {
    # Melon Mood 024
    "41544017281344": "Benefícios do Melon Mood Body & Hair Mist GE Beauty: perfuma cabelo e corpo, sela as cutículas e hidrata a pele por até 72h",
    "41544016920896": "Ativos vegetais do Melon Mood GE Beauty que selam as cutículas e promovem hidratação por até 72 horas",
    "42742642639168": "Melon Mood GE Beauty citado pela ELLE Brasil: cheirinho de melão inconfundível que ainda hidrata os fios",
    "41398640378176": "Melon Mood Body & Hair Mist GE Beauty mergulhado em água com flor de peônia e fatias de melão",
    "41398640148800": "Melon Mood GE Beauty em spray, demonstrando a bruma perfumada para cabelo e corpo",
    # Mayday 121
    "42101101429056": "Benefícios da Máscara Mayday GE Beauty: reconstrói massa e lipídios, restaura danos e devolve força aos fios",
    "42125908377920": "Ativos da Máscara Mayday GE Beauty: arginina, D-pantenol, óleo de abacate e óleo de girassol",
    "41902725169472": "Textura da Máscara Mayday GE Beauty, creme reconstrutor branco no pote vermelho aberto",
    "41902725235008": "Máscara Mayday GE Beauty, pote fechado do tratamento de reconstrução profunda 200ml",
    # 019 Booster Fortificante (Marie Claire press)
    "GEB019_p6": "Booster Fortificante GE Beauty citado pela Marie Claire: dá força aos fios e ajuda quem tem oleosidade",
    # 001 Shampoo sem Sulfato (Marie Claire press)
    "GEB001_p6": "Shampoo sem Sulfato GE Beauty citado pela Marie Claire: limpa sem ressecar os fios nem agredir o couro cabeludo",
    # 008 Shampoo a Seco (benefits + ingredients)
    "GEB008_p3": "Benefícios do Shampoo a Seco GE Beauty: renova a limpeza em 30 segundos, controla a oleosidade e dá volume",
    "GEB008_p4": "Ativos do Shampoo a Seco GE Beauty: biotina, algas vermelhas, mentol e pantenol",
    # 101 Primer Cachos (ELLE press)
    "GEB101_p6": "Primer Cachos Definidos GE Beauty citado pela ELLE Brasil: mantém os cachos definidos no dia a dia",
    # 102 Primer Liso (Steal The Look press)
    "GEB102_p6": "Primer Liso Intacto GE Beauty citado pela Steal The Look: controla o frizz mesmo em tempo úmido e nublado",
}

FILEUPDATE = "mutation($files:[FileUpdateInput!]!){ fileUpdate(files:$files){ files{ id alt } userErrors{ field message } } }"
REORDER = "mutation($id:ID!,$moves:[MoveInput!]!){ productReorderMedia(id:$id,moves:$moves){ job{id} userErrors{field message} } }"
MEDIA = "query($id:ID!){ product(id:$id){ media(first:25){ nodes{ id ... on MediaImage{ alt } } } } }"


def resolve_blank_ids():
    """Map the GEBxxx_pN placeholders to real MediaImage ids from the blanks index."""
    idx = Path("C:/Users/LUCASG~1/AppData/Local/Temp/claude/c--Users-Lucas-Guimar-es-Desktop-nami-works/f1b793b4-d70c-4765-8c5d-5a5545260e9d/scratchpad/blanks/_index.json")
    m = {}
    for b in json.loads(idx.read_text(encoding="utf-8")):
        key = f"{b['sku'].replace(' ','')}_p{b['pos']}"
        m[key] = b["id"].split("/")[-1]
    return m


def main():
    blank_ids = resolve_blank_ids()
    # 1) reorder GEB 008: hero, benefits(p3), ingredients(p4), usage(p2)
    p008 = "gid://shopify/Product/" + "".join(filter(str.isdigit, ""))  # placeholder, resolve below
    # resolve 008 product id + media order
    dump = json.loads((Path(__file__).resolve().parent / "_catalog_shopify_dump.out.json").read_text(encoding="utf-8"))
    pid008 = None
    for n in dump:
        v = (n["variants"]["nodes"] or [{}])[0]
        if (v.get("sku") or "").strip() == "GEB 008" and (n.get("productType") or "").lower() == "product":
            pid008 = n["id"]; break
    md = gql(MEDIA, {"id": pid008})["data"]["product"]["media"]["nodes"]
    # current order roles: [hero, usage, benefits, ingredients] (post earlier reorder)
    # desired: hero, benefits, ingredients, usage
    ids = [m["id"] for m in md]
    # identify by matching known blank ids for p3/p4 (benefits/ingredients)
    ben = "gid://shopify/MediaImage/" + blank_ids["GEB008_p3"]
    ing = "gid://shopify/MediaImage/" + blank_ids["GEB008_p4"]
    hero = ids[0]
    rest = [i for i in ids if i not in (hero, ben, ing)]  # the usage/other shots
    new008 = [hero, ben, ing] + rest
    if new008 != ids:
        moves = [{"id": mid, "newPosition": str(i)} for i, mid in enumerate(new008)]
        r = gql(REORDER, {"id": pid008, "moves": moves})
        print("008 reorder:", r.get("data", {}).get("productReorderMedia", {}).get("userErrors") or "ok")
    else:
        print("008 already ordered")

    # 2) set alt on all previously-blank images
    files = []
    for k, alt in ALT.items():
        mid = k if k.isdigit() else blank_ids.get(k)
        if not mid:
            print("  (no id for", k, ")"); continue
        files.append({"id": f"gid://shopify/MediaImage/{mid}", "alt": alt})
    for i in range(0, len(files), 20):
        d = gql(FILEUPDATE, {"files": files[i:i+20]})
        res = d.get("data", {}).get("fileUpdate", {})
        errs = res.get("userErrors") or d.get("errors")
        print("alt batch:", "ok" if not errs else errs, f"({len(res.get('files',[]))} set)")


if __name__ == "__main__":
    main()
