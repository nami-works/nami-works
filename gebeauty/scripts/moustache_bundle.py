"""
Moustache Beams (CNPJ root 30998254) sales bundle — read-only.

Uses NF number-range scanning (reliable; date-window pagination drops records
past ~50 pages). Moustache NFs are issued from two entities, both serie 001:
  - MATRIZ        : ~Nov 2025 cluster (nNF ~77000-79500)
  - SHOPS JARDINS : low serie-001 numbers (nNF 1-4000), like the Amazon B2B flow

Filters destinatario by CNPJ root, skips cancelled/denied notes (ide.dCan etc.),
sums qCom (units) + vProd (per-SKU value) + vNF, by month and per product.
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
OUT_PATH = Path(__file__).resolve().parent / "moustache_bundle.out.json"
NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
ROOT = "30998254"
SCANS = [("MATRIZ", "00077000", "00079500"), ("SHOPS JARDINS", "00000001", "00004000")]
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
    for attempt in range(retries):
        time.sleep(0.8)
        try:
            req = urllib.request.Request(NF_URL, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); low = txt.lower()
            if any(m in low for m in _RETRY):
                import re; m = re.search(r"aguarde\s+(\d+)", low)
                time.sleep(float(m.group(1)) + 2 if m else 8.0 * (attempt + 1)); continue
            return {"_error": txt}
        except (urllib.error.URLError, OSError):
            time.sleep(5.0 * (attempt + 1))
    return {"_error": "exhausted"}


def main():
    conns = {c["label"]: c for c in load_connections(ENV_PATH)}
    rows, cancelled = [], []
    sku_u, sku_v, sku_d = defaultdict(float), defaultdict(float), {}
    mon_u, mon_v = defaultdict(float), defaultdict(float)
    by_conn = defaultdict(lambda: {"nfs": 0, "units": 0.0, "value": 0.0})

    for label, lo, hi in SCANS:
        c = conns[label]; ak, as_ = c["app_key"], c["app_secret"]
        page, total_pages, scanned, hits = 1, None, 0, 0
        while True:
            res = call(ak, as_, {"pagina": page, "registros_por_pagina": 50,
                                 "apenas_importado_api": "N", "nNFInicial": lo, "nNFFinal": hi})
            if "_error" in res:
                print(f"[{label}] page {page} ERROR {res['_error'][:80]}", file=sys.stderr, flush=True)
                if total_pages and page < total_pages:
                    page += 1; continue
                break
            if total_pages is None:
                total_pages = res.get("total_de_paginas") or 1
                print(f"[{label}] {lo}-{hi}: {res.get('total_de_registros')} notes / {total_pages} pages", flush=True)
            for nf in res.get("nfCadastro") or []:
                scanned += 1
                if not dig(nf.get("nfDestInt", {}).get("cnpj_cpf")).startswith(ROOT):
                    continue
                ide = nf.get("ide", {})
                # genuine cancellation = a real date in dCan/dInut (e.g. "18/11/2025"); benign
                # defaults like "0"/"N" in cDeneg must NOT trigger a skip.
                if "/" in (ide.get("dCan") or "") or "/" in (ide.get("dInut") or ""):
                    cancelled.append({"conn": label, "nNF": ide.get("nNF"), "dEmi": ide.get("dEmi"),
                                      "dCan": ide.get("dCan"), "vNF": nf.get("total", {}).get("ICMSTot", {}).get("vNF")})
                    continue
                hits += 1
                sgn = 1 if str(ide.get("tpNF")) == "1" else -1
                u = sum(float(d.get("prod", {}).get("qCom", 0) or 0) for d in nf.get("det", []))
                v = float(nf.get("total", {}).get("ICMSTot", {}).get("vNF", 0) or 0)
                mk = (ide.get("dEmi") or "")[3:]
                mon_u[mk] += sgn * u; mon_v[mk] += sgn * v
                by_conn[label]["nfs"] += 1; by_conn[label]["units"] += sgn * u; by_conn[label]["value"] += sgn * v
                for d in nf.get("det", []):
                    p = d.get("prod", {}); k = p.get("cProd", "?")
                    sku_u[k] += sgn * float(p.get("qCom", 0) or 0)
                    sku_v[k] += sgn * float(p.get("vProd", 0) or 0)
                    sku_d.setdefault(k, p.get("xProd"))
                rows.append({"conn": label, "nNF": ide.get("nNF"), "dEmi": ide.get("dEmi"),
                             "cnpj": dig(nf.get("nfDestInt", {}).get("cnpj_cpf")), "units": u, "vNF": v})
            if page % 20 == 0:
                print(f"[{label}] {page}/{total_pages} scanned={scanned} hits={hits}", flush=True)
            if page >= (total_pages or 1):
                break
            page += 1
        print(f"[{label}] DONE nfs={hits} units={by_conn[label]['units']:,.0f} value=R$ {by_conn[label]['value']:,.2f}", flush=True)

    g_nfs = sum(b["nfs"] for b in by_conn.values())
    g_u = sum(b["units"] for b in by_conn.values())
    g_v = sum(b["value"] for b in by_conn.values())
    months = sorted([m for m in mon_u if m], key=lambda s: (int(s[3:]), int(s[:2])))
    print("\n================ MOUSTACHE BEAMS — NF totals ================", flush=True)
    for label, b in by_conn.items():
        print(f"  {label:16s} nfs={b['nfs']:>3d} units={b['units']:>7,.0f} R$ {b['value']:>13,.2f}")
    print(f"  {'TOTAL':16s} nfs={g_nfs:>3d} units={g_u:>7,.0f} R$ {g_v:>13,.2f}")
    print(f"  cancelled/skipped notes: {len(cancelled)} {cancelled}")
    print(f"\n  months: {months}")
    for m in months:
        print(f"     {m}: {mon_u[m]:>6,.0f} u | R$ {mon_v[m]:,.2f}")
    print("\n  per-product:")
    for k, u in sorted(sku_u.items(), key=lambda x: -x[1]):
        print(f"     {k:10s} {u:>6,.0f} u | R$ {sku_v[k]:>12,.2f} | {(sku_d.get(k) or '')[:34]}")
    OUT_PATH.write_text(json.dumps({"rows": rows, "cancelled": cancelled, "by_conn": by_conn,
        "sku_u": sku_u, "sku_v": sku_v, "sku_d": sku_d, "mon_u": mon_u, "mon_v": mon_v,
        "totals": {"nfs": g_nfs, "units": g_u, "value": g_v}}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nraw -> {OUT_PATH}", flush=True)


if __name__ == "__main__":
    main()
