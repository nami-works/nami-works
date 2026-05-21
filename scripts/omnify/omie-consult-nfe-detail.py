"""
ConsultarNF on the NF-e linked to pedido 13517. We don't know its nIdNF
yet, so we'll list-NF in the window covering 13517's data_previsao
(18/05/2026), find the one whose compl.nIdPedido matches 11658902943,
then drill into ConsultarNF for the full record (which should expose
the cStat / xMotivo SEFAZ rejection fields).
"""
import json
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path

ENV_PATH = Path(r"C:\Users\Lucas Guimarães\Desktop\nami-works\sandbox\gebeauty\.env")
PEDIDO_INTERNAL_ID = 11658902943  # 000506 codigo_pedido for #80850


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
k = env["OMIE_APP_KEY_000506"]
s = env["OMIE_APP_SECRET_000506"]
nfconsultar_url = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"

# Sweep recent NF-e to find the one for pedido 11658902943.
d_start = "10/05/2026"
d_end = "19/05/2026"
nf_for_pedido = None
page = 1
print(f"Scanning NF-e {d_start} -> {d_end} for nIdPedido={PEDIDO_INTERNAL_ID}...")
while True:
    resp = omie_call(nfconsultar_url, k, s, "ListarNF", {
        "pagina": page, "registros_por_pagina": 50,
        "dEmiInicial": d_start, "dEmiFinal": d_end,
    })
    if "_http_error" in resp or "_error" in resp:
        print("List error:", resp)
        break
    records = resp.get("nfCadastro") or []
    if not records:
        break
    for r in records:
        compl = r.get("compl") or {}
        if compl.get("nIdPedido") == PEDIDO_INTERNAL_ID:
            nf_for_pedido = r
            break
    total_pages = resp.get("total_de_paginas") or 1
    print(f"  page {page}/{total_pages} (records={len(records)})")
    if nf_for_pedido or page >= total_pages:
        break
    page += 1

if not nf_for_pedido:
    print("\nNo NF-e found for pedido 13517 in window. Try widening dates or scanning all.")
    sys.exit(0)

nid_nf = nf_for_pedido["compl"]["nIdNF"]
print(f"\nFound NF-e linked to pedido 13517 -> nIdNF={nid_nf}")
print(f"List-level record keys: {list(nf_for_pedido.keys())}")
print(f"compl: {json.dumps(nf_for_pedido.get('compl'), ensure_ascii=False)}")
print(f"info: {json.dumps(nf_for_pedido.get('info'), ensure_ascii=False)}")
print()

# Drill into ConsultarNF for the same nIdNF.
print(f"=== ConsultarNF nIdNF={nid_nf} ===")
detail = omie_call(nfconsultar_url, k, s, "ConsultarNF", {"nIdNF": nid_nf})
if "_http_error" in detail or "_error" in detail:
    print("Detail error:", detail)
    # Try alternative param name.
    for alt in ["nIdNf", "nCodNF", "nIdNFe"]:
        print(f"  retry with {alt}...")
        detail = omie_call(nfconsultar_url, k, s, "ConsultarNF", {alt: nid_nf})
        if "_http_error" not in detail and "_error" not in detail:
            print(f"  worked with {alt}")
            break

if "_http_error" not in detail and "_error" not in detail:
    out = Path(__file__).parent / "_nfe_13517_full.json"
    out.write_text(json.dumps(detail, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Full detail written to {out}")
    # Hunt for rejection-code fields anywhere in the tree.
    def hunt(obj, path=""):
        if isinstance(obj, dict):
            for kk, vv in obj.items():
                p = f"{path}.{kk}" if path else kk
                kl = kk.lower()
                if any(s in kl for s in ("cstat", "xmotivo", "status", "rejei", "motivo", "erro", "comunic", "sefaz")):
                    print(f"  HIT  {p} = {vv!r:.200}")
                hunt(vv, p)
        elif isinstance(obj, list):
            for i, x in enumerate(obj):
                hunt(x, f"{path}[{i}]")
    print("\nRejection-code field hunt across full detail:")
    hunt(detail)
else:
    print("ConsultarNF failed:", detail)
