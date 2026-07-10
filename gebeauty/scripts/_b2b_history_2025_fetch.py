"""
Fetch 2025 B2B Box NFs from Omie for UAU Box, B4A, and Magenta.
Searches all configured Omie companies, de-duplicates against history.json,
then appends new completed deals.

Run:
  C:/Python314/python.exe sandbox/gebeauty/scripts/_b2b_history_2025_fetch.py
"""
import json, time, sys, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")

ROOT         = Path(__file__).resolve().parent
ENV_PATH     = ROOT.parent / ".env"
HISTORY_PATH = ROOT / "deals" / "history.json"

NF_URL  = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
CLI_URL = "https://app.omie.com.br/api/v1/geral/clientes/"
CR_URL  = "https://app.omie.com.br/api/v1/financas/contareceber/"

_RETRY = ("requisi", "consumo", "soap-env:server", "redundante", "number of requests",
          "limite de req")

# Operators to search for — partial name tokens (case-insensitive)
TARGETS = {
    "UAU Box":  ["UAU", "UAUBOX"],
    "B4A":      ["B4A"],
    "Magenta":  ["MAGENTA"],
}

# Default monthly rate used across Box deals
DEFAULT_RATE = 0.013


# ── Omie helpers ───────────────────────────────────────────────────────────────

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


