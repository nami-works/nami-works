"""
Complete Amazon bundle: ALL NF-e issued to any Amazon CNPJ (root 15436940),
across the whole relationship. Verified single issuer = SHOPS JARDINS, serie 001.
Scan the serie-001 number range and keep Amazon-destinatario notes; sum qCom
(units) + vNF (value), split by CNPJ. Read-only.
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
OUT_PATH = Path(__file__).resolve().parent / "amazon_all_bundle.out.json"
NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
AMZ_ROOT = "15436940"
NF_LO, NF_HI = "00000001", "00004000"   # serie-001 range covering all Amazon activity


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


def call(ak, as_, param, retries=8):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": "ListarNF", "param": [param]}).encode()
    for attempt in range(retries):
        time.sleep(1.0)
        try:
            req = urllib.request.Request(NF_URL, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace")
            if "requisi" in txt.lower() or "consumo" in txt.lower():
                time.sleep(8.0); continue
            return {"_error": txt}
        except (urllib.error.URLError, OSError):
            time.sleep(5.0)
    return {"_error": "exhausted"}


def main():
    c = next(x for x in load_connections(ENV_PATH) if x["label"] == "SHOPS JARDINS")
    ak, as_ = c["app_key"], c["app_secret"]
    page, total_pages, scanned = 1, None, 0
    rows = []
    while True:
        res = call(ak, as_, {"pagina": page, "registros_por_pagina": 50, "apenas_importado_api": "N",
                             "nNFInicial": NF_LO, "nNFFinal": NF_HI})
        if "_error" in res:
            print(f"[nf] page {page} ERROR {res['_error'][:100]}", file=sys.stderr); break
        if total_pages is None:
            total_pages = res.get("total_de_paginas") or 1
            print(f"[nf] serie-001 range {NF_LO}-{NF_HI}: {res.get('total_de_registros')} notes / {total_pages} pages")
        for nf in res.get("nfCadastro") or []:
            scanned += 1
            cnpj = dig(nf.get("nfDestInt", {}).get("cnpj_cpf"))
            if cnpj.startswith(AMZ_ROOT):
                ide = nf.get("ide", {})
                units = sum(float(d.get("prod", {}).get("qCom", 0) or 0) for d in nf.get("det", []))
                vnf = float(nf.get("total", {}).get("ICMSTot", {}).get("vNF", 0) or 0)
                skus = {}  # cProd -> {q, v, descr}
                for d in nf.get("det", []):
                    p = d.get("prod", {})
                    sku = p.get("cProd", "?")
                    e = skus.setdefault(sku, {"q": 0.0, "v": 0.0, "descr": p.get("xProd")})
                    e["q"] += float(p.get("qCom", 0) or 0)
                    e["v"] += float(p.get("vProd", 0) or 0)
                rows.append({"nNF": ide.get("nNF"), "cnpj": cnpj, "dEmi": ide.get("dEmi"),
                             "tpNF": ide.get("tpNF"), "units": units, "vNF": vnf, "skus": skus})
        if page % 20 == 0:
            print(f"[nf] {page}/{total_pages} scanned={scanned} amazon={len(rows)}")
        if page >= (total_pages or 1):
            break
        page += 1

    # aggregate
    def sgn(r): return 1 if str(r["tpNF"]) == "1" else -1
    by_cnpj = defaultdict(lambda: {"nfs": 0, "units": 0.0, "value": 0.0})
    by_month_u, by_month_v = defaultdict(float), defaultdict(float)
    sku_units = defaultdict(float)
    sku_value = defaultdict(float)
    sku_descr = {}
    months_set = set()
    for r in rows:
        b = by_cnpj[r["cnpj"]]
        b["nfs"] += 1; b["units"] += sgn(r) * r["units"]; b["value"] += sgn(r) * r["vNF"]
        mk = (r["dEmi"] or "")[3:]
        months_set.add(mk)
        by_month_u[mk] += sgn(r) * r["units"]; by_month_v[mk] += sgn(r) * r["vNF"]
        for k, e in r["skus"].items():
            sku_units[k] += sgn(r) * e["q"]
            sku_value[k] += sgn(r) * e["v"]
            sku_descr.setdefault(k, e.get("descr"))

    tot_nfs = len(rows)
    tot_u = sum(sgn(r) * r["units"] for r in rows)
    tot_v = sum(sgn(r) * r["vNF"] for r in rows)
    months = sorted(m for m in months_set if m)

    print("\n================ ALL AMAZON (Shops Jardins, all CNPJs) ================")
    print(f"{'CNPJ':16s} {'NFs':>4s} {'UNITS':>7s} {'VALUE':>14s}")
    for cnpj, b in sorted(by_cnpj.items()):
        tag = {"15436940000103": "0001-03", "15436940000367": "0003-67",
               "15436940001258": "0012-58"}.get(cnpj, cnpj)
        print(f"{tag:16s} {b['nfs']:>4d} {b['units']:>7.0f} {('R$ '+format(b['value'],',.2f')):>14s}")
    print(f"{'TOTAL':16s} {tot_nfs:>4d} {tot_u:>7.0f} {('R$ '+format(tot_v,',.2f')):>14s}")

    print(f"\nactive months ({len(months)}): {months}")
    for m in months:
        print(f"   {m}: {by_month_u[m]:>5.0f} units | R$ {by_month_v[m]:,.2f}")

    print("\n---- AVERAGES (all Amazon CNPJs bundled) ----")
    if tot_nfs:
        print(f"  per order : {tot_u/tot_nfs:,.1f} units | R$ {tot_v/tot_nfs:,.2f}")
    full = [m for m in months if m not in (months[0], months[-1])] if len(months) > 2 else months
    if full:
        fu = sum(by_month_u[m] for m in full) / len(full)
        fv = sum(by_month_v[m] for m in full) / len(full)
        print(f"  per month (full months {full[0]}..{full[-1]}, n={len(full)}): {fu:,.0f} units | R$ {fv:,.2f}")
    if months:
        print(f"  per month (all {len(months)} incl. partial ends): {tot_u/len(months):,.0f} units | R$ {tot_v/len(months):,.2f}")

    print("\nper-product (units | revenue):")
    for sku, u in sorted(sku_units.items(), key=lambda x: -x[1]):
        print(f"   {sku:10s} {u:>6,.0f}  R$ {sku_value[sku]:>11,.2f}  {(sku_descr.get(sku) or '')[:40]}")

    OUT_PATH.write_text(json.dumps({"rows": rows, "by_cnpj": by_cnpj,
                                    "by_month_u": by_month_u, "by_month_v": by_month_v,
                                    "sku_units": sku_units, "sku_value": sku_value,
                                    "sku_descr": sku_descr}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nraw -> {OUT_PATH}")


if __name__ == "__main__":
    main()
