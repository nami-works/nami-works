"""
Customer sales by NF-e across ALL Omie connections (read-only).

Avoids Omie's "Consumo redundante" throttle (which kills per-client-code
receivable loops) by using paginated ListarNF — one method, page param only —
then filtering destinatario by CNPJ root client-side. Authoritative for units
AND revenue AND product mix AND month.

Usage:
  python omie_customer_nf_scan.py <cnpj_root_digits> <dEmiInicial> [dEmiFinal] [LABEL,LABEL...]
  e.g. python omie_customer_nf_scan.py 30998254 01/01/2025 12/06/2026

tpNF 1 = saida/sale (+), 0 = entrada/return (-). Writes raw rows to JSON.
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
                # honour an explicit "aguarde N segundos" if present
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
    root = sys.argv[1] if len(sys.argv) > 1 else "30998254"
    d_lo = sys.argv[2] if len(sys.argv) > 2 else "01/01/2025"
    d_hi = sys.argv[3] if len(sys.argv) > 3 else "12/06/2026"
    only = set(sys.argv[4].upper().split(",")) if len(sys.argv) > 4 else None
    out_path = Path(__file__).resolve().parent / f"customer_{root}_nf.out.json"

    conns = load_connections(ENV_PATH)
    if only:
        conns = [c for c in conns if c["label"].upper() in only]

    # CFOP 5917/6917 = remessa em consignação (outgoing, adds to stock-at-customer)
    # CFOP 1917/2917 = retorno de consignação (incoming return, reduces stock-at-customer)
    # All other outgoing CFOPs = actual sale
    CFOP_CONSIGN_OUT = {"5917", "6917"}
    CFOP_CONSIGN_RET = {"1917", "2917"}

    audit = {"root": root, "window": [d_lo, d_hi], "by_conn": {}, "rows": []}
    g_sale_u = g_sale_v = g_con_out_u = g_con_out_v = g_con_ret_u = g_con_ret_v = g_nfs = 0.0
    # sale: confirmed revenue; con_out: shipped on consignment; con_ret: returned from consignment
    sku_sale_u, sku_sale_v = defaultdict(float), defaultdict(float)
    sku_con_u,  sku_con_v  = defaultdict(float), defaultdict(float)
    sku_d = {}
    mon_u, mon_v = defaultdict(float), defaultdict(float)

    for c in conns:
        ak, as_ = c["app_key"], c["app_secret"]
        page, total_pages, scanned, hits = 1, None, 0, 0
        cu_sale = cv_sale = cu_con_out = cv_con_out = cu_con_ret = cv_con_ret = 0.0
        while True:
            res = call(ak, as_, {"pagina": page, "registros_por_pagina": 50,
                                 "apenas_importado_api": "N", "dEmiInicial": d_lo, "dEmiFinal": d_hi})
            if "_error" in res:
                print(f"[{c['label']}] page {page} ERROR {res['_error'][:90]} (skip)", file=sys.stderr, flush=True)
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
                dest_cnpj = dig(nf.get("nfDestInt", {}).get("cnpj_cpf", ""))
                emit_cnpj = dig(nf.get("nfEmitInt", {}).get("cnpj_cpf", ""))
                # outgoing NF to customer OR incoming NF from customer (consignment return)
                is_match = dest_cnpj.startswith(root) or (tp == "0" and emit_cnpj.startswith(root))
                if not is_match:
                    continue
                # skip cancelled / denied / inutilized
                if (ide.get("dCan") or "").strip() or ide.get("cDeneg") == "S" \
                        or (ide.get("dInut") or "").strip():
                    audit.setdefault("cancelled", []).append(
                        {"conn": c["label"], "nNF": ide.get("nNF"), "dEmi": ide.get("dEmi"),
                         "dCan": ide.get("dCan"), "cDeneg": ide.get("cDeneg")})
                    continue
                hits += 1
                nf_total_u = nf_total_v = 0.0
                row_cfops = set()
                mk = (ide.get("dEmi") or "")[3:]
                for d in nf.get("det", []):
                    p = d.get("prod", {})
                    cfop = p.get("CFOP", "").replace(".", "")
                    row_cfops.add(cfop)
                    qty  = float(p.get("qCom",  0) or 0)
                    val  = float(p.get("vProd", 0) or 0)
                    k    = p.get("cProd", "?")
                    sku_d.setdefault(k, p.get("xProd"))
                    if tp == "1" and cfop in CFOP_CONSIGN_OUT:
                        cu_con_out += qty; cv_con_out += val
                        sku_con_u[k] += qty; sku_con_v[k] += val
                    elif tp == "0" and cfop in CFOP_CONSIGN_RET:
                        cu_con_ret += qty; cv_con_ret += val
                        sku_con_u[k] -= qty; sku_con_v[k] -= val
                    elif tp == "1":
                        cu_sale += qty; cv_sale += val
                        sku_sale_u[k] += qty; sku_sale_v[k] += val
                        mon_u[mk] += qty; mon_v[mk] += val
                    nf_total_u += qty
                nf_total_v = float(nf.get("total", {}).get("ICMSTot", {}).get("vNF", 0) or 0)
                audit["rows"].append({
                    "conn": c["label"], "nNF": ide.get("nNF"), "serie": ide.get("serie"),
                    "dEmi": ide.get("dEmi"), "tpNF": tp,
                    "cnpj": dest_cnpj if tp == "1" else emit_cnpj,
                    "cfops": sorted(row_cfops), "units": nf_total_u, "vNF": nf_total_v,
                })
            if page % 25 == 0:
                print(f"[{c['label']}] {page}/{total_pages} scanned={scanned} hits={hits}", flush=True)
            if page >= (total_pages or 1):
                break
            page += 1
        audit["by_conn"][c["label"]] = {
            "nfs": hits,
            "sale_units": cu_sale,   "sale_value": cv_sale,
            "con_out_units": cu_con_out, "con_out_value": cv_con_out,
            "con_ret_units": cu_con_ret, "con_ret_value": cv_con_ret,
            "con_net_units": cu_con_out - cu_con_ret, "con_net_value": cv_con_out - cv_con_ret,
        }
        print(f"[{c['label']}] DONE nfs={hits} "
              f"sale={cu_sale:,.0f}u/R${cv_sale:,.2f} "
              f"consign_net={cu_con_out-cu_con_ret:,.0f}u/R${cv_con_out-cv_con_ret:,.2f}", flush=True)
        g_sale_u += cu_sale; g_sale_v += cv_sale
        g_con_out_u += cu_con_out; g_con_out_v += cv_con_out
        g_con_ret_u += cu_con_ret; g_con_ret_v += cv_con_ret
        g_nfs += hits

    g_con_net_u = g_con_out_u - g_con_ret_u
    g_con_net_v = g_con_out_v - g_con_ret_v

    months = sorted([m for m in mon_u if m], key=lambda s: (int(s[3:]), int(s[:2])))
    print("\n================ CUSTOMER NF TOTALS ================", flush=True)
    for label, b in audit["by_conn"].items():
        if b["nfs"]:
            print(f"  {label:16s} nfs={b['nfs']:>4} "
                  f"sale={b['sale_units']:>7,.0f}u/R${b['sale_value']:>11,.2f} "
                  f"consign_net={b['con_net_units']:>7,.0f}u/R${b['con_net_value']:>11,.2f}")
    print(f"  {'TOTAL':16s} nfs={int(g_nfs):>4} "
          f"sale={g_sale_u:>7,.0f}u/R${g_sale_v:>11,.2f} "
          f"consign_net={g_con_net_u:>7,.0f}u/R${g_con_net_v:>11,.2f}")
    print(f"\n  months (actual sales):")
    for m in months:
        print(f"     {m}: {mon_u[m]:>6,.0f} u | R$ {mon_v[m]:,.2f}")
    print("\n  per-product (actual sales):")
    for k, u in sorted(sku_sale_u.items(), key=lambda x: -x[1]):
        print(f"     {k:10s} {u:>6,.0f} u | R$ {sku_sale_v[k]:>11,.2f} | {(sku_d.get(k) or '')[:34]}")
    if any(v != 0 for v in sku_con_u.values()):
        print("\n  per-product (net consignment outstanding):")
        for k, u in sorted(sku_con_u.items(), key=lambda x: -x[1]):
            if u:
                print(f"     {k:10s} {u:>6,.0f} u | R$ {sku_con_v[k]:>11,.2f} | {(sku_d.get(k) or '')[:34]}")

    audit["totals"] = {
        "nfs": g_nfs,
        "sale_units": g_sale_u, "sale_value": g_sale_v,
        "con_out_units": g_con_out_u, "con_out_value": g_con_out_v,
        "con_ret_units": g_con_ret_u, "con_ret_value": g_con_ret_v,
        "con_net_units": g_con_net_u, "con_net_value": g_con_net_v,
    }
    audit["sku_sale_u"], audit["sku_sale_v"] = sku_sale_u, sku_sale_v
    audit["sku_con_u"],  audit["sku_con_v"]  = sku_con_u,  sku_con_v
    audit["sku_d"] = sku_d
    audit["mon_u"], audit["mon_v"] = mon_u, mon_v
    out_path.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nraw -> {out_path}", flush=True)


if __name__ == "__main__":
    main()
