"""
Probe: find recent PURCHASE NF-e from E-NOVA COSMETICOS / NATURELLE in Omie.

A purchase note has the supplier as EMITTER (nfEmitInt) and GE Beauty as
destinatario (nfDestInt), tpNF=0 (entrada). ListarNF returns entrada notes with
external emitters (proven by omie_customer_nf_scan.py consignment-return path).

Strategy: scan ListarNF over a recent window on the requested connections,
collect every ENTRADA note's emitter razao/cnpj so we can eyeball which match
the two suppliers, and dump full JSON for any note whose emitter text matches
NOVA / NATUREL (chave de acesso + any DANFE link fields included).

Usage:
  python _enova_naturelle_nf_probe.py [dEmiInicial] [dEmiFinal] [LABEL,LABEL...]
  default window = 01/04/2026..18/06/2026 , default conns = MATRIZ,SHOPS JARDINS
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
_RETRY = ("requisi", "consumo", "soap-env:server", "redundante", "number of requests")


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
            low = txt.lower()
            if any(m in low for m in _RETRY):
                wait = 8.0 * (attempt + 1)
                if "aguarde" in low:
                    import re
                    m = re.search(r"aguarde\s+(\d+)", low)
                    if m: wait = float(m.group(1)) + 2
                time.sleep(wait); continue
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e)}; time.sleep(5.0 * (attempt + 1))
    return last or {"_error": "exhausted"}


def main():
    d_lo = sys.argv[1] if len(sys.argv) > 1 else "01/04/2026"
    d_hi = sys.argv[2] if len(sys.argv) > 2 else "18/06/2026"
    only = set(sys.argv[3].upper().split(",")) if len(sys.argv) > 3 else {"MATRIZ", "SHOPS JARDINS"}
    out_path = Path(__file__).resolve().parent / "_enova_naturelle_nf_probe.out.json"

    conns = [c for c in load_connections(ENV_PATH) if c["label"].upper() in only]
    print(f"window {d_lo}..{d_hi} conns={[c['label'] for c in conns]}", flush=True)

    NEEDLES = ("NOVA", "NATUREL")
    matches, entrada_emitters, dumped_shape = [], defaultdict(int), False

    for c in conns:
        ak, as_ = c["app_key"], c["app_secret"]
        page, total_pages, scanned = 1, None, 0
        while True:
            res = call(ak, as_, {"pagina": page, "registros_por_pagina": 50,
                                 "apenas_importado_api": "N", "dEmiInicial": d_lo, "dEmiFinal": d_hi})
            if "_error" in res:
                print(f"[{c['label']}] page {page} ERROR {res['_error'][:120]}", file=sys.stderr, flush=True)
                if total_pages and page < total_pages:
                    page += 1; continue
                break
            if total_pages is None:
                total_pages = res.get("total_de_paginas") or 1
                print(f"[{c['label']}] {res.get('total_de_registros')} notes / {total_pages} pages", flush=True)
            for nf in res.get("nfCadastro") or []:
                scanned += 1
                ide = nf.get("ide", {})
                tp = str(ide.get("tpNF"))
                emit = nf.get("nfEmitInt", {})
                emit_razao = (emit.get("cRazao") or emit.get("razao_social") or "").upper()
                emit_cnpj = emit.get("cnpj_cpf", "")
                if tp == "0" and emit_razao:
                    entrada_emitters[f"{emit_razao}  [{emit_cnpj}]"] += 1
                blob = json.dumps(nf, ensure_ascii=False).upper()
                if any(n in emit_razao for n in NEEDLES) or any(n in blob for n in NEEDLES):
                    # only keep if a needle is in an emitter/dest party field, not random product text
                    party_text = json.dumps({"emit": emit, "dest": nf.get("nfDestInt", {})},
                                            ensure_ascii=False).upper()
                    if any(n in party_text for n in NEEDLES):
                        matches.append({"conn": c["label"], "nf": nf})
            if page >= (total_pages or 1):
                break
            page += 1
        print(f"[{c['label']}] scanned={scanned} matches_so_far={len(matches)}", flush=True)

    print("\n==== ENTRADA (tpNF=0) EMITTERS SEEN ====", flush=True)
    for k, n in sorted(entrada_emitters.items(), key=lambda x: -x[1]):
        print(f"  {n:>4}x  {k}", flush=True)

    print(f"\n==== MATCHES (NOVA/NATUREL in party fields): {len(matches)} ====", flush=True)
    for m in matches:
        nf = m["nf"]; ide = nf.get("ide", {}); emit = nf.get("nfEmitInt", {})
        compl = nf.get("compl", {})
        print(f"  [{m['conn']}] nNF={ide.get('nNF')} serie={ide.get('serie')} "
              f"dEmi={ide.get('dEmi')} tpNF={ide.get('tpNF')} "
              f"emit={emit.get('cRazao') or emit.get('razao_social')} "
              f"chave={compl.get('cChaveNFe') or compl.get('chave_nfe')} "
              f"nIdNF={compl.get('nIdNF')}", flush=True)

    out_path.write_text(json.dumps(
        {"window": [d_lo, d_hi], "matches": matches,
         "entrada_emitters": entrada_emitters}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nraw -> {out_path}", flush=True)


if __name__ == "__main__":
    main()
