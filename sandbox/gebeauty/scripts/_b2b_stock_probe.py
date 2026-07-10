"""
Probe Omie stock API — find correct endpoint + field names for GEB SKUs.
Tests against EXTREMA (CD) and one POS company.

Run:
  C:/Python314/python.exe sandbox/gebeauty/scripts/_b2b_stock_probe.py
"""
import json, time, sys, urllib.request, urllib.error
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT     = Path(__file__).resolve().parent
ENV_PATH = ROOT.parent / ".env"

_RETRY = ("requisi", "consumo", "soap-env:server", "redundante", "number of requests",
          "limite de req")

def load_connections(path):
    conns, label, pending = [], None, {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("##"):
            if label and pending.get("app_key") and pending.get("app_secret"):
                conns.append({"label": label, **pending})
            label, pending = s.lstrip("#").strip(), {}
            continue
        if s.startswith("#") or "=" not in s:
            continue
        k, v = (x.strip() for x in s.split("=", 1))
        if "OMIE_APP_KEY" in k:    pending["app_key"]    = v
        if "OMIE_APP_SECRET" in k: pending["app_secret"] = v
    if label and pending.get("app_key") and pending.get("app_secret"):
        conns.append({"label": label, **pending})
    return conns

def call(url, ak, as_, method, param, retries=3):
    body = json.dumps({"app_key": ak, "app_secret": as_,
                       "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(1.2)
        try:
            req = urllib.request.Request(
                url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt}
            if any(m in txt.lower() for m in _RETRY):
                time.sleep(10 * (attempt + 1)); continue
            return last
        except Exception as e:
            last = {"_error": str(e)}
    return last or {"_error": "exhausted"}


PROD_URL  = "https://app.omie.com.br/api/v1/geral/produtos/"
ESTQ_URL  = "https://app.omie.com.br/api/v1/estoque/consultar/"

def probe(label, ak, as_):
    print(f"\n{'='*60}")
    print(f"Company: {label}")
    print(f"{'='*60}")

    # ── 1. ListarProdutos (first page, look at schema + GEB items) ──────
    print("\n[1] ListarProdutos — first page")
    res = call(PROD_URL, ak, as_, "ListarProdutos",
               {"pagina": 1, "registros_por_pagina": 5,
                "apenas_importado_api": "N",
                "filtrar_apenas_omiepdv": "N"})
    if "_error" in res:
        print(f"  ERROR: {res['_error'][:200]}")
    else:
        items = res.get("produto_servico_cadastro") or []
        print(f"  total_de_registros: {res.get('total_de_registros')}")
        if items:
            sample = items[0]
            print(f"  Top-level keys: {list(sample.keys())}")
            det = sample.get("produto_servico_detalhe") or sample
            print(f"  produto_servico_detalhe keys: {list(det.keys())}")
            # Estoque sub-dict?
            for k in ["estoque", "qtd_em_estoque", "saldo", "pos_estoque"]:
                if k in sample: print(f"  .{k} = {sample[k]}")
                if k in det:    print(f"  detail.{k} = {det[k]}")

    # ── 2. ListarProdutos filtered by "GEB" ─────────────────────────────
    print("\n[2] ListarProdutos — filter codigo startswith GEB (first 5)")
    res2 = call(PROD_URL, ak, as_, "ListarProdutos",
                {"pagina": 1, "registros_por_pagina": 5,
                 "apenas_importado_api": "N",
                 "filtrar_apenas_omiepdv": "N",
                 "produtosPorCodigo": {"codigo": "GEB"}})
    if "_error" in res2:
        print(f"  filter by codigo: ERROR {res2['_error'][:150]}")
    else:
        items2 = res2.get("produto_servico_cadastro") or []
        print(f"  returned {len(items2)} items")
        for it in items2[:3]:
            det = it.get("produto_servico_detalhe") or it
            print(f"    codigo={det.get('codigo')}  descr={det.get('descricao','')[:40]}"
                  f"  estoque={it.get('estoque')} ")

    # ── 3. ConsultarEstoque (one known SKU) ──────────────────────────────
    print("\n[3] ConsultarEstoque(codigo='GEB008')")
    res3 = call(ESTQ_URL, ak, as_, "ConsultarEstoque",
                {"codigo": "GEB008"})
    if "_error" in res3:
        print(f"  ERROR: {res3['_error'][:200]}")
    else:
        print(f"  keys: {list(res3.keys())}")
        print(f"  response: {json.dumps(res3, ensure_ascii=False)[:400]}")

    # ── 4. Try ConsultarEstoque with codigo_produto ──────────────────────
    print("\n[4] ConsultarEstoque(codigo_produto_integracao='GEB008')")
    res4 = call(ESTQ_URL, ak, as_, "ConsultarEstoque",
                {"codigo_produto_integracao": "GEB008"})
    if "_error" in res4:
        print(f"  ERROR: {res4['_error'][:200]}")
    else:
        print(f"  keys: {list(res4.keys())}")
        print(f"  response: {json.dumps(res4, ensure_ascii=False)[:400]}")

    # ── 5. ListarEstoque ─────────────────────────────────────────────────
    print("\n[5] ListarEstoque (at PROD_URL)")
    res5 = call(PROD_URL, ak, as_, "ListarEstoque",
                {"pagina": 1, "registros_por_pagina": 5})
    if "_error" in res5:
        print(f"  ERROR: {res5['_error'][:200]}")
    else:
        print(f"  keys: {list(res5.keys())}")
        items5 = res5.get("produto_estoque") or res5.get("lista_estoque") or []
        if items5:
            print(f"  sample item keys: {list(items5[0].keys())}")
        print(f"  response[:400]: {json.dumps(res5, ensure_ascii=False)[:400]}")


def main():
    conns = load_connections(ENV_PATH)

    # Probe EXTREMA (CD) and first POS
    targets = []
    for c in conns:
        lbl = c["label"].upper()
        if "EXTREMA" in lbl:
            targets.append(("EXTREMA (CD)", c))
        elif "SHOPPING RECIFE" in lbl and not any(t[0].startswith("POS") for t in targets):
            targets.append(("SHOPPING RECIFE (POS sample)", c))

    if not targets:
        print("No target companies found — check .env labels")
        return

    for name, conn in targets:
        probe(name, conn["app_key"], conn["app_secret"])


if __name__ == "__main__":
    main()
