"""Wider brute-force of Omie method names for DANFE/XML of received notes."""
import json, time, urllib.request, urllib.error
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
BASE = "https://app.omie.com.br/api/v1/"


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


def call(endpoint, ak, as_, method, param):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": method, "param": [param]}).encode()
    try:
        req = urllib.request.Request(BASE + endpoint, data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return ("OK", json.loads(r.read().decode()))
    except urllib.error.HTTPError as e:
        return (f"HTTP{e.code}", e.read().decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError) as e:
        return ("ERR", str(e))


def main():
    conns = {c["label"]: c for c in load_connections(ENV_PATH)}
    c = conns["SHOPS JARDINS"]
    ak, as_ = c["app_key"], c["app_secret"]

    candidates = [
        ("produtos/dfedocs/", "ObterDFe"),
        ("produtos/dfedocs/", "ObterDFeDocumentos"),
        ("produtos/dfedocs/", "ObterDocumentosFiscais"),
        ("produtos/dfedocs/", "ConsultarDFe"),
        ("produtos/dfedocs/", "ObterArquivos"),
        ("produtos/dfedocs/", "ObterDanfe"),
        ("produtos/dfedocs/", "ObterXml"),
        ("produtos/dfedocs/", "ObterPdf"),
        ("produtos/notafiscalutil/", "ObterNotaFiscalUtil"),
        ("produtos/notafiscalutil/", "ObterDanfe"),
        ("produtos/notafiscalutil/", "ObterXMLNFe"),
        ("produtos/notafiscalutil/", "ObterArquivoNFe"),
        ("produtos/notafiscalutil/", "ObterURL"),
        ("produtos/danfe/", "ObterDanfe"),
        ("produtos/danfe/", "GerarDanfe"),
    ]

    for ep, method in candidates:
        time.sleep(0.9)
        status, resp = call(ep, ak, as_, method, {})
        snippet = resp if isinstance(resp, str) else json.dumps(resp, ensure_ascii=False)
        exists = "not exists" not in snippet and "não localiz" not in snippet.lower()
        flag = " <<< EXISTS" if exists else ""
        print(f"{ep}{method}  [{status}]{flag}\n   {snippet[:400]}", flush=True)


if __name__ == "__main__":
    main()
