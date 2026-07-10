"""
Diagnose the negative GEB 101 (Primer Cachos) position on CD EXTREMA:
 1. resolve nCodProd via ListarPosEstoque
 2. ListarMovimentoEstoque -> entrada/saida movements + running saldo
 3. ListarRecebimentos -> incoming NF-e still PENDING (cRecebido/cFaturado/cEtapa),
    flag any whose items mention Primer Cachos
Read-only against the EXTREMA Omie account (_000506).
"""
import json, sys, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
STK_URL = "https://app.omie.com.br/api/v1/estoque/consulta/"
REC_URL = "https://app.omie.com.br/api/v1/produtos/recebimentonfe/"
D_LO, D_HI = "01/01/2026", "25/06/2026"


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


def call(url, ak, as_, method, param, retries=6):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(0.8)
        try:
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt}
            if any(m in txt.lower() for m in ("requisi", "consumo", "redundante", "bloqueada")):
                time.sleep(8.0 * (attempt + 1)); continue
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e)}; time.sleep(5.0 * (attempt + 1))
    return last or {"_error": "exhausted"}


def norm(s): return "".join(str(s or "").split()).upper()


def main():
    c = {x["label"].upper(): x for x in load_connections(ENV_PATH)}["EXTREMA"]
    ak, as_ = c["app_key"], c["app_secret"]

    # 1) nCodProd for GEB 101
    ncod, page, total = None, 1, None
    while True:
        r = call(STK_URL, ak, as_, "ListarPosEstoque",
                 {"nPagina": page, "nRegPorPagina": 50, "dDataPosicao": D_HI, "cExibeTodos": "S"})
        if "_error" in r:
            print("ListarPosEstoque ERROR", r["_error"][:160]); break
        if total is None:
            total = r.get("nTotPaginas") or 1
        for p in r.get("produtos") or []:
            if norm(p.get("cCodigo")) == "GEB101" and "PRIMER CACHOS DEFINIDOS GE" in (p.get("cDescricao") or "").upper():
                ncod = p.get("nCodProd")
                print(f"GEB 101 -> nCodProd={ncod} fisico={p.get('fisico')} saldo={p.get('nSaldo')}")
        if ncod or page >= (total or 1):
            break
        page += 1

    # 2) stock movements for GEB 101
    if ncod:
        print(f"\n==== MOVIMENTO ESTOQUE GEB 101 ({D_LO}..{D_HI}) ====")
        page, tp, ent, sai, rows = 1, None, 0.0, 0.0, []
        while True:
            r = call(STK_URL, ak, as_, "ListarMovimentoEstoque",
                     {"nPagina": page, "nRegPorPagina": 100, "idProd": ncod,
                      "dDtInicial": D_LO, "dDtFinal": D_HI, "lista_local_estoque": "TODOS"})
            if "_error" in r:
                print("  ERROR", r["_error"][:200]); break
            if tp is None:
                tp = r.get("nTotalPaginas") or r.get("nTotPaginas") or 1
            mv = r.get("movProdutoListarArray") or r.get("movimentos") or []
            for m in mv:
                rows.append(m)
                q = float(m.get("qtde") or 0)
                if "entrada" in (m.get("tipo") or "").lower(): ent += q
                else: sai += q
            if page >= (tp or 1):
                break
            page += 1
        for m in rows:
            print(f"  {m.get('dtMov')} {(m.get('tipo') or ''):8} qtde={m.get('qtde')} "
                  f"doc={m.get('numDoc')} op={m.get('operacao')} saldo={m.get('saldo')}")
        print(f"  --- totals: entrada={ent} saida={sai} net={ent - sai} (movements={len(rows)})")

    # 3) recebimento queue — pending incoming NF-e mentioning Primer Cachos
    print(f"\n==== RECEBIMENTOS (incoming NF-e queue) — scanning for Primer Cachos + pending ====")
    page, tp, etapas, cachos = 1, None, {}, []
    capped = False
    while True:
        r = call(REC_URL, ak, as_, "ListarRecebimentos",
                 {"nPagina": page, "nRegistrosPorPagina": 50, "cExibirDetalhes": "S"})
        if "_error" in r:
            print("  ListarRecebimentos ERROR", r["_error"][:200]); break
        if tp is None:
            tp = r.get("nTotalPaginas") or 1
            print(f"  {r.get('nTotalRegistros')} recebimentos / {tp} pages")
        for rec in r.get("recebimentos") or []:
            cab = rec.get("cabec", {}); info = rec.get("infoCadastro", {})
            et = cab.get("cEtapa")
            key = f"etapa={et} receb={info.get('cRecebido')} fat={info.get('cFaturado')}"
            etapas[key] = etapas.get(key, 0) + 1
            blob = json.dumps(rec, ensure_ascii=False).upper()
            if "CACHOS" in blob or "GEB 101" in blob or "GEB101" in blob:
                cachos.append({"chave": cab.get("cChaveNfe"), "idForn": cab.get("nIdFornecedor"),
                               "etapa": et, "recebido": info.get("cRecebido"),
                               "faturado": info.get("cFaturado"), "devolvido": info.get("cDevolvido"),
                               "nIdReceb": cab.get("nIdReceb") or rec.get("nIdReceb")})
        if page >= (tp or 1):
            if page < (tp or 1):
                capped = True
            break
        if page >= 60:
            capped = True; print("  [capped at 60 pages]"); break
        page += 1

    print("\n  --- etapa/recebido/faturado distribution ---")
    for k, n in sorted(etapas.items(), key=lambda x: -x[1]):
        print(f"    {n:>5}x  {k}")
    print(f"\n  --- recebimentos mentioning Primer Cachos: {len(cachos)} ---")
    for x in cachos:
        print("   ", json.dumps(x, ensure_ascii=False))
    if capped:
        print("  (NOTE: recebimento scan was capped — not all pages read)")


if __name__ == "__main__":
    main()
