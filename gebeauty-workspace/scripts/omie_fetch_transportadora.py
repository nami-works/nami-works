"""
Fetch a transportadora (carrier) record from Omie by CNPJ.

Prints codigo_cliente_omie (the "código da transportadora" referenced as
nCodTransp in NF-e / Pedido-de-Venda payloads), plus identifying fields
and tags so you can confirm it's the right record.

Read-only: calls ListarClientes then ConsultarCliente. Writes nothing.
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

CNPJ = "42.584.754/0001-86"
ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/"


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def omie_call(app_key, app_secret, method, param):
    body = json.dumps({
        "app_key": app_key,
        "app_secret": app_secret,
        "call": method,
        "param": [param],
    }).encode("utf-8")
    req = urllib.request.Request(
        OMIE_URL,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[omie] {method} FAILED http={e.code}", file=sys.stderr)
        print(body, file=sys.stderr)
        sys.exit(1)


def main():
    env = load_env(ENV_PATH)
    app_key = env.get("OMIE_APP_KEY_000506")
    app_secret = env.get("OMIE_APP_SECRET_000506")
    if not app_key or not app_secret:
        print("[omie] missing OMIE_APP_KEY_000506 / OMIE_APP_SECRET_000506 in .env", file=sys.stderr)
        sys.exit(1)

    cnpj_digits = re.sub(r"\D", "", CNPJ)
    print(f"[omie] ListarClientes START cnpj={CNPJ} (digits={cnpj_digits})")

    listing = omie_call(app_key, app_secret, "ListarClientes", {
        "pagina": 1,
        "registros_por_pagina": 50,
        "apenas_importado_api": "N",
        "clientesFiltro": {"cnpj_cpf": cnpj_digits},
    })

    records = listing.get("clientes_cadastro_resumido", []) or listing.get("clientes_cadastro", [])
    print(f"[omie] ListarClientes OK hits={len(records)} total_de_paginas={listing.get('total_de_paginas')}")

    if not records:
        print("[omie] no record found for this CNPJ", file=sys.stderr)
        sys.exit(2)

    if len(records) > 1:
        print(f"[omie] WARN multiple hits ({len(records)}) — listing all:")
        for r in records:
            print(f"  - codigo_cliente={r.get('codigo_cliente')} razao_social={r.get('razao_social')}")

    summary = records[0]
    codigo = summary.get("codigo_cliente") or summary.get("codigo_cliente_omie")
    print()
    print("=== SUMMARY (from ListarClientes) ===")
    print(f"  codigo_cliente_omie       : {codigo}")
    print(f"  codigo_cliente_integracao : {summary.get('codigo_cliente_integracao')}")
    print(f"  razao_social              : {summary.get('razao_social')}")
    print(f"  nome_fantasia             : {summary.get('nome_fantasia')}")
    print(f"  cnpj_cpf                  : {summary.get('cnpj_cpf')}")

    print()
    print(f"[omie] ConsultarCliente START codigo_cliente_omie={codigo}")
    detail = omie_call(app_key, app_secret, "ConsultarCliente", {
        "codigo_cliente_omie": codigo,
    })
    print(f"[omie] ConsultarCliente OK")

    tags = detail.get("tags") or []
    print()
    print("=== DETAIL (from ConsultarCliente) ===")
    print(f"  codigo_cliente_omie       : {detail.get('codigo_cliente_omie')}")
    print(f"  codigo_cliente_integracao : {detail.get('codigo_cliente_integracao')}")
    print(f"  razao_social              : {detail.get('razao_social')}")
    print(f"  nome_fantasia             : {detail.get('nome_fantasia')}")
    print(f"  cnpj_cpf                  : {detail.get('cnpj_cpf')}")
    print(f"  inscricao_estadual        : {detail.get('inscricao_estadual')}")
    print(f"  tags                      : {[t.get('tag') for t in tags] if tags else '(none)'}")
    print(f"  inativo                   : {detail.get('inativo')}")
    print(f"  bloqueado                 : {detail.get('bloqueado')}")

    endereco = {
        "logradouro": detail.get("endereco"),
        "numero": detail.get("endereco_numero"),
        "bairro": detail.get("bairro"),
        "cidade": detail.get("cidade"),
        "estado": detail.get("estado"),
        "cep": detail.get("cep"),
    }
    print(f"  endereco                  : {endereco}")

    print()
    print(f"ANSWER: código da transportadora (codigo_cliente_omie) = {codigo}")


if __name__ == "__main__":
    main()
