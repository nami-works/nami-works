"""
Map Amazon receivables by CNPJ x connection (read-only, cheap).

For each of the 6 Omie companies and each Amazon branch code, pull
ListarContasReceber (server-side filtrar_cliente). Reports per (connection,
CNPJ): #titles, revenue, date span, and referenced NF numbers. Identifies
where 0012-58 actually has orders before any heavy NF scan.

Robust against Omie's per-method serialization + connection resets.
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
OUT_PATH = Path(__file__).resolve().parent / "amazon_cnpj_receivables_map.out.json"
CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/"
CR_URL = "https://app.omie.com.br/api/v1/financas/contareceber/"
AMZ_ROOT = "15436940"
CNPJ_LABEL = {"15436940001258": "0012-58"}


def load_connections(path):
    conns, label, pending = [], None, {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("##"):
            label, pending = s.lstrip("#").strip(), {}
            continue
        if s.startswith("#") or "=" not in s:
            continue
        k, v = (x.strip() for x in s.split("=", 1))
        if k.startswith("OMIE_APP_KEY_"):
            pending["app_key"] = v
        elif k.startswith("OMIE_APP_SECRET_"):
            pending["app_secret"] = v
        if "app_key" in pending and "app_secret" in pending:
            conns.append({"label": label, **pending}); pending = {}
    return conns


_RETRY = ("ja existe uma requisi", "já existe uma requisi", "consumo",
          "soap-env:server", "number of requests")


def call(url, ak, as_, method, param, retries=10):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(2.0)
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace")
            last = {"_error": txt, "_http": e.code}
            if any(m in txt.lower() for m in _RETRY):
                time.sleep(12.0); continue  # let the prior same-method query finish
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e), "_http": None}
            time.sleep(2.5 * (attempt + 1))
    return last or {"_error": "exhausted", "_http": None}


def digits(s):
    return "".join(ch for ch in (s or "") if ch.isdigit())


def amazon_codes_by_cnpj(ak, as_):
    res = call(CLIENTES_URL, ak, as_, "ListarClientes", {
        "pagina": 1, "registros_por_pagina": 50, "apenas_importado_api": "N",
        "clientesFiltro": {"razao_social": "AMAZON"}})
    out = {}
    for r in res.get("clientes_cadastro", []) or res.get("clientes_cadastro_resumido", []):
        d = digits(r.get("cnpj_cpf"))
        if d.startswith(AMZ_ROOT):
            out[d] = int(r.get("codigo_cliente_omie") or r.get("codigo_cliente"))
    return out


def receivables(ak, as_, code):
    titles, page = [], 1
    while True:
        res = call(CR_URL, ak, as_, "ListarContasReceber",
                   {"pagina": page, "registros_por_pagina": 200, "filtrar_cliente": code})
        if "_error" in res:
            print(f"      ERROR code={code}: {res['_error'][:100]}", file=sys.stderr)
            return None  # signal failure (distinct from genuine empty)
        titles.extend(res.get("conta_receber_cadastro") or [])
        if page >= (res.get("total_de_paginas") or 1):
            break
        page += 1
    return titles


def dkey(s):
    try:
        d, m, y = s.split("/"); return (int(y), int(m), int(d))
    except Exception:
        return (0, 0, 0)


def main():
    conns = load_connections(ENV_PATH)
    audit = {}
    print(f"{'CONNECTION':16s} {'CNPJ':22s} {'TITLES':>6s} {'REVENUE':>14s}  SPAN")
    print("-" * 80)
    for c in conns:
        codes = amazon_codes_by_cnpj(c["app_key"], c["app_secret"])
        for cnpj, label in CNPJ_LABEL.items():
            code = codes.get(cnpj)
            if not code:
                continue
            titles = receivables(c["app_key"], c["app_secret"], code)
            if titles is None:
                print(f"{c['label']:16s} {label:22s} {'ERR':>6s}  (fetch failed)")
                continue
            seen, rev, dates, nfs = set(), 0.0, [], []
            for t in titles:
                tid = t.get("codigo_lancamento_omie")
                if tid in seen:
                    continue
                seen.add(tid)
                rev += float(t.get("valor_documento", 0) or 0)
                de = t.get("data_emissao") or t.get("data_registro")
                if de:
                    dates.append(de)
                if t.get("numero_documento_fiscal"):
                    nfs.append(t["numero_documento_fiscal"])
            span = f"{min(dates,key=dkey)}..{max(dates,key=dkey)}" if dates else "-"
            print(f"{c['label']:16s} {label:22s} {len(seen):>6d} {('R$ '+format(rev,',.2f')):>14s}  {span}")
            audit[f"{c['label']}|{cnpj}"] = {
                "connection": c["label"], "cnpj": cnpj, "code": code,
                "titles": len(seen), "revenue": rev,
                "span": span, "nf_refs": nfs}
    OUT_PATH.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nraw -> {OUT_PATH}")


if __name__ == "__main__":
    main()
