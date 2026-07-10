"""
Find genuine UNPOSTED product receipts (etapa=40, modelo=55, not cancelled,
recebido=N) on EXTREMA and check whether any contains Primer Cachos.
Cross-references the supplier ids that shipped Primer Cachos before.
Read-only.
"""
import json, time, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
REC_URL = "https://app.omie.com.br/api/v1/produtos/recebimentonfe/"
# supplier ids seen on already-received Primer Cachos recebimentos
CACHOS_SUPPLIERS = {11210397539, 11391911679, 11263032643, 11406691124}


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


def call(ak, as_, method, param, retries=6):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(0.8)
        try:
            req = urllib.request.Request(REC_URL, data=body, headers={"Content-Type": "application/json"})
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


def main():
    c = {x["label"].upper(): x for x in load_connections(ENV_PATH)}["EXTREMA"]
    ak, as_ = c["app_key"], c["app_secret"]

    page, tp = 1, None
    by_modelo_cancel = defaultdict(int)
    pending_prod = []   # etapa40, modelo55, not cancelled, recebido=N
    while True:
        r = call(ak, as_, "ListarRecebimentos", {"nPagina": page, "nRegistrosPorPagina": 50})
        if "_error" in r:
            print("ERROR", r["_error"][:200]); break
        if tp is None:
            tp = r.get("nTotalPaginas") or 1
            print(f"{r.get('nTotalRegistros')} recebimentos / {tp} pages")
        for rec in r.get("recebimentos") or []:
            cab = rec.get("cabec", {}); info = rec.get("infoCadastro", {})
            if cab.get("cEtapa") != "40":
                continue
            modelo = cab.get("cModeloNFe"); canc = info.get("cCancelada")
            by_modelo_cancel[(modelo, f"canc={canc}", f"receb={info.get('cRecebido')}")] += 1
            if modelo == "55" and canc == "N" and info.get("cRecebido") == "N":
                pending_prod.append({
                    "nIdReceb": cab.get("nIdReceb"), "chave": cab.get("cChaveNFe"),
                    "num": cab.get("cNumeroNFe"), "serie": cab.get("cSerieNFe"),
                    "dEmissao": cab.get("dEmissaoNFe"), "forn": cab.get("nIdFornecedor"),
                    "nome": cab.get("cNome"), "valor": cab.get("nValorNFe"),
                    "natOp": cab.get("cNaturezaOperacao")})
        if page >= (tp or 1):
            break
        page += 1

    print("\n=== etapa=40 breakdown (modelo, cancelada, recebido) ===")
    for k, n in sorted(by_modelo_cancel.items(), key=lambda x: -x[1]):
        print(f"  {n:>4}x  {k}")

    print(f"\n=== GENUINE unposted product receipts (etapa40 / modelo55 / not cancelled / recebido=N): {len(pending_prod)} ===")
    for p in sorted(pending_prod, key=lambda x: (x['dEmissao'] or '').split('/')[::-1]):
        tag = "  <<< CACHOS SUPPLIER" if p["forn"] in CACHOS_SUPPLIERS else ""
        print(f"  NF {p['num']}/{p['serie']} emis={p['dEmissao']} forn={p['forn']} {p['nome']!r} "
              f"R${p['valor']} natOp={p['natOp']!r} chave={p['chave']} nIdReceb={p['nIdReceb']}{tag}")

    # consult items for the cachos-supplier pending ones (bounded)
    suspects = [p for p in pending_prod if p["forn"] in CACHOS_SUPPLIERS]
    print(f"\n=== item check on {len(suspects)} pending receipt(s) from Primer Cachos suppliers ===")
    for p in suspects[:30]:
        det = call(ak, as_, "ConsultarRecebimento", {"nIdReceb": p["nIdReceb"]})
        items = det.get("itensRecebimento") or []
        names = []
        for it in items:
            txt = json.dumps(it, ensure_ascii=False)
            names.append(txt)
        joined = " | ".join(names).upper()
        is_cachos = "CACHOS" in joined or "GEB 101" in joined or "GEB101" in joined
        print(f"  nIdReceb={p['nIdReceb']} NF {p['num']} items={len(items)} cachos={is_cachos}")
        if is_cachos:
            print("     ITEMS:", joined[:600])


if __name__ == "__main__":
    main()
