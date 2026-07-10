"""Collect the 3 modelo-55 etapa=40 recebimentos on EXTREMA and consult each
for true status (cCancelada/cRecebido) + line items (Primer Cachos?)."""
import json, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
REC_URL = "https://app.omie.com.br/api/v1/produtos/recebimentonfe/"


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

    page, tp, m55 = 1, None, []
    while True:
        r = call(ak, as_, "ListarRecebimentos", {"nPagina": page, "nRegistrosPorPagina": 50})
        if "_error" in r:
            print("ERROR", r["_error"][:200]); break
        if tp is None:
            tp = r.get("nTotalPaginas") or 1
        for rec in r.get("recebimentos") or []:
            cab = rec.get("cabec", {})
            if cab.get("cEtapa") == "40" and cab.get("cModeloNFe") == "55":
                m55.append(cab)
        if page >= (tp or 1):
            break
        page += 1

    print(f"modelo-55 etapa=40 recebimentos: {len(m55)}\n")
    for cab in m55:
        nid = cab.get("nIdReceb")
        print(f"=== NF {cab.get('cNumeroNFe')}/{cab.get('cSerieNFe')} emis={cab.get('dEmissaoNFe')} "
              f"forn={cab.get('nIdFornecedor')} {cab.get('cNome')!r} R${cab.get('nValorNFe')} "
              f"chave={cab.get('cChaveNFe')} natOp={cab.get('cNaturezaOperacao')!r} nIdReceb={nid}")
        det = call(ak, as_, "ConsultarRecebimento", {"nIdReceb": nid})
        info = det.get("infoCadastro", {})
        print(f"    status: cCancelada={info.get('cCancelada')} cRecebido={info.get('cRecebido')} "
              f"cFaturado={info.get('cFaturado')} cBloqueado={info.get('cBloqueado')} dInc={info.get('dInc')}")
        items = det.get("itensRecebimento") or []
        blob = json.dumps(items, ensure_ascii=False).upper()
        cachos = "CACHOS" in blob or "GEB 101" in blob or "GEB101" in blob
        print(f"    itens={len(items)} CONTAINS_CACHOS={cachos}")
        for it in items:
            print("      -", json.dumps(it, ensure_ascii=False)[:300])


if __name__ == "__main__":
    main()
