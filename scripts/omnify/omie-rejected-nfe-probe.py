"""
Probe Omie for NF-e in error/rejection state for company 000506,
and dump the fields that look like Shopify-matching keys so we can
pick the right join column.

Read-only. Calls a few Omie list endpoints, looking for SEFAZ-rejected
docs in the last 60 days. Prints up to 5 sample records with their
integration-key fields exposed.
"""
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path

ENV_PATH = Path(r"C:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\.env")


def load_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def omie_call(url: str, app_key: str, app_secret: str, method: str, param: dict) -> dict:
    body = json.dumps({
        "app_key": app_key,
        "app_secret": app_secret,
        "call": method,
        "param": [param],
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
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
    if not app_key or not app_secret:
        print("Missing OMIE_APP_KEY_000506 / OMIE_APP_SECRET_000506", file=sys.stderr)
        sys.exit(1)

    print(f"OMIE creds loaded (key prefix {app_key[:6]}…)")
    print()

    # Recent window: last 60 days for rejection sweeping.
    today = datetime.now()
    start = today - timedelta(days=60)
    d_start = start.strftime("%d/%m/%Y")
    d_end = today.strftime("%d/%m/%Y")

    # ------------------------------------------------------------------
    # Probe 1: ListarDocumentos under DF-e namespace.
    # ------------------------------------------------------------------
    print("=== Probe 1: /produtos/dfedocs/ ListarDocumentos ===")
    url = "https://app.omie.com.br/api/v1/produtos/dfedocs/"
    resp = omie_call(url, app_key, app_secret, "ListarDocumentos", {
        "pagina": 1,
        "registros_por_pagina": 50,
        "filtrar_emissao_de": d_start,
        "filtrar_emissao_ate": d_end,
    })
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:3000])
    print()

    # ------------------------------------------------------------------
    # Probe 2: NF-e issued list under /produtos/notafiscalemitida/
    # ------------------------------------------------------------------
    print("=== Probe 2: /produtos/notafiscalemitida/ ListarNFEmitida ===")
    url = "https://app.omie.com.br/api/v1/produtos/notafiscalemitida/"
    resp = omie_call(url, app_key, app_secret, "ListarNFEmitida", {
        "pagina": 1,
        "registros_por_pagina": 50,
        "data_inicial": d_start,
        "data_final": d_end,
    })
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:3000])
    print()

    # ------------------------------------------------------------------
    # Probe 3: Pedido de Venda with etapa filter (rejected stage).
    # ------------------------------------------------------------------
    print("=== Probe 3: /produtos/pedido/ ListarPedidos (recent) ===")
    url = "https://app.omie.com.br/api/v1/produtos/pedido/"
    resp = omie_call(url, app_key, app_secret, "ListarPedidos", {
        "pagina": 1,
        "registros_por_pagina": 5,
        "apenas_importado_api": "N",
        "filtrar_por_data_de": d_start,
        "filtrar_por_data_ate": d_end,
    })
    print(json.dumps(resp, indent=2, ensure_ascii=False)[:4000])
    print()


if __name__ == "__main__":
    main()
