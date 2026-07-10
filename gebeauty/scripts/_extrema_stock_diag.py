"""Diagnostic: what does the EXTREMA Omie account actually expose for products + stock?"""
import json, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
PROD_URL = "https://app.omie.com.br/api/v1/geral/produtos/"
STK_URL = "https://app.omie.com.br/api/v1/estoque/consulta/"
LOCAL_URL = "https://app.omie.com.br/api/v1/geral/estoque/"
TODAY = "22/06/2026"


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


def call(url, ak, as_, method, param):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    time.sleep(0.7)
    try:
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_error": e.read().decode("utf-8", "replace")}
    except (urllib.error.URLError, OSError) as e:
        return {"_error": str(e)}


def main():
    conns = {c["label"].upper(): c for c in load_connections(ENV_PATH)}
    c = conns["EXTREMA"]; ak, as_ = c["app_key"], c["app_secret"]
    print("app_key tail:", ak[-6:])

    print("\n--- ListarProdutos (minimal) ---")
    r = call(PROD_URL, ak, as_, "ListarProdutos", {"pagina": 1, "registros_por_pagina": 50})
    if "_error" in r:
        print("ERROR", r["_error"][:300])
    else:
        print("total_de_registros:", r.get("total_de_registros"), "paginas:", r.get("total_de_paginas"))
        arr = r.get("produto_servico_cadastro") or []
        print("returned:", len(arr), "| top keys:", list(r.keys()))
        for p in arr[:5]:
            print("   ", p.get("codigo"), "|", p.get("descricao"), "| inativo=", p.get("inativo"))

    print("\n--- ListarLocaisEstoque ---")
    r = call(LOCAL_URL, ak, as_, "ListarLocaisEstoque", {"pagina": 1, "registros_por_pagina": 50})
    if "_error" in r:
        print("ERROR", r["_error"][:200])
    else:
        print("keys:", list(r.keys()))
        for l in (r.get("locais_estoque_cadastro") or r.get("ListarLocaisEstoque") or [])[:20]:
            print("   ", l)

    print("\n--- ListarPosEstoque (today, cExibeTodos=S) ---")
    r = call(STK_URL, ak, as_, "ListarPosEstoque",
             {"nPagina": 1, "nRegPorPagina": 50, "dDataPosicao": TODAY, "cExibeTodos": "S"})
    if "_error" in r:
        print("ERROR", r["_error"][:300])
    else:
        print("nTotRegistros:", r.get("nTotRegistros"), "nTotPaginas:", r.get("nTotPaginas"),
              "dDataPosicao:", r.get("dDataPosicao"))
        prods = r.get("produtos") or []
        print("returned:", len(prods))
        for p in prods[:12]:
            print(f"   cCodigo={p.get('cCodigo')!r:14} fisico={p.get('fisico')} saldo={p.get('nSaldo')} "
                  f"reserv={p.get('reservado')} pend={p.get('nPendente')} :: {p.get('cDescricao')}")
        # is GEB 022 in here?
        hit = [p for p in prods if "".join(str(p.get('cCodigo') or '').split()).upper() == "GEB022"
               or "ANTIFRIZZ" in (p.get('cDescricao') or '').upper()]
        print("\nGEB022/ANTIFRIZZ on page1:", json.dumps(hit, ensure_ascii=False)[:500])


if __name__ == "__main__":
    main()
