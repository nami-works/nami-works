"""
Find the NF-e records linked to pedido 13517 (codigo_pedido = 11658902943)
and dump their full structure so we can locate the rejection-code field
(cStat=781) and the join key back to the pedido.
"""
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta
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
    body = json.dumps({"app_key": app_key, "app_secret": app_secret, "call": method, "param": [param]}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"_http_error": e.code, "_body": e.read().decode("utf-8", errors="replace")[:600]}
    except Exception as e:
        return {"_error": str(e)}


env = load_env(ENV_PATH)
url = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
k = env["OMIE_APP_KEY_000506"]
s = env["OMIE_APP_SECRET_000506"]

# Try several filter param combinations to narrow ListarNF to pedido 13517 / id 11658902943.
today = datetime.now()
d_start = (today - timedelta(days=14)).strftime("%d/%m/%Y")
d_end = today.strftime("%d/%m/%Y")

attempts = [
    # By pedido id directly.
    {"nIdPedido": 11658902943},
    {"cIdPedido": 11658902943},
    {"nCodPed": 11658902943},
    # By pedido number.
    {"nNumPedido": "13517"},
    {"cNumPedido": "13517"},
    # Date window listing — to confirm the endpoint works at all.
    {"pagina": 1, "registros_por_pagina": 5, "dEmiInicial": d_start, "dEmiFinal": d_end},
    # Status-based filter possibilities.
    {"pagina": 1, "registros_por_pagina": 5, "cStatus": "REJEITADA"},
    {"pagina": 1, "registros_por_pagina": 5, "cStat": "781"},
]

for i, param in enumerate(attempts, 1):
    print(f"--- attempt {i}: param={param} ---")
    resp = omie_call(url, k, s, "ListarNF", param)
    if "_http_error" in resp:
        print(f"  HTTP {resp['_http_error']}: {resp['_body'][:250]}")
    elif "_error" in resp:
        print(f"  ERR: {resp['_error']}")
    else:
        top = list(resp.keys())
        total = resp.get("total_de_registros", "?")
        print(f"  OK. top={top}  total_de_registros={total}")
        nf_list = resp.get("nfCadastro") or []
        if nf_list:
            first = nf_list[0]
            # Look specifically for status fields.
            print(f"  first nf keys: {list(first.keys())}")
            info = first.get("info") or {}
            compl = first.get("compl") or {}
            pedido = first.get("pedido") or {}
            print(f"    info keys: {list(info.keys())}")
            print(f"    compl: {json.dumps(compl, ensure_ascii=False)[:400]}")
            print(f"    pedido: {json.dumps(pedido, ensure_ascii=False)[:400]}")
            # Hunt for cStat / rejection fields.
            def hunt(o, path=""):
                if isinstance(o, dict):
                    for kk, vv in o.items():
                        p = f"{path}.{kk}" if path else kk
                        if any(s in kk.lower() for s in ("cstat", "xmotivo", "status", "rejei", "motivo", "erro")):
                            print(f"      HIT  {p} = {vv}")
                        hunt(vv, p)
                elif isinstance(o, list):
                    for j, x in enumerate(o):
                        hunt(x, f"{path}[{j}]")
            hunt(first)
    print()
