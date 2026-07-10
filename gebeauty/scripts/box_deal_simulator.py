"""
Box Deal Simulator — GE Beauty
Simulates margin for subscription box / B2B deals.

Usage:
  # Show COGS coverage table
  python box_deal_simulator.py

  # Show historical discount ledger across all closed deals
  python box_deal_simulator.py --ledger

  # Single SKU
  python box_deal_simulator.py GEB003 15000 12.00
  python box_deal_simulator.py GEB003 15000 12.00 --payment-days 90 --monthly-rate 0.013

  # Multi-SKU deal from JSON (shows historical context per SKU)
  python box_deal_simulator.py --deal gebeauty/scripts/deals/b4a_ago_out_2026.json

Deal JSON format:
  {
    "name": "B4A Ago-Out/2026",
    "payment_days": 60,
    "monthly_rate": 0.013,
    "lines": [
      {"sku": "GEB003", "volume": 15000, "price": 12.00},
      {"sku": "GEB022", "volume": 20000, "price": 12.00}
    ]
  }

History (deals/history.json): append a completed deal entry after NF is issued.
"""

import sys, json, argparse
from pathlib import Path

# ---------------------------------------------------------------------------
# History helpers — reads deals/history.json (sibling of this script's dir)
# ---------------------------------------------------------------------------
HISTORY_PATH = Path(__file__).parent / "deals" / "history.json"


def load_history():
    if not HISTORY_PATH.exists():
        return []
    return json.loads(HISTORY_PATH.read_text(encoding="utf-8-sig")).get("deals", [])


def _norm_sku(sku):
    return sku.upper().replace(" ", "").replace("-", "")


def history_for_sku(sku, history):
    """Return list of dicts with historical deal lines for the given SKU."""
    key = _norm_sku(sku)
    entries = []
    for deal in history:
        for line in deal.get("lines", []):
            if _norm_sku(line["sku"]) == key:
                retail = line.get("retail_at_time", 0)
                disc = (retail - line["price"]) / retail * 100 if retail else None
                cogs_entry = COGS.get(key, {})
                cogs_es = cogs_entry.get("cogs_es")
                gm = (line["price"] - cogs_es) / line["price"] * 100 if cogs_es else None
                entries.append({
                    "operator": deal["operator"],
                    "date":     deal["date"][:7],
                    "status":   deal.get("status", "?"),
                    "volume":   line["volume"],
                    "price":    line["price"],
                    "retail":   retail,
                    "disc_pct": disc,
                    "gm_pct":   gm,
                })
    return entries

