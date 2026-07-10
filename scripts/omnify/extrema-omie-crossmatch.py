"""
Full cross-match: Shopify orders UNFULFILLED at CD Extrema <-> Omie etapa=70
pedidos. Uses Shopify admin token from nami-works/.env (full-scope) and
Omie 000506 creds. Read-only.

Output:
  - Total Shopify-Extrema orders
  - Total Omie etapa=70 pedidos
  - Intersection (matched) with reason if available
  - Sets that don't match either way (sync gap signals)
  - JSON snapshot dumped to scripts/_extrema_crossmatch.json
"""
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parents[2] / "gebeauty" / ".env"


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def shopify_graphql(domain, version, token, query, variables):
    url = f"https://{domain}/admin/api/{version}/graphql.json"
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def omie_call(url, app_key, app_secret, method, param, timeout=120):
    body = json.dumps({
        "app_key": app_key,
        "app_secret": app_secret,
        "call": method,
        "param": [param],
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")
        return {"_http_error": e.code, "_body": body_txt[:500]}
    except Exception as e:
        return {"_error": str(e)}


def main():
    env = load_env(ENV_PATH)

    # ---- Phase 1: pull all Shopify-Extrema orders ----
    shop_domain = env["SHOPIFY_SHOP_DOMAIN"]
    shop_version = env.get("SHOPIFY_API_VERSION", "2025-01")
    shop_token = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]

    print(f"Shopify shop: {shop_domain}  api: {shop_version}")

    shopify_query = """
    query Extrema($q: String!, $first: Int!, $after: String) {
      orders(query: $q, first: $first, after: $after, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            id name email
            shippingAddress { city province }
            createdAt
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    """

    shop_filter = "fulfillment_location_id:105538257216 fulfillment_status:unshipped status:open"
    shopify_orders = []
    cursor = None
    page = 0
    print("Pulling Shopify-Extrema orders...")
    while True:
        page += 1
        resp = shopify_graphql(shop_domain, shop_version, shop_token, shopify_query, {
            "q": shop_filter, "first": 100, "after": cursor,
        })
        if "errors" in resp:
            print("Shopify error:", resp["errors"])
            sys.exit(1)
        edges = resp["data"]["orders"]["edges"]
        for e in edges:
            n = e["node"]
            numeric_id = n["id"].replace("gid://shopify/Order/", "")
            shopify_orders.append({
                "id": numeric_id,
                "gid": n["id"],
                "name": n["name"],
                "email": n.get("email"),
                "city": (n.get("shippingAddress") or {}).get("city"),
                "province": (n.get("shippingAddress") or {}).get("province"),
                "createdAt": n.get("createdAt"),
            })
        print(f"  page {page} -> {len(edges)} (cumulative {len(shopify_orders)})")
        page_info = resp["data"]["orders"]["pageInfo"]
        if not page_info.get("hasNextPage"):
            break
        cursor = page_info.get("endCursor")

    print(f"Shopify-Extrema orders total: {len(shopify_orders)}")
    print()

    shopify_by_id = {o["id"]: o for o in shopify_orders}
    shopify_by_name = {o["name"]: o for o in shopify_orders}

    # ---- Phase 2: pull all Omie etapa=70 pedidos ----
    omie_url = "https://app.omie.com.br/api/v1/produtos/pedido/"
    omie_key = env["OMIE_APP_KEY_000506"]
    omie_secret = env["OMIE_APP_SECRET_000506"]

    all_etapa70 = []
    page = 1
    print("Pulling Omie etapa=70 pedidos...")
    while True:
        resp = omie_call(omie_url, omie_key, omie_secret, "ListarPedidos", {
            "pagina": page, "registros_por_pagina": 50,
            "etapa": "70", "apenas_importado_api": "S",
        })
        if "_http_error" in resp or "_error" in resp:
            print(f"  Omie page {page} failed:", json.dumps(resp)[:300])
            break
        records = resp.get("pedido_venda_produto") or []
        if not records:
            break
        for p in records:
            cab = p.get("cabecalho", {}) or {}
            info = p.get("informacoes_adicionais", {}) or {}
            all_etapa70.append({
                "numero_pedido": cab.get("numero_pedido"),
                "codigo_pedido": cab.get("codigo_pedido"),
                "codigo_pedido_integracao": cab.get("codigo_pedido_integracao"),
                "numero_pedido_cliente": info.get("numero_pedido_cliente"),
                "data_previsao": cab.get("data_previsao"),
                "bloqueado": cab.get("bloqueado"),
                "origem_pedido": cab.get("origem_pedido"),
                "utilizar_emails": info.get("utilizar_emails"),
            })
        total_pages = resp.get("total_de_paginas") or 1
        print(f"  Omie page {page}/{total_pages} -> {len(records)} (cumulative {len(all_etapa70)})")
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.3)

    print(f"Omie etapa=70 pedidos total: {len(all_etapa70)}")
    print()

    # ---- Phase 3: cross-match ----
    matched = []
    unmatched_omie = []
    for p in all_etapa70:
        cpi = str(p.get("codigo_pedido_integracao") or "")
        npc = str(p.get("numero_pedido_cliente") or "")
        match = None
        via = None
        if cpi and cpi in shopify_by_id:
            match = shopify_by_id[cpi]
            via = "codigo_pedido_integracao"
        elif npc and npc in shopify_by_name:
            match = shopify_by_name[npc]
            via = "numero_pedido_cliente"
        if match:
            matched.append({"shopify": match, "omie": p, "match_via": via})
        else:
            unmatched_omie.append(p)

    matched_shop_ids = {m["shopify"]["id"] for m in matched}
    shopify_unmatched = [o for o in shopify_orders if o["id"] not in matched_shop_ids]

    print("=== Cross-match summary ===")
    print(f"  Shopify-Extrema orders:                    {len(shopify_orders)}")
    print(f"  Omie etapa=70 pedidos:                     {len(all_etapa70)}")
    print(f"  Matched (intersection):                    {len(matched)}")
    print(f"  Shopify orders WITHOUT Omie etapa=70:      {len(shopify_unmatched)}")
    print(f"  Omie etapa=70 pedidos WITHOUT Shopify:     {len(unmatched_omie)}")
    print()

    if matched:
        print("First 10 matched (Shopify <-> Omie):")
        for m in matched[:10]:
            s = m["shopify"]
            o = m["omie"]
            print(f"  #{s['name']:>6}  {s.get('city','?'):<22}  omie#{o['numero_pedido']:>6}  prev={o['data_previsao']}  via={m['match_via']}")
        print()

    if shopify_unmatched:
        print(f"First 10 Shopify-Extrema WITHOUT Omie etapa=70:")
        for o in shopify_unmatched[:10]:
            print(f"  #{o['name']:>6}  id={o['id']}  city={o.get('city','?'):<22}  created={o.get('createdAt','?')[:10]}")
        print()

    out = Path(__file__).parent / "_extrema_crossmatch.json"
    out.write_text(json.dumps({
        "totals": {
            "shopify_extrema": len(shopify_orders),
            "omie_etapa70": len(all_etapa70),
            "matched": len(matched),
            "shopify_unmatched": len(shopify_unmatched),
            "omie_unmatched": len(unmatched_omie),
        },
        "shopify_orders": shopify_orders,
        "matched": matched,
        "shopify_unmatched": shopify_unmatched,
        "omie_unmatched": unmatched_omie,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Full detail written to: {out}")


if __name__ == "__main__":
    main()
