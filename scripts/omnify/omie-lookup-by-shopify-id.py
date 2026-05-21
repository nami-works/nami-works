"""
Look up Omie pedidos for two specific Shopify orders (80846 + 80850) to
identify which Omie status code = 'NF-e rejected by SEFAZ' (the correct
state to fetch for the cross-match).
"""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

ENV_PATH = Path(r"C:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\.env")

# (Shopify order name, Shopify Order numeric ID)
TARGETS = [
    ("80846", "7272360313152"),
    ("80850", "7272599093568"),
]


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def omie_call(url, app_key, app_secret, method, param, timeout=60):
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
        return {"_http_error": e.code, "_body": body_txt[:600]}
    except Exception as e:
        return {"_error": str(e)}


def main():
    env = load_env(ENV_PATH)
    pedido_url = "https://app.omie.com.br/api/v1/produtos/pedido/"
    accounts = [
        ("000506", env["OMIE_APP_KEY_000506"], env["OMIE_APP_SECRET_000506"]),
        ("000174", env["OMIE_APP_KEY_000174"], env["OMIE_APP_SECRET_000174"]),
    ]

    for company, app_key, app_secret in accounts:
      print(f"\n##### Omie company {company} #####\n")
      for shopify_name, shopify_id in TARGETS:
        print(f"=== Shopify #{shopify_name} (id={shopify_id}) ===")

        # Try by codigo_pedido_integracao first (Shopify Order ID).
        resp = omie_call(pedido_url, app_key, app_secret, "ConsultarPedido", {
            "codigo_pedido_integracao": shopify_id,
        })

        if "_http_error" in resp or "_error" in resp:
            print(f"  ConsultarPedido by integracao failed: {json.dumps(resp)[:300]}")
            # Fallback: ListarPedidos with the Shopify name as cliente filter.
            resp2 = omie_call(pedido_url, app_key, app_secret, "ListarPedidos", {
                "pagina": 1, "registros_por_pagina": 5,
                "filtrar_por_numero_pedido_cliente": shopify_name,
            })
            print(f"  ListarPedidos by numero_pedido_cliente: {json.dumps(resp2, ensure_ascii=False)[:800]}")
            print()
            continue

        # Got a pedido — dump the full structure so we can see status fields.
        pv = resp.get("pedido_venda_produto") or {}
        cab = pv.get("cabecalho") or {}
        info = pv.get("informacoes_adicionais") or {}
        observacoes = pv.get("observacoes") or {}
        total = pv.get("total_pedido") or {}

        print(f"  cabecalho:")
        print(f"    numero_pedido         = {cab.get('numero_pedido')}")
        print(f"    etapa                 = {cab.get('etapa')}")
        print(f"    codigo_pedido_integracao = {cab.get('codigo_pedido_integracao')}")
        print(f"    bloqueado             = {cab.get('bloqueado')}")
        print(f"    encerrado             = {cab.get('encerrado')}")
        print(f"    origem_pedido         = {cab.get('origem_pedido')}")
        print(f"    importado_api         = {cab.get('importado_api')}")
        print(f"  informacoes_adicionais:")
        print(f"    numero_pedido_cliente = {info.get('numero_pedido_cliente')}")
        print(f"    consumidor_final      = {info.get('consumidor_final')}")
        print(f"    enviar_email          = {info.get('enviar_email')}")

        # Look for ANY field that looks like a status / nf reference.
        print(f"  cabecalho FULL keys: {list(cab.keys())}")
        print(f"  pv FULL top-level keys: {list(pv.keys())}")

        # Dump the entire response so any status / nfe / rejeicao field surfaces.
        # Truncate to 4000 chars per record.
        full = json.dumps(pv, indent=2, ensure_ascii=False)
        if len(full) > 4500:
            print(f"  --- truncated dump (first 4500 chars) ---")
            print(full[:4500])
        else:
            print(f"  --- full dump ---")
            print(full)
        print()


if __name__ == "__main__":
    main()
