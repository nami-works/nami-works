"""
Fetch DANFE PDF + XML of GE Beauty PURCHASE NF-e (entrada) from suppliers via
Omie produtos/dfedocs/ObterNfe. Read-only against Omie; writes files locally to
gebeauty/danfe/.

ObterNfe(param={"nIdNfe": <int>}) -> cXmlNfe (full XML), cPdf (DANFE pdf link),
cLinkPortal, cCodStatus ("0"=ok), cDesStatus. We try the recebimento id first,
then the NF register id, since dfedocs is the DF-e (received-docs) repository.
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
OUT_DIR = Path(__file__).resolve().parent.parent / "danfe"
DFE_URL = "https://app.omie.com.br/api/v1/produtos/dfedocs/"

TARGETS = [
    {"supplier": "E-NOVA",    "nNF": "361",   "dEmi": "05-06-2026", "ids": [5257595349, 5256600160]},
    {"supplier": "NATURELLE", "nNF": "51260", "dEmi": "09-06-2026", "ids": [5257594773, 5257487716]},
]


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


def call(ak, as_, method, param):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    req = urllib.request.Request(DFE_URL, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return {"_http": e.code, "_body": e.read().decode("utf-8", "replace")}
    except (urllib.error.URLError, OSError) as e:
        return {"_err": str(e)}


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = r.read()
    dest.write_bytes(data)
    return len(data)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    conns = {c["label"]: c for c in load_connections(ENV_PATH)}
    c = conns["SHOPS JARDINS"]
    ak, as_ = c["app_key"], c["app_secret"]

    for t in TARGETS:
        print(f"\n==== {t['supplier']} nNF {t['nNF']} ({t['dEmi']}) ====", flush=True)
        ok = None
        for nid in t["ids"]:
            time.sleep(1.0)
            res = call(ak, as_, "ObterNfe", {"nIdNfe": nid})
            status = str(res.get("cCodStatus"))
            print(f"  nIdNfe={nid} -> cCodStatus={status} cDesStatus={res.get('cDesStatus')}", flush=True)
            if "_http" in res or "_err" in res:
                print(f"    transport: {json.dumps(res)[:300]}", flush=True)
                continue
            if status == "0" and (res.get("cXmlNfe") or res.get("cPdf")):
                ok = res; ok["_nIdNfe"] = nid; break
        if not ok:
            print(f"  !! no document for {t['supplier']} via tried ids", flush=True)
            continue

        base = OUT_DIR / f"{t['supplier']}_NF{t['nNF']}_{t['dEmi']}"
        chave = ok.get("nChaveNfe")
        print(f"  chave={chave}  emis={ok.get('dDataEmisNfe')}", flush=True)
        if ok.get("cXmlNfe"):
            (base.with_suffix(".xml")).write_text(ok["cXmlNfe"], encoding="utf-8")
            print(f"  XML  -> {base.with_suffix('.xml').name} ({len(ok['cXmlNfe'])} chars)", flush=True)
        if ok.get("cPdf"):
            print(f"  cPdf link: {ok['cPdf']}", flush=True)
            try:
                n = download(ok["cPdf"], base.with_suffix(".pdf"))
                print(f"  PDF  -> {base.with_suffix('.pdf').name} ({n} bytes)", flush=True)
            except Exception as e:
                print(f"  PDF download failed: {e}", flush=True)
        if ok.get("cLinkPortal"):
            print(f"  portal: {ok['cLinkPortal']}", flush=True)


if __name__ == "__main__":
    main()
