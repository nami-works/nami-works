"""
Confirm B4A NFs 2701 & 2702 issued via SHOPS JARDINS (read-only).

For each NF: destinatario, per-item (SKU, desc, qty, unit price, line total),
NF total (vNF), emission date. Then the contas-a-receber titles linked to each
NF number -> every parcela with due date (data_vencimento), value, status.

Throttle-safe per reference_omie_multi_connection memory.
"""
import json, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/"
CR_URL = "https://app.omie.com.br/api/v1/financas/contareceber/"
_RETRY = ("requisi", "consumo", "soap-env:server", "redundante", "number of requests")
B4A_ROOT = "13475001"
TARGET_NFS = {2701, 2702}


def nf_int(s):
    d = dig(s)
    return int(d) if d else None


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


def call(url, ak, as_, method, param, retries=6):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(1.0)
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt}
            if any(m in txt.lower() for m in _RETRY):
                time.sleep(10.0 * (attempt + 1)); continue
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e)}; time.sleep(5.0 * (attempt + 1))
    return last or {"_error": "exhausted"}


def main():
    conns = load_connections(ENV_PATH)
    sj = next((c for c in conns if c["label"].upper() == "SHOPS JARDINS"), None)
    if not sj:
        print("SHOPS JARDINS connection not found in .env"); return
    ak, as_ = sj["app_key"], sj["app_secret"]

    out = {"connection": "SHOPS JARDINS", "nfs": {}, "receivables": defaultdict(list)}

    # 1) Fetch NF range 2701..2702
    print("=== ListarNF 2701..2702 (SHOPS JARDINS) ===", flush=True)
    res = call(NF_URL, ak, as_, "ListarNF",
               {"pagina": 1, "registros_por_pagina": 50, "apenas_importado_api": "N",
                "nNFInicial": 2701, "nNFFinal": 2702})
    if "_error" in res:
        print("ERROR:", res["_error"][:200]); return
    for nf in res.get("nfCadastro") or []:
        ide = nf.get("ide", {})
        n = nf_int(ide.get("nNF"))
        if n not in TARGET_NFS:
            continue
        nnf = str(n)
        dest = nf.get("nfDestInt", {})
        items = []
        for d in nf.get("det", []):
            p = d.get("prod", {})
            items.append({
                "sku": p.get("cProd"), "desc": p.get("xProd"),
                "qty": float(p.get("qCom", 0) or 0),
                "unit": float(p.get("vUnCom", 0) or 0),
                "line_total": float(p.get("vProd", 0) or 0),
                "cfop": p.get("CFOP", "").replace(".", ""),
            })
        out["nfs"][nnf] = {
            "serie": ide.get("serie"), "dEmi": ide.get("dEmi"), "tpNF": ide.get("tpNF"),
            "dest_cnpj": dest.get("cnpj_cpf"), "dest_razao": dest.get("cRazao"),
            "vNF": float(nf.get("total", {}).get("ICMSTot", {}).get("vNF", 0) or 0),
            "cancelled": bool((ide.get("dCan") or "").strip()) or ide.get("cDeneg") == "S"
                         or bool((ide.get("dInut") or "").strip()),
            "items": items,
        }
        print(f"  NF {nnf} serie {ide.get('serie')} dest={dest.get('cRazao')} "
              f"vNF=R${out['nfs'][nnf]['vNF']:,.2f} items={len(items)}", flush=True)

    # 2) Resolve B4A client code(s) in SHOPS JARDINS, then receivables matching NF refs
    print("\n=== ListarClientes B4A (SHOPS JARDINS) ===", flush=True)
    cl = call(CLIENTES_URL, ak, as_, "ListarClientes",
              {"pagina": 1, "registros_por_pagina": 100, "apenas_importado_api": "N",
               "clientesFiltro": {"razao_social": "B4A"}})
    codes = []
    for r in (cl.get("clientes_cadastro", []) or cl.get("clientes_cadastro_resumido", [])):
        if dig(r.get("cnpj_cpf")).startswith(B4A_ROOT):
            codes.append((int(r.get("codigo_cliente_omie") or r.get("codigo_cliente")), r.get("cnpj_cpf")))
    print(f"  B4A client codes: {codes}", flush=True)

    print("\n=== ListarContasReceber for B4A, matching NF 2701/2702 ===", flush=True)
    for code, cnpj in codes:
        page = 1
        while True:
            cr = call(CR_URL, ak, as_, "ListarContasReceber",
                      {"pagina": page, "registros_por_pagina": 200, "filtrar_cliente": code})
            if "_error" in cr:
                print(f"  code={code} ERROR {cr['_error'][:120]}"); break
            for t in cr.get("conta_receber_cadastro") or []:
                n = nf_int(t.get("numero_documento_fiscal"))
                if n not in TARGET_NFS:
                    continue
                ndf = str(n)
                out["receivables"][ndf].append({
                    "lancamento": t.get("codigo_lancamento_omie"),
                    "parcela": t.get("numero_parcela"),
                    "valor": float(t.get("valor_documento", 0) or 0),
                    "data_emissao": t.get("data_emissao"),
                    "data_vencimento": t.get("data_vencimento"),
                    "data_previsao": t.get("data_previsao"),
                    "status": t.get("status_titulo"),
                    "obs": t.get("observacao") or "",
                    "numero_documento": t.get("numero_documento"),
                })
            if page >= (cr.get("total_de_paginas") or 1):
                break
            page += 1

    for ndf in sorted(str(n) for n in TARGET_NFS):
        for t in sorted(out["receivables"].get(ndf, []), key=lambda x: x.get("parcela") or ""):
            print(f"  NF {ndf} parc {t['parcela']} venc {t['data_vencimento']} "
                  f"R${t['valor']:,.2f} [{t['status']}]", flush=True)

    out["receivables"] = dict(out["receivables"])
    out_path = Path(__file__).resolve().parent / "_b4a_nf_2701_2702.out.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nraw -> {out_path}", flush=True)


if __name__ == "__main__":
    main()
