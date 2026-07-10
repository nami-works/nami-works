"""Locate FLY GALLEY LTD across the 6 Omie accounts (ListarClientes razao LIKE).
Reports codigo_cliente_omie, cnpj, tags, cliente/fornecedor flags, per account."""
import json, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
CLI_URL = "https://app.omie.com.br/api/v1/geral/clientes/"


def load_connections(path):
    conns, label, pending = [], None, {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("##"):
            label, pending = s.lstrip("#").strip(), {}; continue
        if s.startswith("#") or "=" not in s:
            continue
        k, v = (x.strip() for x in s.split("=", 1))
        if k.startswith("OMIE_APP_KEY_"): pending["app_key"] = v
        elif k.startswith("OMIE_APP_SECRET_"): pending["app_secret"] = v
        if "app_key" in pending and "app_secret" in pending:
            conns.append({"label": label, **pending}); pending = {}
    return conns


def call(ak, as_, method, param, retries=5):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(0.8)
        try:
            req = urllib.request.Request(CLI_URL, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt}
            if any(m in txt.lower() for m in ("requisi", "consumo", "redundante")):
                time.sleep(8.0 * (attempt + 1)); continue
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e)}; time.sleep(5.0 * (attempt + 1))
    return last or {"_error": "exhausted"}


def main():
    conns = load_connections(ENV_PATH)
    for needle in ("FLY GALLEY", "GALLEY"):
        print(f"\n######## razao_social LIKE '{needle}' ########")
        for c in conns:
            res = call(c["app_key"], c["app_secret"], "ListarClientes",
                       {"pagina": 1, "registros_por_pagina": 50, "apenas_importado_api": "N",
                        "clientesFiltro": {"razao_social": needle}})
            if "_error" in res:
                print(f"[{c['label']}] ERROR {res['_error'][:120]}"); continue
            recs = res.get("clientes_cadastro") or res.get("clientes_cadastro_resumido") or []
            if not recs:
                print(f"[{c['label']}] none")
                continue
            for r in recs:
                print(f"[{c['label']}] cod={r.get('codigo_cliente_omie') or r.get('codigo_cliente')} "
                      f"razao={r.get('razao_social')!r} fant={r.get('nome_fantasia')!r} "
                      f"cnpj={r.get('cnpj_cpf')} cliente={r.get('cliente')} fornecedor={r.get('fornecedor')} "
                      f"tags={[t.get('tag') for t in (r.get('tags') or [])]} inativo={r.get('inativo')}")
        if needle == "FLY GALLEY":
            # if found under FLY GALLEY, skip the broader GALLEY sweep
            pass


if __name__ == "__main__":
    main()
