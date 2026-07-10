"""GEB 101 (Primer Cachos Definidos) current position on CD EXTREMA via
ListarPosEstoque (all pages), as-of dDataPosicao=today. Read-only."""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
STK_URL = "https://app.omie.com.br/api/v1/estoque/consulta/"
TODAY = sys.argv[1] if len(sys.argv) > 1 else "25/06/2026"


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


def call(ak, as_, param, retries=6):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": "ListarPosEstoque", "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(0.8)
        try:
            req = urllib.request.Request(STK_URL, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt}
            if any(m in txt.lower() for m in ("requisi", "consumo", "redundante", "bloqueada")):
                time.sleep(8.0 * (attempt + 1)); continue
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e)}; time.sleep(5.0 * (attempt + 1))
    return last or {"_error": "exhausted"}


def norm(s): return "".join(str(s or "").split()).upper()


def main():
    c = {x["label"].upper(): x for x in load_connections(ENV_PATH)}["EXTREMA"]
    ak, as_ = c["app_key"], c["app_secret"]
    page, total_pages, hits = 1, None, []
    while True:
        r = call(ak, as_, {"nPagina": page, "nRegPorPagina": 50, "dDataPosicao": TODAY, "cExibeTodos": "S"})
        if "_error" in r:
            print(f"page {page} ERROR {r['_error'][:160]}"); break
        if total_pages is None:
            total_pages = r.get("nTotPaginas") or 1
            print(f"[EXTREMA] {r.get('nTotRegistros')} rows / {total_pages} pages @ {r.get('dDataPosicao')}")
        for p in r.get("produtos") or []:
            cod, desc = norm(p.get("cCodigo")), (p.get("cDescricao") or "").upper()
            if ("PRIMER" in desc and "CACHOS" in desc) or cod in ("GEB101", "GEB0009") \
               or ("CACHOS" in desc and "DEFINID" in desc):
                hits.append(p)
        if page >= (total_pages or 1):
            break
        page += 1
    print(f"\n==== Primer Cachos rows @ {TODAY}: {len(hits)} ====")
    for p in hits:
        print(f"  cCodigo={p.get('cCodigo')!r:10} fisico={p.get('fisico')} nSaldo={p.get('nSaldo')} "
              f"reservado={p.get('reservado')} nPendente={p.get('nPendente')} est_min={p.get('estoque_minimo')} "
              f"CMC={p.get('nCMC')} local={p.get('codigo_local_estoque')} :: {p.get('cDescricao')}")


if __name__ == "__main__":
    main()
