"""
Probe Omie's NF-e endpoints for SEFAZ-rejection signal. Also drill into a
single etapa=70 pedido to see why it's stuck (data_pedido vs data_previsao,
any nfe object, status fields).
"""
import json
import sys
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
        return {"_http_error": e.code, "_body": body_txt[:500]}
    except Exception as e:
        return {"_error": str(e)}


def main():
    env = load_env(ENV_PATH)
    app_key = env.get("OMIE_APP_KEY_000506")
    app_secret = env.get("OMIE_APP_SECRET_000506")

    # ---------------------------------------------------------------
    # Drill into one etapa=70 pedido with all detail flags on.
    # ---------------------------------------------------------------
    pedido_url = "https://app.omie.com.br/api/v1/produtos/pedido/"
    print("=== ConsultarPedido on numero_pedido=2390 (etapa=70 sample) ===")
    resp = omie_call(pedido_url, app_key, app_secret, "ConsultarPedido", {
        "numero_pedido": "2390",
    })
    if "_http_error" not in resp and "_error" not in resp:
        cab = (resp.get("pedido_venda_produto") or {}).get("cabecalho") or {}
        info = (resp.get("pedido_venda_produto") or {}).get("informacoes_adicionais") or {}
        observacoes = (resp.get("pedido_venda_produto") or {}).get("observacoes") or {}
        print("cabecalho keys:", list(cab.keys()))
        print(json.dumps({"cabecalho": cab, "informacoes_adicionais": info, "observacoes": observacoes}, indent=2, ensure_ascii=False)[:3000])
    else:
        print(json.dumps(resp, indent=2, ensure_ascii=False))
    print()

    # ---------------------------------------------------------------
    # NF-e endpoints: try a few known method names.
    # ---------------------------------------------------------------
    nf_endpoints = [
        ("/api/v1/produtos/nfconsultar/", "ListarNF"),
        ("/api/v1/produtos/nfconsultar/", "ListarNotasFiscais"),
        ("/api/v1/produtos/nfconsultar/", "ConsultarNF"),
        ("/api/v1/produtos/nfe/", "ListarNFe"),
        ("/api/v1/produtos/notafiscal/", "ListarNotasFiscais"),
        ("/api/v1/contador/xml/", "ListarDocumentos"),
        ("/api/v1/contador/notafiscal/", "ListarNF"),
        ("/api/v1/produtos/xmlnfe/", "ListarXMLNotaFiscal"),
    ]

    for path, method in nf_endpoints:
        url = f"https://app.omie.com.br{path}"
        print(f"=== {path} {method} ===")
        resp = omie_call(url, app_key, app_secret, method, {
            "pagina": 1,
            "registros_por_pagina": 3,
        })
        if "_http_error" in resp:
            print(f"  HTTP {resp['_http_error']}: {resp['_body'][:200]}")
        elif "_error" in resp:
            print(f"  ERR: {resp['_error']}")
        else:
            # Compact print: just keys + first record summary
            top_keys = list(resp.keys())
            print(f"  OK. top keys: {top_keys}")
            for k, v in resp.items():
                if isinstance(v, list) and v:
                    print(f"  {k}[0] keys: {list(v[0].keys()) if isinstance(v[0], dict) else type(v[0]).__name__}")
                    print(f"  {k}[0]: {json.dumps(v[0], ensure_ascii=False)[:600]}")
                    break
        print()


if __name__ == "__main__":
    main()