# ---------------------------------------------------------------------------
# COGS table — cost from supplier including IPI, basis = ES (lowest cost)
# Sources:
#   [U] = Orçamento UAUBOX.xlsx  (C:/Users/Lucas Guimarães/Desktop/temp/)
#   [B] = Estudo Magenta e B4A.xlsx  (Google Drive, 14/05/2026)
#   [N] = Naturelle quote email (08/04/2026)
# Retail = current Shopify selling price (from CLAUDE.md, Jun/2026)
# ---------------------------------------------------------------------------
COGS = {
    # SKU       name                                    cogs_es  cogs_sp  retail   source
    "GEB001": {"name": "Shampoo Sem Sulfato 250ml",     "cogs_es": 17.33, "cogs_sp": 18.52, "retail": 80.75,  "src": "U/N"},
    "GEB002": {"name": "Máscara Condicionadora 200ml",  "cogs_es": 10.64, "cogs_sp": 11.37, "retail": 80.75,  "src": "U"},
    "GEB003": {"name": "Leave-in Proteção Térmica 150ml","cogs_es": 8.35, "cogs_sp":  8.72, "retail": 84.15,  "src": "B/N"},
    "GEB008": {"name": "Shampoo a Seco 150ml",           "cogs_es": 12.14,"cogs_sp": 12.14, "retail": 58.65,  "src": "B"},
    "GEB010": {"name": "Máscara Condicionadora 50ml",   "cogs_es":  5.11, "cogs_sp":  5.81, "retail": 40.00,  "src": "B"},
    "GEB013": {"name": "Shampoo Sem Sulfato 60ml",       "cogs_es":  6.49, "cogs_sp":  6.85, "retail": 40.00,  "src": "B"},
    "GEB022": {"name": "Booster Antifrizz 15ml",         "cogs_es":  9.24, "cogs_sp":  9.86, "retail": 67.15,  "src": "B"},
    "GEB029": {"name": "Melon Mood Mini 100ml",          "cogs_es": 16.70, "cogs_sp": 17.20, "retail": 79.00,  "src": "U"},
    "GEB101": {"name": "Primer Cachos Definidos 250ml",  "cogs_es": 15.73, "cogs_sp": 16.01, "retail": 126.65, "src": "U"},
    "GEB121": {"name": "Máscara Mayday 200g",            "cogs_es": 29.88, "cogs_sp": 30.38, "retail": 139.00, "src": "U"},
    # COGS unknown — retail price only:
    "GEB019": {"name": "Booster Fortificante 15ml",     "cogs_es": None,  "cogs_sp": None,  "retail": 63.75,  "src": "?"},
    "GEB020": {"name": "Booster Hidratante 15ml",       "cogs_es": None,  "cogs_sp": None,  "retail": 58.65,  "src": "?"},
    "GEB021": {"name": "Booster Definição 15ml",        "cogs_es": None,  "cogs_sp": None,  "retail": 58.65,  "src": "?"},
    "GEB023": {"name": "Booster Antioxidante 15ml",     "cogs_es": None,  "cogs_sp": None,  "retail": 63.75,  "src": "?"},
    "GEB024": {"name": "Melon Mood 200ml",              "cogs_es": 20.68, "cogs_sp": 21.18, "retail": 129.00, "src": "U"},
    "GEB102": {"name": "Primer Liso Intacto 250ml",     "cogs_es": None,  "cogs_sp": None,  "retail": 118.15, "src": "?"},
    "GEB120": {"name": "Leave-in Pluma 200ml",          "cogs_es": None,  "cogs_sp": None,  "retail": 126.65, "src": "?"},
}

import os
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

W = 76
SEP = "-" * W


def brl(v):
    return f"R$ {v:>10,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(v):
    return f"{v:>6.1f}%"


def simulate_line(sku, volume, price, cogs_basis="es"):
    key = sku.upper().replace(" ", "").replace("-", "")
    p = COGS.get(key)
    if not p:
        return None, f"SKU {sku} não encontrado. Disponíveis: {', '.join(COGS)}"
    cogs = p[f"cogs_{cogs_basis}"]
    if cogs is None:
        return None, f"COGS não disponível para {sku} (fonte: ?). Adicione ao COGS table."
    retail = p["retail"]
    revenue = price * volume
    cost    = cogs * volume
    gm_brl  = revenue - cost
    gm_pct  = gm_brl / revenue * 100
    disc    = (retail - price) / retail * 100
    break_even = cost / volume  # min price to break even
    return {
        "sku": key, "name": p["name"], "src": p["src"],
        "volume": volume, "price": price, "cogs": cogs, "retail": retail,
        "revenue": revenue, "cost": cost,
        "gm_brl": gm_brl, "gm_pct": gm_pct,
        "disc_vs_retail": disc, "break_even": break_even,
    }, None


def discount_receivable(face_value, payment_days, monthly_rate):
    months = payment_days / 30
    discount = face_value * monthly_rate * months
    return face_value - discount, discount


