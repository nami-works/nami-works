"""
Total discounted-duplicata exposure across B2B box customers (read-only).

For each box customer, across all Omie connections: resolve client code(s),
pull every conta-a-receber title, classify discounted (numero_documento ~
"DESCONTO") vs normal, and split by whether the sacado is still due at the bank
(vencimento >= today => live recourse exposure under coobrigacao).

CAVEAT: Omie reflects GE's books (GE received cash via discount). The
authoritative open recourse position is Itau's carteira descontada / bordero.
Reconcile this against the bank before acting.
"""
import json, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/"
CR_URL = "https://app.omie.com.br/api/v1/financas/contareceber/"
_RETRY = ("requisi", "consumo", "soap-env:server", "redundante", "number of requests")
TODAY = (2026, 6, 29)  # date global is unavailable in this env; passed as constant

# Box / subscription channel customers (term used by ListarClientes razao_social filter, CNPJ root)
BOX_CUSTOMERS = [
    ("B4A",     "13475001"),
    ("UAUBOX",  "28917082"),
    ("MAGENTA", "33144026"),
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


def dig(s): return "".join(c for c in (s or "") if c.isdigit())


def dtuple(s):
    try:
        d, m, y = s.split("/"); return (int(y), int(m), int(d))
    except Exception:
        return (0, 0, 0)


def call(url, ak, as_, method, param, retries=6):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(1.1)
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt}
            if any(m in txt.lower() for m in _RETRY):
                time.sleep(9.0 * (attempt + 1)); continue
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e)}; time.sleep(5.0 * (attempt + 1))
    return last or {"_error": "exhausted"}


def is_discounted(t):
    blob = " ".join(str(t.get(k) or "") for k in ("numero_documento", "observacao")).upper()
    return "DESCONT" in blob


def main():
    conns = load_connections(ENV_PATH)
    audit = {"today": TODAY, "customers": {}, "titles": []}

    for term, root in BOX_CUSTOMERS:
        cust = {"root": root, "by_conn": {}, "disc_total": 0.0, "disc_future": 0.0,
                "disc_past": 0.0, "normal_total": 0.0, "n_titles": 0}
        for c in conns:
            cl = call(CLIENTES_URL, c["app_key"], c["app_secret"], "ListarClientes",
                      {"pagina": 1, "registros_por_pagina": 100, "apenas_importado_api": "N",
                       "clientesFiltro": {"razao_social": term}})
            if "_error" in cl:
                print(f"[{c['label']}] {term} ListarClientes ERR {cl['_error'][:80]}", flush=True)
                continue
            recs = [r for r in (cl.get("clientes_cadastro", []) or cl.get("clientes_cadastro_resumido", []))
                    if dig(r.get("cnpj_cpf")).startswith(root)]
            for r in recs:
                code = int(r.get("codigo_cliente_omie") or r.get("codigo_cliente"))
                page = 1
                while True:
                    cr = call(CR_URL, c["app_key"], c["app_secret"], "ListarContasReceber",
                              {"pagina": page, "registros_por_pagina": 200, "filtrar_cliente": code})
                    if "_error" in cr:
                        print(f"[{c['label']}] {term} code={code} CR ERR {cr['_error'][:80]}", flush=True)
                        break
                    for t in cr.get("conta_receber_cadastro") or []:
                        val = float(t.get("valor_documento", 0) or 0)
                        venc = t.get("data_vencimento")
                        disc = is_discounted(t)
                        future = dtuple(venc) >= TODAY
                        rec = {"conn": c["label"], "customer": term, "cnpj": r.get("cnpj_cpf"),
                               "lancamento": t.get("codigo_lancamento_omie"),
                               "parcela": t.get("numero_parcela"),
                               "nf": t.get("numero_documento_fiscal"),
                               "numero_documento": t.get("numero_documento"),
                               "valor": val, "venc": venc,
                               "emissao": t.get("data_emissao"),
                               "status": t.get("status_titulo"),
                               "discounted": disc, "future": future}
                        audit["titles"].append(rec)
                        cust["n_titles"] += 1
                        cb = cust["by_conn"].setdefault(c["label"], {"disc": 0.0, "normal": 0.0})
                        if disc:
                            cust["disc_total"] += val
                            cb["disc"] += val
                            if future:
                                cust["disc_future"] += val
                            else:
                                cust["disc_past"] += val
                        else:
                            cust["normal_total"] += val
                            cb["normal"] += val
                    if page >= (cr.get("total_de_paginas") or 1):
                        break
                    page += 1
        audit["customers"][term] = cust
        print(f"=== {term} (root {root}) ===", flush=True)
        print(f"    titles={cust['n_titles']} | discounted total R$ {cust['disc_total']:,.2f} "
              f"(future/live R$ {cust['disc_future']:,.2f} | past R$ {cust['disc_past']:,.2f}) "
              f"| non-discounted R$ {cust['normal_total']:,.2f}", flush=True)

    g_disc = sum(c["disc_total"] for c in audit["customers"].values())
    g_future = sum(c["disc_future"] for c in audit["customers"].values())
    g_past = sum(c["disc_past"] for c in audit["customers"].values())
    g_norm = sum(c["normal_total"] for c in audit["customers"].values())
    audit["grand"] = {"disc_total": g_disc, "disc_future": g_future, "disc_past": g_past,
                      "normal_total": g_norm}
    print("\n================ DISCOUNTED EXPOSURE (box customers) ================", flush=True)
    print(f"  Total discounted ever:        R$ {g_disc:,.2f}", flush=True)
    print(f"  Live recourse (venc >= today): R$ {g_future:,.2f}  <-- worst-case recompra if all default", flush=True)
    print(f"  Past-due (should be settled):  R$ {g_past:,.2f}", flush=True)
    print(f"  Non-discounted open:          R$ {g_norm:,.2f}", flush=True)

    out_path = Path(__file__).resolve().parent / "_box_discounted_exposure.out.json"
    out_path.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nraw -> {out_path}", flush=True)


if __name__ == "__main__":
    main()
