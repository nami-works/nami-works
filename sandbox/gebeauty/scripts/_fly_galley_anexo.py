"""
Download the NF attached to FLY GALLEY's most recent payment (Contas a Pagar
anexo). Reads titles from _fly_galley_ap.out.json (MATRIZ), lists anexos per
title via geral/anexo/ListarAnexo, then ObterAnexo -> cLinkDownload -> file.
Saves to sandbox/gebeauty/danfe/fly-galley/. Read-only against Omie.
"""
import json, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
ANEXO_URL = "https://app.omie.com.br/api/v1/geral/anexo/"
OUT_DIR = Path(__file__).resolve().parent.parent / "danfe" / "fly-galley"
AP_JSON = Path(__file__).resolve().parent / "_fly_galley_ap.out.json"


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


def call(ak, as_, method, param, retries=6):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(0.8)
        try:
            req = urllib.request.Request(ANEXO_URL, data=body, headers={"Content-Type": "application/json"})
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


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    dest.write_bytes(data)
    return len(data), data[:5]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    c = {x["label"]: x for x in load_connections(ENV_PATH)}["MATRIZ"]
    ak, as_ = c["app_key"], c["app_secret"]

    rows = json.loads(AP_JSON.read_text(encoding="utf-8"))
    matriz = [r for r in rows if r["conn"] == "MATRIZ"]
    # already sorted most-recent-emission first in the source file

    print("=== anexos per FLY GALLEY title (most recent first) ===")
    have_anexos = []
    for r in matriz:
        nid = r["lanc"]
        res = call(ak, as_, "ListarAnexo",
                   {"nPagina": 1, "nRegPorPagina": 50, "nId": nid, "cTabela": "conta-pagar"})
        if "_error" in res:
            print(f"  lanc={nid} ({r['emissao']} NF={r['nf']}) ERROR {res['_error'][:120]}"); continue
        anexos = res.get("listaAnexos") or []
        names = [(a.get("nIdAnexo"), a.get("cNomeArquivo")) for a in anexos]
        print(f"  lanc={nid} emis={r['emissao']} st={r['status']} NF={r['nf']} R${r['valor']} -> {len(anexos)} anexo(s): {names}")
        if anexos:
            have_anexos.append((r, anexos))

    if not have_anexos:
        print("\n!! No anexos found on any FLY GALLEY title."); return

    # most recent title that actually has attachments
    r, anexos = have_anexos[0]
    print(f"\n=== downloading anexos of most-recent title with attachments: "
          f"lanc={r['lanc']} emis={r['emissao']} NF={r['nf']} R${r['valor']} ===")
    for a in anexos:
        nidanexo, fname = a.get("nIdAnexo"), a.get("cNomeArquivo") or f"anexo_{a.get('nIdAnexo')}"
        det = call(ak, as_, "ObterAnexo",
                   {"cTabela": "conta-pagar", "nId": r["lanc"], "nIdAnexo": nidanexo})
        if "_error" in det or not det.get("cLinkDownload"):
            print(f"  {fname}: no link ({det.get('cDesStatus') or det.get('_error','')[:120]})"); continue
        safe = f"FLYGALLEY_NF{r['nf']}_{r['emissao'].replace('/','-')}__{fname}".replace(" ", "_")
        dest = OUT_DIR / safe
        try:
            n, magic = download(det["cLinkDownload"], dest)
            print(f"  {fname} -> {dest.name} ({n} bytes, magic={magic}) exp={det.get('dDtExpiracao')}")
        except Exception as e:
            print(f"  {fname}: download failed {e}\n   link={det['cLinkDownload']}")


if __name__ == "__main__":
    main()
