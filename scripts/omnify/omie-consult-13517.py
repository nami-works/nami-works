"""
Consult Omie pedido 13517 directly (= Shopify #80850) on both accounts.
Reveals the real codigo_pedido_integracao + etapa + status fields.
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
url = "https://app.omie.com.br/api/v1/produtos/pedido/"

for company, k_key, s_key in [
    ("000506", "OMIE_APP_KEY_000506", "OMIE_APP_SECRET_000506"),
    ("000174", "OMIE_APP_KEY_000174", "OMIE_APP_SECRET_000174"),
]:
    print(f"\n##### Omie company {company} #####")
    resp = omie_call(url, env[k_key], env[s_key], "ConsultarPedido", {"numero_pedido": "13517"})
    if "_http_error" in resp:
        print(f"  ERR: {resp['_body'][:300]}")
        continue
    pv = resp.get("pedido_venda_produto") or {}
    cab = pv.get("cabecalho") or {}
    info = pv.get("informacoes_adicionais") or {}
    obs = pv.get("observacoes") or {}
    # Full dump for company 000506 only (skip 000174 — unrelated 2021 pedido).
    if company == "000506":
        out = Path(__file__).parent / "_pedido_13517_full.json"
        out.write_text(json.dumps(pv, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"  Full pedido written to {out}")
        # Also dump infoCadastro + total_pedido inline since those often hold status.
        print(f"  infoCadastro:")
        print(json.dumps(pv.get("infoCadastro"), indent=4, ensure_ascii=False))
        print(f"  total_pedido:")
        print(json.dumps(pv.get("total_pedido"), indent=4, ensure_ascii=False)[:1500])
        # Hunt for any field that looks status/error-ish across the whole tree.
        def hunt(obj, path=""):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    p = f"{path}.{k}" if path else k
                    kl = k.lower()
                    if any(s in kl for s in ("status", "erro", "rejei", "motivo", "bloque", "etapa", "stat", "nfe", "cstat", "xmotivo")):
                        print(f"    HIT  {p} = {v}")
                    hunt(v, p)
            elif isinstance(obj, list):
                for i, item in enumerate(obj):
                    hunt(item, f"{path}[{i}]")
        print("  Status/error-ish field hunt:")
        hunt(pv)
    else:
        print(f"  (000174 has unrelated 2021 pedido — skipping deep dump)")
