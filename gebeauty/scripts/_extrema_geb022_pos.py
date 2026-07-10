"""GEB 022 (Booster Antifrizz) position on EXTREMA via ListarPosEstoque (all pages)."""
import json, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
STK_URL = "https://app.omie.com.br/api/v1/estoque/consulta/"
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


def call(ak, as_, param):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": "ListarPosEstoque", "param": [param]}).encode()
    time.sleep(0.8)
    try:
        req = urllib.request.Request(STK_URL, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_error": e.read().decode("utf-8", "replace")}
    except (urllib.error.URLError, OSError) as e:
        return {"_error": str(e)}


def norm(s): return "".join(str(s or "").split()).upper()


def main():
    conns = {c["label"].upper(): c for c in load_connections(ENV_PATH)}
    c = conns["EXTREMA"]; ak, as_ = c["app_key"], c["app_secret"]

    page, total_pages = 1, None
    geb, antifrizz, nonzero_sample = [], [], []
    while True:
        r = call(ak, as_, {"nPagina": page, "nRegPorPagina": 50, "dDataPosicao": TODAY, "cExibeTodos": "S"})
        if "_error" in r:
            print(f"page {page} ERROR {r['_error'][:200]}"); break
        if total_pages is None:
            total_pages = r.get("nTotPaginas") or 1
            print(f"[EXTREMA] {r.get('nTotRegistros')} stock rows / {total_pages} pages @ {r.get('dDataPosicao')}")
        for p in r.get("produtos") or []:
            cod, desc = norm(p.get("cCodigo")), (p.get("cDescricao") or "").upper()
            if "GEB" in cod:
                geb.append(p)
            if "ANTIFRIZZ" in desc:
                antifrizz.append(p)
            if len(nonzero_sample) < 8 and (float(p.get("fisico") or 0) or float(p.get("nSaldo") or 0)):
                nonzero_sample.append(p)
        if page >= (total_pages or 1):
            break
        page += 1

    def show(p):
        return (f"cCodigo={p.get('cCodigo')!r} fisico={p.get('fisico')} nSaldo={p.get('nSaldo')} "
                f"reservado={p.get('reservado')} nPendente={p.get('nPendente')} "
                f"est_min={p.get('estoque_minimo')} CMC={p.get('nCMC')} local={p.get('codigo_local_estoque')} "
                f":: {p.get('cDescricao')}")

    print(f"\n==== codes containing 'GEB': {len(geb)} ====")
    for p in geb:
        print("  ", show(p))
    print(f"\n==== descriptions containing 'ANTIFRIZZ': {len(antifrizz)} ====")
    for p in antifrizz:
        print("  ", show(p))
    print(f"\n==== sample of NONZERO-stock rows (sanity that fields populate): {len(nonzero_sample)} ====")
    for p in nonzero_sample:
        print("  ", show(p))


if __name__ == "__main__":
    main()
