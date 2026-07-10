"""Scan MATRIZ ListarNF (2026) for any NF-e involving FLY GALLEY (CNPJ 65912950).
If found, report nIdNF + chave so we can pull the DANFE via dfedocs/ObterNfe."""
import json, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
FLY_CNPJ = "65912950000138"
FLY_ROOT = "65912950"


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
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": "ListarNF", "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(0.8)
        try:
            req = urllib.request.Request(NF_URL, data=body, headers={"Content-Type": "application/json"})
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
    c = {x["label"]: x for x in load_connections(ENV_PATH)}["MATRIZ"]
    ak, as_ = c["app_key"], c["app_secret"]
    page, total_pages, hits = 1, None, []
    while True:
        res = call(ak, as_, {"pagina": page, "registros_por_pagina": 50,
                             "apenas_importado_api": "N", "dEmiInicial": "01/01/2026", "dEmiFinal": "22/06/2026"})
        if "_error" in res:
            print(f"page {page} ERROR {res['_error'][:140]}"); break
        if total_pages is None:
            total_pages = res.get("total_de_paginas") or 1
            print(f"[MATRIZ] {res.get('total_de_registros')} notes / {total_pages} pages")
        for nf in res.get("nfCadastro") or []:
            ide = nf.get("ide", {}); compl = nf.get("compl", {})
            chave = compl.get("cChaveNFe") or ""
            blob = json.dumps(nf, ensure_ascii=False).upper()
            emit_root = chave[6:20] if len(chave) == 44 else ""
            if emit_root.startswith(FLY_ROOT) or FLY_CNPJ in blob or "GALLEY" in blob:
                hits.append({"nNF": ide.get("nNF"), "serie": ide.get("serie"), "dEmi": ide.get("dEmi"),
                             "tpNF": ide.get("tpNF"), "chave": chave, "nIdNF": compl.get("nIdNF"),
                             "dest": nf.get("nfDestInt", {}).get("cRazao")})
        if page >= (total_pages or 1):
            break
        page += 1
    print(f"\nFLY GALLEY NF-e in MATRIZ register: {len(hits)}")
    for h in hits:
        print(" ", json.dumps(h, ensure_ascii=False))


if __name__ == "__main__":
    main()