def print_deal(name, lines, payment_days=None, monthly_rate=None, basis="es", history=None):
    history = history or []
    print(f"\n{'=' * W}")
    print(f"  DEAL: {name}   [COGS: {'ES' if basis == 'es' else 'SP'}+IPI]")
    print(f"{'=' * W}")
    print(f"{'SKU':<8} {'Produto':<34} {'Vol':>7} {'Preço':>7} {'COGS':>7} "
          f"{'GM R$':>10} {'GM%':>6} {'Desc%':>6}")
    print(SEP)

    tot_rev = tot_cost = 0
    for r in lines:
        print(f"{r['sku']:<8} {r['name'][:34]:<34} {r['volume']:>7,} "
              f"{r['price']:>7.2f} {r['cogs']:>7.2f} "
              f"{r['gm_brl']:>10,.2f} {pct(r['gm_pct']):>6} {pct(r['disc_vs_retail']):>6}")
        hist_entries = history_for_sku(r['sku'], history)
        if hist_entries:
            parts = [f"{e['operator']} {e['date']} {e['disc_pct']:.1f}%" for e in hist_entries]
            discs = [e['disc_pct'] for e in hist_entries]
            lo, hi = min(discs), max(discs)
            cur = r['disc_vs_retail']
            if cur < lo:
                flag = f"+ melhor que hist. ({lo:.1f}%)"
            elif cur > hi:
                flag = f"! pior que hist. ({hi:.1f}%)"
            else:
                flag = f"~ dentro do range historico"
            print(f"  {'':8}  > hist: {' | '.join(parts)}  [{flag}]")
        tot_rev  += r["revenue"]
        tot_cost += r["cost"]

    tot_gm     = tot_rev - tot_cost
    tot_gm_pct = tot_gm / tot_rev * 100
    tot_vol    = sum(r["volume"] for r in lines)
    print(SEP)
    print(f"{'TOTAL':<8} {'':<34} {tot_vol:>7,} {'':>7} {'':>7} "
          f"{tot_gm:>10,.2f} {pct(tot_gm_pct):>6}")

    print(f"\n  Receita bruta:        {brl(tot_rev)}")
    print(f"  Custo total (COGS):   {brl(tot_cost)}")
    print(f"  Margem bruta:         {brl(tot_gm)}   {tot_gm_pct:.1f}%")

    if payment_days and monthly_rate:
        net, disc_cost = discount_receivable(tot_rev, payment_days, monthly_rate)
        eff_gm     = net - tot_cost
        eff_gm_pct = eff_gm / net * 100
        months     = payment_days / 30
        print(f"\n  {'-' * 44}")
        print(f"  Prazo: {payment_days} dias ({months:.1f} meses) | Taxa: {monthly_rate*100:.1f}% a.m.")
        print(f"  Receita líquida hoje:     {brl(net)}")
        print(f"  Custo do desconto:        {brl(disc_cost)}")
        print(f"  Margem efetiva hoje:      {brl(eff_gm)}   {eff_gm_pct:.1f}%")

    print()

    # Per-line detail
    if len(lines) > 1:
        print(f"  {'-'*44}")
        print(f"  DETALHES POR SKU:")
        for r in lines:
            print(f"    {r['sku']} | break-even: R${r['break_even']:.2f}/un | "
                  f"retail: R${r['retail']:.2f} | desc: {r['disc_vs_retail']:.1f}% off")
    print()


