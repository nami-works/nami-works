"""
Units + value for the 16 NF-e issued to Amazon 0012-58 in SHOPS JARDINS.
Fetch each NF by number (ListarNF nNFInicial/Final), disambiguate by
destinatario CNPJ, sum qCom (units) + vNF (value). Read-only.
"""
import json, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
TARGET_CNPJ = "15436940001258"
NF_NUMBERS = ["00001978","00001980","00001985","00002110","00002111","00002228",
              "00002229","00002230","00002337","00002438","00002454","00002510",
              "00002621","00002669","00002714","00002755"]


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


def digits(s): return "".join(c for c in (s or "") if c.isdigit())


def call(ak, as_, param, retries=6):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": "ListarNF", "param": [param]}).encode()
    for attempt in range(retries):
        time.sleep(1.3)
        try:
            req = urllib.request.Request(NF_URL, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace")
            if "requisi" in txt.lower() or "consumo" in txt.lower():
                time.sleep(8.0); continue
            return {"_error": txt}
        except (urllib.error.URLError, OSError) as e:
            time.sleep(5.0)
    return {"_error": "exhausted"}


def main():
    c = next(x for x in load_connections(ENV_PATH) if x["label"] == "SHOPS JARDINS")
    ak, as_ = c["app_key"], c["app_secret"]
    rows, by_month_u, by_month_v = [], defaultdict(float), defaultdict(float)
    sku_units = defaultdict(float)
    print(f"{'NF':>8s} {'serie':>5s} {'tpNF':>4s} {'dEmi':>10s} {'units':>6s} {'vNF':>12s}")
    print("-" * 56)
    for num in NF_NUMBERS:
        res = call(ak, as_, {"pagina": 1, "registros_por_pagina": 20, "apenas_importado_api": "N",
                             "nNFInicial": num, "nNFFinal": num})
        if "_error" in res:
            print(f"{num:>8s}  ERROR {res['_error'][:60]}"); continue
        match = None
        for nf in res.get("nfCadastro") or []:
            if digits(nf.get("nfDestInt", {}).get("cnpj_cpf")) == TARGET_CNPJ:
                match = nf; break
        if not match:
            print(f"{num:>8s}  (no 0012-58 destinatario among "
                  f"{len(res.get('nfCadastro') or [])} hits)"); continue
        ide = match.get("ide", {})
        units = sum(float(d.get("prod", {}).get("qCom", 0) or 0) for d in match.get("det", []))
        vnf = float(match.get("total", {}).get("ICMSTot", {}).get("vNF", 0) or 0)
        for d in match.get("det", []):
            p = d.get("prod", {})
            sku_units[p.get("cProd", "?")] += float(p.get("qCom", 0) or 0)
        mk = (ide.get("dEmi") or "")[3:]
        sign = 1 if str(ide.get("tpNF")) == "1" else -1
        by_month_u[mk] += sign * units
        by_month_v[mk] += sign * vnf
        rows.append({"nNF": num, "serie": ide.get("serie"), "tpNF": ide.get("tpNF"),
                     "dEmi": ide.get("dEmi"), "units": units, "vNF": vnf,
                     "items": len(match.get("det", []))})
        print(f"{num:>8s} {str(ide.get('serie')):>5s} {str(ide.get('tpNF')):>4s} "
              f"{str(ide.get('dEmi')):>10s} {units:>6.0f} {('R$ '+format(vnf,',.2f')):>12s}")

    tot_u = sum((r["units"] if str(r["tpNF"]) == "1" else -r["units"]) for r in rows)
    tot_v = sum((r["vNF"] if str(r["tpNF"]) == "1" else -r["vNF"]) for r in rows)
    n = len(rows)
    months = sorted(m for m in by_month_u if m)
    print("\n================ SHOPS JARDINS -> Amazon 0012-58 ================")
    print(f"  NF-e resolved : {n} / {len(NF_NUMBERS)}")
    print(f"  total units   : {tot_u:,.0f}")
    print(f"  total value   : R$ {tot_v:,.2f}")
    print(f"  months        : {months}")
    for m in months:
        print(f"     {m}: {by_month_u[m]:,.0f} units | R$ {by_month_v[m]:,.2f}")
    if n:
        print(f"\n  AVG / ORDER : {tot_u/n:,.1f} units | R$ {tot_v/n:,.2f}")
    if months:
        print(f"  AVG / MONTH : {tot_u/len(months):,.0f} units | R$ {tot_v/len(months):,.2f}")
    print("\n  top SKUs by units:")
    for sku, u in sorted(sku_units.items(), key=lambda x: -x[1])[:12]:
        print(f"     {sku:12s} {u:,.0f}")

    (Path(__file__).resolve().parent / "amazon_0012_58_units.out.json").write_text(
        json.dumps({"rows": rows, "months_u": by_month_u, "months_v": by_month_v,
                    "sku_units": sku_units}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
