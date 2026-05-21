"""
For every Shopify order currently UNFULFILLED at CD Extrema, probe Omie
(account 000506) to determine its import state:

  - REJECTED_IMPORT: pedido is NOT cadastrado in Omie (the actual fiscal-
    block signal — Omie never accepted the Shopify->Omie sync because the
    fiscal scenario is blocked)
  - PRESENT: pedido exists in Omie (then capture its etapa)

Bucket the 257 orders, dump samples + summary, and persist to JSON.
Read-only.

Uses Shopify admin token + Omie creds from
  C:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\.env
"""
import json
import sys
import time
import urllib.request
import urllib.error
from collections import Counter
from pathlib import Path

ENV_PATH = Path(r"C:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\.env")


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


def omie_call(url, app_key, app_secret, method, param, timeout=30):
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
        try:
            err = json.loads(body_txt)
        except Exception:
            err = {"raw": body_txt[:300]}
        return {"_http_error": e.code, "_err": err}
    except Exception as e:
        return {"_error": str(e)}


def main():
    env = load_env(ENV_PATH)

    # Phase 1: pull all Shopify-Extrema orders.
    shop_domain = env["SHOPIFY_SHOP_DOMAIN"]
    shop_version = env.get("SHOPIFY_API_VERSION", "2025-01")
    shop_token = env["SHOPIFY_ADMIN_ACCESS_TOKEN"]

    shopify_query = """
    query Extrema($q: String!, $first: Int!, $after: String) {
      orders(query: $q, first: $first, after: $after, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            id name email createdAt
            shippingAddress { city province }
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
            print("Shopify error:", resp["errors"], file=sys.stderr)
            sys.exit(1)
        edges = resp["data"]["orders"]["edges"]
        for e in edges:
            n = e["node"]
            numeric_id = n["id"].replace("gid://shopify/Order/", "")
            shopify_orders.append({
                "id": numeric_id,
                "name": n["name"],
                "email": n.get("email"),
                "city": (n.get("shippingAddress") or {}).get("city"),
                "province": (n.get("shippingAddress") or {}).get("province"),
                "createdAt": n.get("createdAt"),
            })
        info = resp["data"]["orders"]["pageInfo"]
        print(f"  page {page} -> {len(edges)} (total {len(shopify_orders)})")
        if not info.get("hasNextPage"):
            break
        cursor = info.get("endCursor")

    total = len(shopify_orders)
    print(f"Shopify-Extrema total: {total}")
    print()

    # Phase 2: probe each Omie account for each order.
    pedido_url = "https://app.omie.com.br/api/v1/produtos/pedido/"
    omie_key = env["OMIE_APP_KEY_000506"]
    omie_secret = env["OMIE_APP_SECRET_000506"]

    results = []
    bucket = Counter()
    etapa_counts = Counter()
    print(f"Probing Omie 000506 for {total} orders (sequential)...")
    t0 = time.time()
    for i, o in enumerate(shopify_orders, start=1):
        resp = omie_call(pedido_url, omie_key, omie_secret, "ConsultarPedido", {
            "codigo_pedido_integracao": o["id"],
        })

        if "_http_error" in resp and resp.get("_err", {}).get("faultcode") == "SOAP-ENV:Client-103":
            state = "REJECTED_IMPORT"
            etapa = None
            numero_pedido = None
        elif "_http_error" in resp:
            state = "OTHER_ERROR"
            etapa = None
            numero_pedido = None
        elif "_error" in resp:
            state = "NETWORK_ERROR"
            etapa = None
            numero_pedido = None
        else:
            pv = resp.get("pedido_venda_produto") or {}
            cab = pv.get("cabecalho") or {}
            state = "PRESENT"
            etapa = cab.get("etapa")
            numero_pedido = cab.get("numero_pedido")
            etapa_counts[str(etapa)] += 1

        bucket[state] += 1
        results.append({
            "shopify_id": o["id"],
            "shopify_name": o["name"],
            "shopify_email": o["email"],
            "shopify_city": o["city"],
            "shopify_province": o["province"],
            "shopify_createdAt": o["createdAt"],
            "omie_state": state,
            "omie_etapa": etapa,
            "omie_numero_pedido": numero_pedido,
        })

        if i % 25 == 0:
            elapsed = time.time() - t0
            print(f"  {i}/{total}  rejected={bucket['REJECTED_IMPORT']}  present={bucket['PRESENT']}  other={bucket['OTHER_ERROR']+bucket['NETWORK_ERROR']}  elapsed={elapsed:.0f}s")
        time.sleep(0.15)  # gentle rate limit

    elapsed = time.time() - t0
    print()
    print(f"=== Summary (Omie 000506) ===")
    print(f"  Total Shopify orders at CD Extrema:  {total}")
    for state, n in bucket.most_common():
        print(f"    {state:<18} = {n}")
    if etapa_counts:
        print(f"  Etapas observed (PRESENT subset):")
        for et, n in etapa_counts.most_common():
            print(f"    etapa={et:<4} count={n}")
    print(f"  Elapsed: {elapsed:.0f}s")

    out = Path(__file__).parent / "_extrema_omie_state.json"
    out.write_text(json.dumps({
        "summary": {
            "total_shopify_extrema": total,
            "buckets": dict(bucket),
            "etapa_counts": dict(etapa_counts),
        },
        "orders": results,
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nDetail written to {out}")


if __name__ == "__main__":
    main()
