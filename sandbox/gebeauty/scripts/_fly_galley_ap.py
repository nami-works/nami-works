"""
List all Contas a Pagar titles for FLY GALLEY LTDA (CNPJ 65.912.950/0001-38)
across the Omie accounts, sorted most-recent first, exposing the NF link
(chave_nfe / numero_documento_fiscal). Read-only.
"""
import json, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
AP_URL = "https://app.omie.com.br/api/v1/financas/contapagar/"

# per-account FLY GALLEY codigo_cliente_omie (from _fly_galley_find.py)
CODES = {
    "MATRIZ": 6829395126, "SHOPPING RECIFE": 2094340156, "SHOPS JARDINS": 5230836635,
    "RIO SUL": 5761080563, "RIO MAR RECIFE": 9466647999, "EXTREMA": 11638003424,
}


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
            req = urllib.request.Request(AP_URL, data=body, headers={"Content-Type": "application/json"})
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


def dkey(d):  # dd/mm/yyyy -> sortable
    try:
        dd, mm, yy = d.split("/"); return (int(yy), int(mm), int(dd))
    except Exception:
        return (0, 0, 0)


def main():
    conns = {c["label"]: c for c in load_connections(ENV_PATH)}
    rows = []
    for label, c in conns.items():
        code = CODES.get(label)
        page, total_pages = 1, None
        cnt = 0
        while True:
            res = call(c["app_key"], c["app_secret"], "ListarContasPagar",
                       {"pagina": page, "registros_por_pagina": 100, "filtrar_cliente": code})
            if "_error" in res:
                print(f"[{label}] ERROR {res['_error'][:140]}"); break
            if total_pages is None:
                total_pages = res.get("total_de_paginas") or 1
            for t in res.get("conta_pagar_cadastro", []) or []:
                cnt += 1
                rows.append({
                    "conn": label,
                    "lanc": t.get("codigo_lancamento_omie"),
                    "emissao": t.get("data_emissao"),
                    "entrada": t.get("data_entrada"),
                    "venc": t.get("data_vencimento"),
                    "valor": t.get("valor_documento"),
                    "status": t.get("status_titulo"),
                    "nf": t.get("numero_documento_fiscal"),
                    "doc": t.get("numero_documento"),
                    "chave": t.get("chave_nfe"),
                })
            if page >= (total_pages or 1):
                break
            page += 1
        print(f"[{label}] titles={cnt}")

    rows.sort(key=lambda r: dkey(r["emissao"]), reverse=True)
    print(f"\n==== FLY GALLEY contas a pagar: {len(rows)} titles (most recent emission first) ====")
    for r in rows[:15]:
        print(f"  [{r['conn']}] emis={r['emissao']} entr={r['entrada']} venc={r['venc']} "
              f"R${r['valor']} st={r['status']} NF={r['nf']} doc={r['doc']} chave={r['chave'] or '-'} lanc={r['lanc']}")

    out = Path(__file__).resolve().parent / "_fly_galley_ap.out.json"
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nraw -> {out}")


if __name__ == "__main__":
    main()