def call(url, ak, as_, method, param, retries=5):
    body = json.dumps({"app_key": ak, "app_secret": as_,
                       "call": method, "param": [param]}).encode()
    last = None
    for attempt in range(retries):
        time.sleep(1.2)
        try:
            req = urllib.request.Request(
                url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace"); last = {"_error": txt}
            if any(m in txt.lower() for m in _RETRY):
                time.sleep(12.0 * (attempt + 1)); continue
            return last
        except (urllib.error.URLError, OSError) as e:
            last = {"_error": str(e)}
            time.sleep(6.0 * (attempt + 1))
    return last or {"_error": "exhausted"}


# ── SKU normalisation ──────────────────────────────────────────────────────────

def norm_sku(s):
    return (s or "").upper().replace(" ", "").replace("-", "")


def canonical_sku(raw):
    """'GEB013' or 'GEB 013' → 'GEB 013' (history.json canonical form)."""
    n = norm_sku(raw)
    if n.startswith("GEB") and len(n) > 3:
        code = n[3:]
        try:
            int(code)
            return f"GEB {code}"
        except ValueError:
            pass
    return raw


def is_geb_sku(raw):
    return norm_sku(raw).startswith("GEB")


# ── Client search ──────────────────────────────────────────────────────────────

def find_clients(ak, as_, tokens):
    """Return list of {code, cnpj, razao} for clients whose name contains any token."""
    matched = []
    for token in tokens:
        res = call(CLI_URL, ak, as_, "ListarClientes",
                   {"pagina": 1, "registros_por_pagina": 100,
                    "apenas_importado_api": "N",
                    "clientesFiltro": {"razao_social": token}})
        if "_error" in res:
            continue
        rows = res.get("clientes_cadastro") or res.get("clientes_cadastro_resumido") or []
        for r in rows:
            code = r.get("codigo_cliente_omie") or r.get("codigo_cliente")
            cnpj = r.get("cnpj_cpf", "")
            razao = r.get("razao_social", "")
            if code and not any(c["code"] == code for c in matched):
                matched.append({"code": int(code), "cnpj": cnpj, "razao": razao})
    return matched


# ── NF fetch (date range) ──────────────────────────────────────────────────────

def dig(s):
    return "".join(c for c in (s or "") if c.isdigit())


def fetch_nfs_by_date(ak, as_, year=2025):
    """Fetch all saída NFs issued in the given year for this company."""
    nfs = []
    page = 1
    while True:
        res = call(NF_URL, ak, as_, "ListarNF",
                   {"pagina": page, "registros_por_pagina": 50,
                    "apenas_importado_api": "N",
                    "dEmiInicial": f"01/01/{year}",
                    "dEmiFinal":   f"31/12/{year}"})
        if "_error" in res:
            # Some companies may not support date filter — try without
            if "dEmiInicial" in res.get("_error", ""):
                print(f"        [date filter unsupported, skipping]")
            else:
                print(f"        [err] ListarNF p{page}: {res['_error'][:100]}")
            break
        for nf in res.get("nfCadastro") or []:
            ide  = nf.get("ide", {})
            dest = nf.get("nfDestInt", {})
            if str(ide.get("tpNF", "")) != "1":
                continue
            cancelled = (
                bool((ide.get("dCan") or "").strip())
                or ide.get("cDeneg") == "S"
                or bool((ide.get("dInut") or "").strip())
            )
            if cancelled:
                continue
            items = []
            for d in nf.get("det") or []:
                p = d.get("prod", {})
                raw_sku = p.get("cProd", "")
                if not is_geb_sku(raw_sku):
                    continue
                items.append({
                    "sku":        canonical_sku(raw_sku),
                    "desc":       p.get("xProd", ""),
                    "qty":        float(p.get("qCom", 0) or 0),
                    "unit":       float(p.get("vUnCom", 0) or 0),
                    "line_total": float(p.get("vProd", 0) or 0),
                })
            if items:
                nfs.append({
                    "nf":         str(ide.get("nNF", "")).strip(),
                    "serie":      ide.get("serie", ""),
                    "date":       ide.get("dEmi", ""),
                    "dest_cnpj":  dig(dest.get("cnpj_cpf", "")),
                    "dest_razao": dest.get("cRazao", ""),
                    "vNF":        float(nf.get("total", {}).get("ICMSTot", {}).get("vNF", 0) or 0),
                    "items":      items,
                })
        total_pages = res.get("total_de_paginas") or 1
        if page >= total_pages:
            break
        page += 1
    return nfs


def fetch_payment_days(ak, as_, client_code, nf_num):
    """Try to get average payment days from contas-a-receber for a given NF."""
    nf_int = int("".join(c for c in nf_num if c.isdigit())) if nf_num else None
    if not nf_int:
        return None
    res = call(CR_URL, ak, as_, "ListarContasReceber",
               {"pagina": 1, "registros_por_pagina": 200,
                "filtrar_cliente": client_code})
    if "_error" in res:
        return None
    titles = [t for t in (res.get("conta_receber_cadastro") or [])
              if int("".join(c for c in (t.get("numero_documento_fiscal") or "") if c.isdigit()) or "0") == nf_int]
    if not titles:
        return None
    # Use first parcela emission and last due date to approximate total term
    from datetime import datetime
    def parse(d):
        try:    return datetime.strptime(d, "%d/%m/%Y")
        except: return None
    emit_dates = [parse(t.get("data_emissao","")) for t in titles]
    due_dates  = [parse(t.get("data_vencimento","")) for t in titles]
    emit_dates = [d for d in emit_dates if d]
    due_dates  = [d for d in due_dates if d]
    if not emit_dates or not due_dates:
        return None
    days = (max(due_dates) - min(emit_dates)).days
    return days


# ── Date conversion ───────────────────────────────────────────────────────────

def omie_date_to_iso(d):
    """'29/05/2026' → '2026-05-29'"""
    try:
        day, mon, yr = d.split("/")
        return f"{yr}-{mon}-{day}"
    except Exception:
        return d


# ── history.json helpers ───────────────────────────────────────────────────────

def load_history():
    if not HISTORY_PATH.exists():
        return []
    return json.loads(HISTORY_PATH.read_text(encoding="utf-8-sig")).get("deals", [])


def save_history(deals):
    raw = json.loads(HISTORY_PATH.read_text(encoding="utf-8-sig"))
    raw["deals"] = deals
    HISTORY_PATH.write_text(json.dumps(raw, ensure_ascii=False, indent=2),
                            encoding="utf-8")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("\n-- B2B 2025 NF Fetch --------------------------------------------------")
    conns   = load_connections(ENV_PATH)
    history = load_history()

    # Index existing NF numbers to skip duplicates
    existing_nfs = set()
    for d in history:
        for part in str(d.get("nf","")).split("/"):
            n = "".join(c for c in part if c.isdigit())
            if n: existing_nfs.add(n)
    print(f"  Existing history: {len(history)} deals, NFs already tracked: {sorted(existing_nfs)}\n")

    new_deals = []

    for conn in conns:
        label = conn["label"]
        ak, as_ = conn["app_key"], conn["app_secret"]
        print(f"  [{label}]")

        # Build CNPJ → (operator, client_code) map for this company
        cnpj_map = {}   # digits-only cnpj → {"operator": ..., "code": ..., "razao": ...}
        for operator, tokens in TARGETS.items():
            clients = find_clients(ak, as_, tokens)
            if not clients:
                continue
            for c in clients:
                key = dig(c["cnpj"])
                if key and key not in cnpj_map:
                    cnpj_map[key] = {"operator": operator, "code": c["code"], "razao": c["razao"]}
            print(f"    {operator}: {len(clients)} client(s) found — {[c['razao'][:40] for c in clients]}")

        if not cnpj_map:
            print(f"    no target clients found, skipping\n")
            continue

        # Fetch all 2025 GEB NFs for this company in one pass, then filter by CNPJ
        print(f"    Fetching all 2025 NFs from {label}...")
        all_nfs = fetch_nfs_by_date(ak, as_, year=2025)
        target_nfs = [n for n in all_nfs if n["dest_cnpj"] in cnpj_map]
        print(f"    {len(all_nfs)} total GEB NFs, {len(target_nfs)} match target operators")

        for nf in target_nfs:
            nf_clean = "".join(c for c in nf["nf"] if c.isdigit())
            if nf_clean in existing_nfs:
                print(f"      NF {nf['nf']} already in history — skip")
                continue

            info     = cnpj_map[nf["dest_cnpj"]]
            operator = info["operator"]

            # Payment days (best-effort)
            pdays = fetch_payment_days(ak, as_, info["code"], nf["nf"])

            iso_date = omie_date_to_iso(nf["date"])
            deal_id  = f"{operator.lower().replace(' ','')}_{iso_date}_nf{nf_clean}"
            lines    = [
                {"sku": it["sku"], "volume": int(it["qty"]),
                 "price": it["unit"], "retail_at_time": None}
                for it in nf["items"]
            ]
            total_rev = sum(it["line_total"] for it in nf["items"])

            entry = {
                "id":           deal_id,
                "operator":     operator,
                "date":         iso_date,
                "status":       "completed",
                "nf":           nf["nf"],
                "payment_days": pdays,
                "monthly_rate": DEFAULT_RATE,
                "_note":        f"NF {nf['nf']} emitida {nf['date']} — {info['razao'][:40]} via {label}. vNF=R${nf['vNF']:,.0f}.",
                "lines":        lines,
            }
            new_deals.append(entry)
            existing_nfs.add(nf_clean)

            skus_str = " + ".join(f"{l['sku']} {int(l['volume']):,}un@R${l['price']:.2f}" for l in lines)
            print(f"      + NF {nf['nf']} ({iso_date})  R${total_rev:>10,.0f}  [{operator}]  {skus_str}")

        print()

    if not new_deals:
        print("  No new 2025 deals found.")
        return

    print(f"\n  Adding {len(new_deals)} new deal(s) to history.json...")
    all_deals = history + new_deals
    # Sort chronologically
    all_deals.sort(key=lambda d: d.get("date",""))
    save_history(all_deals)
    print("  Done. history.json updated.")
    print("\n  New entries:")
    for d in new_deals:
        print(f"    · {d['id']}")


if __name__ == "__main__":
    main()
