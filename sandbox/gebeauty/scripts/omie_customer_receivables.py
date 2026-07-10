"""
Customer sales sweep across all Omie connections — revenue + scope (read-only).

Usage:
  python omie_customer_receivables.py <search_term> <cnpj_root_digits>
  e.g.  python omie_customer_receivables.py MOUSTACHE 30998254

For each of the 6 Omie companies: find every client whose CNPJ starts with the
root, then pull ListarContasReceber (server-side filtrar_cliente) for each.
Aggregates revenue + date span + NF references per (connection, CNPJ branch),
and totals. Throttle-safe (Omie serializes one request per method per account).

This is the cheap "where + how much" pass. Unit/per-product resolution is a
separate step once we know which connections carry the volume.
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/"
CR_URL = "https://app.omie.com.br/api/v1/financas/contareceber/"
_RETRY = ("requisi", "consumo", "soap-env:server", "number of requests")


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


def call(url, ak, as_, method, param, retries=4):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(1.3)
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as r:  # short: never hang on a stuck socket
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt, "_http": e.code}
            if any(m in txt.lower() for m in _RETRY):
                time.sleep(6.0); continue
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e)}; time.sleep(4.0)
    return last or {"_error": "exhausted"}


def dkey(s):
    try:
        d, m, y = s.split("/"); return (int(y), int(m), int(d))
    except Exception:
        return (0, 0, 0)


def main():
    term = sys.argv[1] if len(sys.argv) > 1 else "MOUSTACHE"
    root = sys.argv[2] if len(sys.argv) > 2 else "30998254"
    out_path = Path(__file__).resolve().parent / f"customer_{term.lower()}_receivables.out.json"
    conns = load_connections(ENV_PATH)

    audit = {"term": term, "root": root, "by_conn_cnpj": {}, "all_titles": []}
    grand_rev, grand_titles, all_dates, all_nfrefs = 0.0, 0, [], 0
    by_conn = defaultdict(lambda: {"rev": 0.0, "titles": 0, "dates": []})

    for c in conns:
        cl = call(CLIENTES_URL, c["app_key"], c["app_secret"], "ListarClientes", {
            "pagina": 1, "registros_por_pagina": 100, "apenas_importado_api": "N",
            "clientesFiltro": {"razao_social": term}})
        recs = [r for r in (cl.get("clientes_cadastro", []) or cl.get("clientes_cadastro_resumido", []))
                if dig(r.get("cnpj_cpf")).startswith(root)]
        print(f"=== {c['label']}: {len(recs)} {term} client codes ===", flush=True)
        for r in recs:
            code = int(r.get("codigo_cliente_omie") or r.get("codigo_cliente"))
            cnpj = r.get("cnpj_cpf")
            titles, page = [], 1
            while True:
                res = call(CR_URL, c["app_key"], c["app_secret"], "ListarContasReceber",
                           {"pagina": page, "registros_por_pagina": 200, "filtrar_cliente": code})
                if "_error" in res:
                    print(f"    code={code} ERROR {res['_error'][:80]}", file=sys.stderr); break
                titles.extend(res.get("conta_receber_cadastro") or [])
                if page >= (res.get("total_de_paginas") or 1):
                    break
                page += 1
            if not titles:
                continue
            seen, rev, dates, nfrefs = set(), 0.0, [], []
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
                    nfrefs.append(t["numero_documento_fiscal"])
                audit["all_titles"].append({"conn": c["label"], "cnpj": cnpj, **{k: t.get(k) for k in (
                    "codigo_lancamento_omie", "valor_documento", "data_emissao",
                    "numero_documento_fiscal", "status_titulo")}})
            key = f"{c['label']}|{cnpj}"
            audit["by_conn_cnpj"][key] = {"code": code, "titles": len(seen), "revenue": rev,
                "span": f"{min(dates,key=dkey)}..{max(dates,key=dkey)}" if dates else "-",
                "nf_refs": nfrefs}
            by_conn[c["label"]]["rev"] += rev
            by_conn[c["label"]]["titles"] += len(seen)
            by_conn[c["label"]]["dates"].extend(dates)
            grand_rev += rev; grand_titles += len(seen); all_dates += dates; all_nfrefs += len(nfrefs)
            print(f"    {cnpj}: {len(seen)} titles  R$ {rev:,.2f}", flush=True)

    print("\n================ SUMMARY by connection ================")
    for label, b in by_conn.items():
        span = f"{min(b['dates'],key=dkey)}..{max(b['dates'],key=dkey)}" if b["dates"] else "-"
        print(f"  {label:16s} titles={b['titles']:>4d}  R$ {b['rev']:>14,.2f}  {span}")
    print(f"\n  GRAND TOTAL: {grand_titles} titles | R$ {grand_rev:,.2f} | "
          f"span {min(all_dates,key=dkey) if all_dates else '-'}..{max(all_dates,key=dkey) if all_dates else '-'} | "
          f"{all_nfrefs} NF refs")
    audit["grand"] = {"titles": grand_titles, "revenue": grand_rev}
    out_path.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nraw -> {out_path}", flush=True)


if __name__ == "__main__":
    main()
