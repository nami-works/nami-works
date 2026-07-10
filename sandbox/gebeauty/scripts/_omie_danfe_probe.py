"""
Probe Omie DANFE/XML retrieval endpoints for RECEIVED (entrada) notes.
Calls candidate (endpoint, method) pairs with empty param so Omie's fault
reveals whether the method exists and which params are required.
Read-only discovery; writes nothing.
"""
import json, sys, time, urllib.request, urllib.error
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
    url = BASE + endpoint
    try:
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
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

    # NATURELLE most-recent note ids
    ids = {"nIdNF": 5257594773, "nIdReceb": 5257487716,
           "cChaveNFe": "35260648561369000108550000000512601000886830"}

    candidates = [
        ("produtos/dfedocs/", "ObterDocumentos"),
        ("produtos/dfedocs/", "ListarDocumentos"),
        ("produtos/dfedocs/", "ObterDocumento"),
        ("produtos/notafiscalutil/", "ObterNFAnexo"),
        ("produtos/notafiscalutil/", "ObterAnexo"),
        ("produtos/notafiscalutil/", "ObterURLNFe"),
    ]

    for ep, method in candidates:
        time.sleep(1.2)
        status, resp = call(ep, ak, as_, method, {})  # empty param -> reveal required fields
        snippet = resp if isinstance(resp, str) else json.dumps(resp, ensure_ascii=False)
        print(f"\n### {ep}{method}  [{status}]")
        print(snippet[:600], flush=True)


if __name__ == "__main__":
    main()
