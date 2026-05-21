"""
Map out etapa distribution across recent Omie pedidos to find which stage
code represents 'NF-e rejected by SEFAZ'. Read-only.
"""
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path
from collections import Counter

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
        return {"_http_error": e.code, "_body": body_txt}
    except Exception as e:
        return {"_error": str(e)}


def main():
    env = load_env(ENV_PATH)
    app_key = env.get("OMIE_APP_KEY_000506")
    app_secret = env.get("OMIE_APP_SECRET_000506")

    today = datetime.now()
    start = today - timedelta(days=60)
    d_start = start.strftime("%d/%m/%Y")
    d_end = today.strftime("%d/%m/%Y")

    print(f"Window: {d_start} -> {d_end}")
    print()

    url = "https://app.omie.com.br/api/v1/produtos/pedido/"

    # Page through ~20 pages of pedidos (most-recent first) to collect etapa stats.
    etapa_counts = Counter()
    sample_by_etapa = {}
    max_pages = 10  # ~50 records per page = ~500 most recent

    for page in range(1, max_pages + 1):
        resp = omie_call(url, app_key, app_secret, "ListarPedidos", {
            "pagina": page,
            "registros_por_pagina": 50,
            "filtrar_por_data_de": d_start,
            "filtrar_por_data_ate": d_end,
        })
        if "_http_error" in resp or "_error" in resp:
            print(f"page {page} failed:", resp)
            break
        records = resp.get("pedido_venda_produto") or []
        if not records:
            break
        for p in records:
            cab = p.get("cabecalho", {})
            etapa = cab.get("etapa") or "?"
            etapa_counts[etapa] += 1
            if etapa not in sample_by_etapa:
                sample_by_etapa[etapa] = {
                    "etapa": etapa,
                    "numero_pedido": cab.get("numero_pedido"),
                    "codigo_pedido_integracao": cab.get("codigo_pedido_integracao"),
                    "data_previsao": cab.get("data_previsao"),
                    "encerrado": cab.get("encerrado"),
                    "enc_motivo": cab.get("enc_motivo"),
                    "bloqueado": cab.get("bloqueado"),
                    "origem_pedido": cab.get("origem_pedido"),
                }
        if page >= (resp.get("total_de_paginas") or 1):
            break

    print(f"Etapas observed across {sum(etapa_counts.values())} most-recent pedidos:")
    for etapa, n in sorted(etapa_counts.items()):
        print(f"  etapa={etapa}  count={n}")
    print()
    print("Sample (first) record per etapa:")
    for etapa in sorted(sample_by_etapa.keys()):
        print(json.dumps(sample_by_etapa[etapa], indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
