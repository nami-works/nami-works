"""
Read-only: pull the current Body & Hair Mist product codes from Omie's catalog.

Context: the mist codes reportedly changed after an issue with a supplier NF.
This walks the Omie product catalog (geral/produtos/ListarProdutos) per account,
filters to mist-like products (NCM 3307.20.10 or perfume/mist keywords), and
prints every code/EAN/descricao it finds so we can compare against products.json.

Accounts to scan are passed as argv labels (default: MATRIZ). Use --all for all 6.
Writes nothing.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
PROD_URL = "https://app.omie.com.br/api/v1/geral/produtos/"

# mist baseline currently in products.json (sku -> ean), for side-by-side compare
BASELINE = {
    "GEB 024": ("Melon Mood 200ml", "0042882635451"),
    "GEB 025": ("Rose Ritual 200ml", "0631911748226"),
    "GEB 026": ("Pear Fresh 200ml", "0631911748219"),
    "GEB 027": ("Santal Skin 200ml", "0631911748233"),
    "GEB 029": ("Melon Mood Mini", "0631911620805"),
}

MIST_NCMS = {"33072010", "3307.20.10"}
KEYWORDS = ("MIST", "SPLASH", "BRUMA", "MELON", "ROSE", "PEAR", "SANTAL", "MOOD", "RITUAL", "FRESH", "SKIN")


def load_accounts(path):
    """Walk ## labels, pairing the next KEY/SECRET. Var names collide across
    stores (5 share _000174) so a flat dict drops all but the last — must walk."""
    accounts = []  # list of (label, key, secret)
    label = None
    key = secret = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("##"):
            label = line.lstrip("#").strip()
            key = secret = None
        elif line.startswith("OMIE_APP_KEY"):
            key = line.split("=", 1)[1].strip()
        elif line.startswith("OMIE_APP_SECRET"):
            secret = line.split("=", 1)[1].strip()
        if label and key and secret:
            accounts.append((label, key, secret))
            key = secret = None
    return accounts


def omie_call(key, secret, method, param, attempt=0):
    body = json.dumps({
        "app_key": key, "app_secret": secret, "call": method, "param": [param],
    }).encode("utf-8")
    req = urllib.request.Request(PROD_URL, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", errors="replace")
        if "Já existe uma requisição" in txt and attempt < 4:
            print(f"    [throttle] waiting 12s (attempt {attempt+1})", file=sys.stderr)
            time.sleep(12)
            return omie_call(key, secret, method, param, attempt + 1)
        print(f"  [omie] {method} HTTP {e.code}: {txt[:300]}", file=sys.stderr)
        return None
    except (urllib.error.URLError, OSError) as e:
        if attempt < 4:
            print(f"    [conn] {e} -> retry in 12s", file=sys.stderr)
            time.sleep(12)
            return omie_call(key, secret, method, param, attempt + 1)
        print(f"  [omie] {method} connection failed: {e}", file=sys.stderr)
        return None


def is_mist(p):
    ncm = (p.get("ncm") or "").replace(".", "")
    if ncm in {n.replace(".", "") for n in MIST_NCMS}:
        return True
    desc = (p.get("descricao") or "").upper()
    return any(k in desc for k in KEYWORDS)


def scan_account(label, key, secret):
    print(f"\n=== {label} : geral/produtos/ListarProdutos ===")
    hits = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        resp = omie_call(key, secret, "ListarProdutos", {
            "pagina": page,
            "registros_por_pagina": 50,
            "apenas_importado_api": "N",
            "filtrar_apenas_omiepdv": "N",
        })
        if not resp:
            break
        total_pages = resp.get("total_de_paginas", 1)
        prods = resp.get("produto_servico_cadastro", []) or []
        for p in prods:
            if is_mist(p):
                hits.append(p)
        print(f"  page {page}/{total_pages} scanned ({len(prods)} rows, {len(hits)} mist hits so far)")
        page += 1
        time.sleep(2)
    return hits


def main():
    accounts = load_accounts(ENV_PATH)
    print(f"[env] loaded {len(accounts)} accounts: {[a[0] for a in accounts]}")

    args = [a for a in sys.argv[1:]]
    if "--all" in args:
        targets = accounts
    elif args:
        wanted = {a.upper() for a in args}
        targets = [a for a in accounts if a[0].upper() in wanted]
    else:
        targets = [a for a in accounts if a[0] == "MATRIZ"]

    print(f"[scan] targeting: {[t[0] for t in targets]}")

    all_hits = []
    for label, key, secret in targets:
        for p in scan_account(label, key, secret):
            all_hits.append((label, p))

    print("\n" + "=" * 96)
    print("MIST-LIKE PRODUCTS FOUND IN OMIE CATALOG")
    print("=" * 96)
    hdr = f"{'acct':<14} {'codigo (SKU)':<18} {'EAN (cod_barras)':<18} {'NCM':<12} {'inat':<4} descricao"
    print(hdr)
    print("-" * 96)
    for label, p in sorted(all_hits, key=lambda x: (x[0], str(p_codigo := x[1].get('codigo') or ''))):
        print(f"{label:<14} {str(p.get('codigo') or '-'):<18} {str(p.get('codigo_barras') or p.get('ean') or '-'):<18} {str(p.get('ncm') or '-'):<12} {str(p.get('inativo') or '-'):<4} {p.get('descricao') or ''}")

    print("\n" + "=" * 60)
    print("products.json BASELINE (what we have today)")
    print("=" * 60)
    for sku, (name, ean) in BASELINE.items():
        print(f"  {sku:<10} {ean:<18} {name}")


if __name__ == "__main__":
    main()
