"""
Resolve razao_social for B2B CNPJs from omie_b2b_customers.out.json
using BrasilAPI (public, no auth).
"""
import json, urllib.request, time, sys
from pathlib import Path

load_dotenv_path = Path(__file__).resolve().parent.parent / ".env"
try:
    from dotenv import load_dotenv
    load_dotenv(load_dotenv_path)
except ImportError:
    pass

DATA_PATH = Path(__file__).resolve().parent / "omie_b2b_customers.out.json"
data = json.loads(DATA_PATH.read_text(encoding="utf-8"))

# Drop GE Beauty's own CNPJ root — internal transfers only
external = [r for r in data if r["cnpj_root"] != "34987157"]
print(f"Resolving {len(external)} external B2B customers...\n")

def lookup_cnpj(cnpj_digits):
    url = f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_digits}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=12) as resp:
        return json.loads(resp.read().decode())

print(f"  {'CNPJ ROOT':12} {'RAZAO SOCIAL':50} {'FANTASIA':30} {'NFs':>5} {'UNITS':>8} {'R$':>14}  LAST NF")
print(f"  {'-'*12} {'-'*50} {'-'*30} {'-'*5} {'-'*8} {'-'*14}  {'-'*10}")

enriched = []
for r in external:
    root = r["cnpj_root"]
    full_cnpjs = sorted(r.get("cnpj_full") or [])
    # Try all known full CNPJs until one resolves
    info = None
    tried = full_cnpjs if full_cnpjs else [root + "000174"]
    for cnpj in tried[:3]:
        try:
            info = lookup_cnpj(cnpj)
            break
        except Exception:
            time.sleep(1.0)
            continue

    razao    = (info.get("razao_social") or "?")[:50] if info else "LOOKUP_FAILED"
    fantasia = (info.get("nome_fantasia") or "")[:30] if info else ""

    print(f"  {root:12} {razao:50} {fantasia:30} {r['nfs']:>5} {r['units']:>8,.0f} R${r['value']:>12,.0f}  {r['last_nf'] or '?'}")

    enriched.append({**r, "razao_social": razao, "nome_fantasia": fantasia})
    time.sleep(0.5)

# Save enriched JSON
out_path = DATA_PATH.with_name("omie_b2b_customers_named.out.json")
out_path.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\nSaved -> {out_path}")