def print_ledger(history):
    print(f"\n  LEDGER DE DESCONTOS — histórico por SKU  {'-'*30}")
    if not history:
        print("  (nenhum deal em history.json ainda)")
        return
    # Collect all entries sorted by SKU then date
    rows = []
    for deal in history:
        for line in deal.get("lines", []):
            retail = line.get("retail_at_time", 0)
            disc = (retail - line["price"]) / retail * 100 if retail else None
            key = _norm_sku(line["sku"])
            cogs_es = COGS.get(key, {}).get("cogs_es")
            gm = (line["price"] - cogs_es) / line["price"] * 100 if cogs_es else None
            rows.append({
                "sku":      key,
                "name":     COGS.get(key, {}).get("name", "?"),
                "operator": deal["operator"],
                "date":     deal["date"][:7],
                "volume":   line["volume"],
                "price":    line["price"],
                "retail":   retail,
                "disc_pct": disc,
                "gm_pct":   gm,
            })
    rows.sort(key=lambda r: (r["sku"], r["date"]))
    print(f"  {'SKU':<8} {'Produto':<28} {'Operador':<12} {'Data':<8} "
          f"{'Vol':>7} {'Preço':>7} {'Retail':>7} {'Desc%':>6} {'GM%':>6}")
    print(f"  {'-'*90}")
    cur_sku = None
    for r in rows:
        sep = "" if r["sku"] == cur_sku else "\n" if cur_sku else ""
        cur_sku = r["sku"]
        disc_s = f"{r['disc_pct']:>5.1f}%" if r["disc_pct"] is not None else "   N/D"
        gm_s   = f"{r['gm_pct']:>5.1f}%"  if r["gm_pct"]  is not None else "   N/D"
        print(f"{sep}  {r['sku']:<8} {r['name'][:28]:<28} {r['operator']:<12} {r['date']:<8} "
              f"{r['volume']:>7,} {r['price']:>7.2f} {r['retail']:>7.2f} {disc_s:>6} {gm_s:>6}")

    # Per-SKU summary
    from collections import defaultdict
    by_sku = defaultdict(list)
    for r in rows:
        if r["disc_pct"] is not None:
            by_sku[r["sku"]].append(r["disc_pct"])
    if by_sku:
        print(f"\n  {'SKU':<8} {'Produto':<28} {'Min desc%':>9} {'Max desc%':>9} {'# deals':>7}")
        print(f"  {'-'*65}")
        for sku in sorted(by_sku):
            discs = by_sku[sku]
            name = COGS.get(sku, {}).get("name", "?")
            print(f"  {sku:<8} {name[:28]:<28} {min(discs):>8.1f}% {max(discs):>8.1f}% {len(discs):>7}")
    print()


def print_coverage():
    print(f"\n  COBERTURA DE COGS  {'-'*40}")
    print(f"  {'SKU':<8} {'Produto':<38} {'COGS ES':>9} {'COGS SP':>9} {'Retail':>9} {'Src'}")
    print(f"  {'-'*80}")
    for sku, p in COGS.items():
        es = f"R${p['cogs_es']:>7.2f}" if p["cogs_es"] else "    N/D  "
        sp = f"R${p['cogs_sp']:>7.2f}" if p["cogs_sp"] else "    N/D  "
        rt = f"R${p['retail']:>7.2f}"
        flag = "" if p["cogs_es"] else "  ⚠ COGS ausente"
        print(f"  {sku:<8} {p['name'][:38]:<38} {es:>9} {sp:>9} {rt:>9}  [{p['src']}]{flag}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Box Deal Simulator — GE Beauty")
    parser.add_argument("sku",    nargs="?")
    parser.add_argument("volume", nargs="?", type=int)
    parser.add_argument("price",  nargs="?", type=float)
    parser.add_argument("--deal",         help="Caminho para JSON do deal")
    parser.add_argument("--payment-days", type=int,   default=None)
    parser.add_argument("--monthly-rate", type=float, default=0.013)
    parser.add_argument("--cogs-basis",   choices=["es", "sp"], default="es",
                        help="es = Espírito Santo (padrão/melhor), sp = São Paulo")
    parser.add_argument("--ledger",       action="store_true",
                        help="Exibe ledger histórico de descontos por SKU")
    args = parser.parse_args()

    basis   = args.cogs_basis
    history = load_history()

    if args.ledger:
        print_ledger(history)
        return

    if args.deal:
        spec         = json.loads(Path(args.deal).read_text(encoding="utf-8-sig"))
        name         = spec.get("name", "Deal")
        payment_days = spec.get("payment_days", args.payment_days)
        monthly_rate = spec.get("monthly_rate", args.monthly_rate)
        results = []
        for line in spec["lines"]:
            r, err = simulate_line(line["sku"], line["volume"], line["price"], basis)
            if err:
                print(f"  ⚠  {err}")
            else:
                results.append(r)
        if results:
            print_deal(name, results, payment_days, monthly_rate, basis, history)

    elif args.sku and args.volume and args.price:
        r, err = simulate_line(args.sku, args.volume, args.price, basis)
        if err:
            print(f"Erro: {err}")
            sys.exit(1)
        label = f"{args.sku} — {args.volume:,} un @ R${args.price:.2f}"
        print_deal(label, [r], args.payment_days, args.monthly_rate, basis, history)

    else:
        print_coverage()
        parser.print_help()


if __name__ == "__main__":
    main()
