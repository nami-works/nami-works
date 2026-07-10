"""
Current inventory position for SKU GEB 022 (Booster Antifrizz) on the EXTREMA
Omie account. Read-only.

1) geral/produtos/ListarProdutos -> find product whose `codigo` == GEB 022
2) estoque/consulta/PosicaoEstoque -> saldo / fisico / reservado / pendente / cmc
EXTREMA is its own Omie account (app_key suffix _000506), so no throttle
contention with the other 5 connections.
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
PROD_URL = "https://app.omie.com.br/api/v1/geral/produtos/"
STK_URL = "https://app.omie.com.br/api/v1/estoque/consulta/"
TODAY = "22/06/2026"
TARGET = "GEB022"  # normalized (spaces stripped, upper)


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


def call(url, ak, as_, method, param, retries=5):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(0.8)
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt}
            low = txt.lower()
            if any(m in low for m in ("requisi", "consumo", "redundante", "bloqueada")):
                time.sleep(8.0 * (attempt + 1)); continue
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e)}; time.sleep(5.0 * (attempt + 1))
    return last or {"_error": "exhausted"}


def norm(s): return "".join((s or "").split()).upper()


def main():
    conns = {c["label"].upper(): c for c in load_connections(ENV_PATH)}
    c = conns.get("EXTREMA")
    if not c:
        print("EXTREMA connection not found in .env", file=sys.stderr); sys.exit(1)
    ak, as_ = c["app_key"], c["app_secret"]

    # 1) locate product GEB 022
    matches, page, total_pages = [], 1, None
    while True:
        res = call(PROD_URL, ak, as_, "ListarProdutos",
                   {"pagina": page, "registros_por_pagina": 50, "apenas_importado_api": "N"})
        if "_error" in res:
            print(f"ListarProdutos page {page} ERROR {res['_error'][:200]}", file=sys.stderr); break
        if total_pages is None:
            total_pages = res.get("total_de_paginas") or 1
            print(f"[EXTREMA] {res.get('total_de_registros')} products / {total_pages} pages", flush=True)
        for p in res.get("produto_servico_cadastro", []) or []:
            cod = p.get("codigo")
            if norm(cod) == TARGET or "ANTIFRIZZ" in norm(p.get("descricao")):
                matches.append({"codigo_produto": p.get("codigo_produto"), "codigo": cod,
                                "descricao": p.get("descricao"), "inativo": p.get("inativo"),
                                "tipoItem": p.get("tipoItem")})
        if page >= (total_pages or 1):
            break
        page += 1

    print(f"\nmatches for GEB 022 / ANTIFRIZZ: {len(matches)}")
    for m in matches:
        print(f"  codigo_produto={m['codigo_produto']} codigo={m['codigo']!r} "
              f"inativo={m['inativo']} tipo={m['tipoItem']} :: {m['descricao']}")

    # exact-code match preferred
    chosen = [m for m in matches if norm(m["codigo"]) == TARGET] or matches
    if not chosen:
        print("\n!! GEB 022 not found on EXTREMA", file=sys.stderr); sys.exit(2)

    for m in chosen:
        print(f"\n==== POSICAO ESTOQUE  codigo={m['codigo']!r} (id={m['codigo_produto']}) data={TODAY} ====")
        pos = call(STK_URL, ak, as_, "PosicaoEstoque",
                   {"codigo_local_estoque": 0, "id_prod": m["codigo_produto"],
                    "data": TODAY, "apenas_saldo": "N"})
        if "_error" in pos:
            print(f"  ERROR {pos['_error'][:200]}", file=sys.stderr); continue
        print(f"  status     : {pos.get('codigo_status')} {pos.get('descricao_status')}")
        print(f"  saldo      : {pos.get('saldo')}")
        print(f"  fisico     : {pos.get('fisico')}")
        print(f"  reservado  : {pos.get('reservado')}")
        print(f"  pendente   : {pos.get('pendente')}")
        print(f"  est_minimo : {pos.get('estoque_minimo')}")
        print(f"  CMC (R$)   : {pos.get('cmc')}")
        print(f"  local      : {pos.get('codigo_local_estoque')}")


if __name__ == "__main__":
    main()
