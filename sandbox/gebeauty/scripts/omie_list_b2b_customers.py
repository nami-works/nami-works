"""
List every B2B customer (CNPJ destinatario) across all Omie connections.
B2B = destinatario CNPJ has 14 digits (empresa) vs 11 (CPF = B2C individual).
Scans NF-e saída (tpNF=1) and groups by CNPJ root (8 digits).

Outputs:
  - Console: ranked table by revenue
  - JSON: omie_b2b_customers.out.json

Usage:
  python omie_list_b2b_customers.py [dEmiInicial] [dEmiFinal]
  e.g. python omie_list_b2b_customers.py 01/01/2024 12/06/2026
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


def dig(s): return "".join(c for c in (s or "") if c.isdigit())


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
    d_lo = sys.argv[1] if len(sys.argv) > 1 else "01/01/2024"
    d_hi = sys.argv[2] if len(sys.argv) > 2 else "12/06/2026"
    out_path = Path(__file__).resolve().parent / "omie_b2b_customers.out.json"

    conns = load_connections(ENV_PATH)
    print(f"Connections: {[c['label'] for c in conns]}", flush=True)
    print(f"Window: {d_lo} -> {d_hi}", flush=True)

    # cnpj_root (8 digits) → aggregated customer record
    customers = defaultdict(lambda: {
        "razao_social": None,
        "cnpj_full_set": set(),
        "connections": set(),
        "units": 0.0,
        "value": 0.0,
        "nfs": 0,
        "first_nf": None,
        "last_nf": None,
    })

    for c in conns:
        ak, as_ = c["app_key"], c["app_secret"]
        page, total_pages, scanned = 1, None, 0
        print(f"\n[{c['label']}] scanning...", flush=True)

        while True:
            res = call(ak, as_, {"pagina": page, "registros_por_pagina": 50,
                                 "apenas_importado_api": "N",
                                 "dEmiInicial": d_lo, "dEmiFinal": d_hi})
            if "_error" in res:
                print(f"[{c['label']}] page {page} ERROR {res['_error'][:90]} (skip)", file=sys.stderr, flush=True)
                if total_pages and page < total_pages:
                    page += 1; continue
                break
            if total_pages is None:
                total_pages = res.get("total_de_paginas") or 1
                total_rec = res.get("total_de_registros", "?")
                print(f"[{c['label']}] {total_rec} NF-e / {total_pages} pages", flush=True)

            for nf in res.get("nfCadastro") or []:
                scanned += 1
                ide = nf.get("ide", {})

                # skip cancelled / denied / inutilized
                # cDeneg stores "N" (not denied) or "S" (denied); dCan/dInut are empty or a date string
                if (ide.get("dCan") or "").strip() or ide.get("cDeneg") == "S" \
                        or (ide.get("dInut") or "").strip():
                    continue

                # only outbound sales
                if str(ide.get("tpNF")) != "1":
                    continue

                cnpj_raw = dig(nf.get("nfDestInt", {}).get("cnpj_cpf", ""))
                # skip CPF (11 digits) = B2C
                if len(cnpj_raw) != 14:
                    continue

                root = cnpj_raw[:8]
                nome = (nf.get("nfDestInt", {}).get("cRazao") or "").strip()
                u = sum(float(d.get("prod", {}).get("qCom", 0) or 0) for d in nf.get("det", []))
                v = float(nf.get("total", {}).get("ICMSTot", {}).get("vNF", 0) or 0)
                d_emi = ide.get("dEmi") or ""

                rec = customers[root]
                if nome and not rec["razao_social"]:
                    rec["razao_social"] = nome
                elif nome and len(nome) > len(rec["razao_social"] or ""):
                    rec["razao_social"] = nome  # prefer longer / more complete name
                rec["cnpj_full_set"].add(cnpj_raw)
                rec["connections"].add(c["label"])
                rec["units"] += u
                rec["value"] += v
                rec["nfs"] += 1
                if d_emi:
                    if not rec["first_nf"] or d_emi < rec["first_nf"]:
                        rec["first_nf"] = d_emi
                    if not rec["last_nf"] or d_emi > rec["last_nf"]:
                        rec["last_nf"] = d_emi

            if page % 25 == 0:
                print(f"[{c['label']}] {page}/{total_pages} scanned={scanned}", flush=True)
            if page >= (total_pages or 1):
                break
            page += 1

        print(f"[{c['label']}] DONE scanned={scanned}", flush=True)

    # serialize sets for JSON
    result = []
    for root, r in sorted(customers.items(), key=lambda x: -x[1]["value"]):
        result.append({
            "cnpj_root": root,
            "razao_social": r["razao_social"],
            "cnpj_full": sorted(r["cnpj_full_set"]),
            "connections": sorted(r["connections"]),
            "nfs": r["nfs"],
            "units": r["units"],
            "value": r["value"],
            "first_nf": r["first_nf"],
            "last_nf": r["last_nf"],
        })

    print(f"\n{'='*56}", flush=True)
    print(f"  {'CNPJ ROOT':10s}  {'NAME':40s}  {'NFs':>5}  {'UNITS':>8}  {'R$':>14}  {'LAST NF':10}", flush=True)
    print(f"  {'-'*10}  {'-'*40}  {'-'*5}  {'-'*8}  {'-'*14}  {'-'*10}", flush=True)
    for r in result:
        print(f"  {r['cnpj_root']:10s}  {(r['razao_social'] or '?')[:40]:40s}  "
              f"{r['nfs']:>5d}  {r['units']:>8,.0f}  R$ {r['value']:>12,.2f}  {r['last_nf'] or '?':10}", flush=True)
    print(f"\n  Total unique B2B customers: {len(result)}", flush=True)

    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nraw -> {out_path}", flush=True)


if __name__ == "__main__":
    main()
