"""
Cross-match Omie pedidos at etapa=70 (stuck awaiting NF-e) against the
Shopify orders currently UNFULFILLED at CD Extrema. Read-only.

Output:
  - Total etapa=70 pedidos
  - Matched (pedido has integration key that maps to a CD Extrema Shopify order)
  - Pedidos at etapa=70 with no matching Shopify-Extrema order (likely older issue)
  - CD Extrema Shopify orders with no corresponding Omie pedido (sync gap)

Run with: PYTHONIOENCODING=utf-8 python scripts/omie-extrema-crossmatch.py

To pass the Shopify-Extrema order set, paste the list of Shopify order IDs
(numeric, without gid prefix) into SHOPIFY_EXTREMA_IDS below, OR rely on
the embedded snapshot below (current as of 2026-05-19).
"""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

ENV_PATH = Path(r"C:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\.env")

# Snapshot of 257 Shopify Order IDs (numeric) currently UNFULFILLED at CD Extrema.
# Source: this script pulls them live; this is the static fallback for re-runs.
# Lazy-load from a JSON file if it exists; else live-fetch via stdin paste.
SHOPIFY_EXTREMA_IDS_FILE = Path(__file__).parent / "_extrema_shopify_ids.json"


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


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
    if not SHOPIFY_EXTREMA_IDS_FILE.exists():
        print(f"Missing {SHOPIFY_EXTREMA_IDS_FILE}", file=sys.stderr)
        print("Expected JSON: { \"orders\": [{\"id\": \"7218576425280\", \"name\": \"80235\", \"city\": \"...\", \"email\": \"...\"}, ...] }", file=sys.stderr)
        sys.exit(2)

    snapshot = json.loads(SHOPIFY_EXTREMA_IDS_FILE.read_text(encoding="utf-8"))
    shopify_orders = snapshot.get("orders", [])
    shopify_ids = {str(o["id"]) for o in shopify_orders}
    shopify_names = {str(o["name"]) for o in shopify_orders}
    shopify_by_id = {str(o["id"]): o for o in shopify_orders}
    shopify_by_name = {str(o["name"]): o for o in shopify_orders}
    print(f"Loaded {len(shopify_orders)} Shopify orders at CD Extrema from snapshot")
    print()

    env = load_env(ENV_PATH)
    app_key = env.get("OMIE_APP_KEY_000506")
    app_secret = env.get("OMIE_APP_SECRET_000506")

    pedido_url = "https://app.omie.com.br/api/v1/produtos/pedido/"

    # Page through ALL etapa=70 pedidos (no date filter — we want the full set).
    all_etapa70 = []
    page = 1
    print("Fetching etapa=70 pedidos...")
    while True:
        resp = omie_call(pedido_url, app_key, app_secret, "ListarPedidos", {
            "pagina": page,
            "registros_por_pagina": 50,
            "etapa": "70",
            "apenas_importado_api": "S",
        })
        if "_http_error" in resp or "_error" in resp:
            print(f"page {page} failed:", json.dumps(resp)[:300])
            break
        records = resp.get("pedido_venda_produto") or []
        if not records:
            break
        for p in records:
            cab = p.get("cabecalho", {}) or {}
            info = p.get("informacoes_adicionais", {}) or {}
            all_etapa70.append({
                "numero_pedido": cab.get("numero_pedido"),
                "codigo_pedido_integracao": cab.get("codigo_pedido_integracao"),
                "numero_pedido_cliente": info.get("numero_pedido_cliente"),
                "data_previsao": cab.get("data_previsao"),
                "bloqueado": cab.get("bloqueado"),
                "origem_pedido": cab.get("origem_pedido"),
            })
        total_pages = resp.get("total_de_paginas") or 1
        print(f"  page {page}/{total_pages} — {len(records)} records (cumulative {len(all_etapa70)})")
        if page >= total_pages:
            break
        page += 1

    print()
    print(f"Total etapa=70 pedidos pulled: {len(all_etapa70)}")
    print()

    # Cross-match.
    matched = []
    unmatched_pedidos = []
    for p in all_etapa70:
        cpi = str(p.get("codigo_pedido_integracao") or "")
        npc = str(p.get("numero_pedido_cliente") or "")
        match = None
        if cpi and cpi in shopify_ids:
            match = ("id", shopify_by_id[cpi])
        elif npc and npc in shopify_names:
            match = ("name", shopify_by_name[npc])
        if match:
            matched.append({**p, "_match_via": match[0], "_shopify": match[1]})
        else:
            unmatched_pedidos.append(p)

    shopify_matched_ids = {m["_shopify"]["id"] for m in matched}
    shopify_unmatched = [o for o in shopify_orders if str(o["id"]) not in shopify_matched_ids]

    print(f"=== Cross-match summary ===")
    print(f"Omie etapa=70 pedidos:                              {len(all_etapa70)}")
    print(f"  → matched to a CD-Extrema Shopify order:          {len(matched)}")
    print(f"  → unmatched (no matching Shopify-Extrema order):  {len(unmatched_pedidos)}")
    print(f"Shopify orders at CD Extrema:                        {len(shopify_orders)}")
    print(f"  → have a matching Omie etapa=70 pedido:           {len(matched)}")
    print(f"  → NO matching Omie etapa=70 pedido (sync gap?):   {len(shopify_unmatched)}")
    print()

    if matched:
        print(f"First 10 matched (Shopify ↔ Omie):")
        for m in matched[:10]:
            s = m["_shopify"]
            print(f"  #{s['name']:>6}  city={s.get('city','?'):<20}  omie#{m['numero_pedido']:>6}  prev={m['data_previsao']}  via={m['_match_via']}")
        print()

    if shopify_unmatched:
        print(f"First 10 Shopify-Extrema orders WITHOUT Omie etapa=70 match:")
        for o in shopify_unmatched[:10]:
            print(f"  #{o['name']:>6}  id={o['id']}  city={o.get('city','?'):<20}")
        print()

    if unmatched_pedidos:
        print(f"First 5 Omie etapa=70 WITHOUT Shopify-Extrema match (older/non-Extrema):")
        for p in unmatched_pedidos[:5]:
            print(f"  omie#{p['numero_pedido']}  cpi={p['codigo_pedido_integracao']}  cliente={p['numero_pedido_cliente']}  prev={p['data_previsao']}")

    # Persist matched list for downstream use.
    out_file = Path(__file__).parent / "_extrema_omie_match.json"
    out_file.write_text(json.dumps({
        "matched": [{"shopify": m["_shopify"], "omie": {k: v for k, v in m.items() if k not in ("_match_via", "_shopify")}} for m in matched],
        "shopify_unmatched": shopify_unmatched,
        "omie_unmatched_count": len(unmatched_pedidos),
        "totals": {
            "omie_etapa70": len(all_etapa70),
            "shopify_extrema": len(shopify_orders),
            "matched": len(matched),
        },
    }, indent=2, ensure_ascii=False), encoding="utf-8")
    print()
    print(f"Detail written to: {out_file}")


if __name__ == "__main__":
    main()
