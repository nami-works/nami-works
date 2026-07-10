"""Dump structure of a pending (etapa=40) recebimento vs a Primer-Cachos
recebimento on EXTREMA, to learn if pending entries expose line items + chave."""
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


def main():
    c = {x["label"].upper(): x for x in load_connections(ENV_PATH)}["EXTREMA"]
    ak, as_ = c["app_key"], c["app_secret"]

    r = call(REC_URL, ak, as_, "ListarRecebimentos",
             {"nPagina": 1, "nRegistrosPorPagina": 50, "cExibirDetalhes": "S"})
    recs = r.get("recebimentos") or []
    pend = next((x for x in recs if (x.get("cabec", {}).get("cEtapa") == "40")), None)
    print("===== sample PENDING (etapa=40) recebimento, full JSON =====")
    print(json.dumps(pend, ensure_ascii=False, indent=1)[:2500] if pend else "none on page1")

    # consult it to see if items come back via ConsultarRecebimento
    if pend:
        cab = pend.get("cabec", {})
        nid = cab.get("nIdReceb") or pend.get("nIdReceb")
        print(f"\n===== ConsultarRecebimento nIdReceb={nid} (item expansion?) =====")
        det = call(REC_URL, ak, as_, "ConsultarRecebimento", {"nIdReceb": nid})
        print(json.dumps(det, ensure_ascii=False, indent=1)[:2500])


if __name__ == "__main__":
    main()
