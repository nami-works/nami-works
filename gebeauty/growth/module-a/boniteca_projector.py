"""Boniteca tier auto-projector.

Boniteca is a monthly FLAT-CLIFF fee: the rate depends on where the MONTH's
qualifying (cosmetic) revenue lands in the tier table. This resolves that rate
and writes it to params.json -> boniteca.resolved_pct, so the margin engine and
offer tool always use the right tier.

Two modes (design locked with Lucas 2026-07-22):
  current : in-month velocity (Lucas' method) — projected full month =
            this-month MTD(day D) / reference in-month fraction, where the
            reference fraction = avg over clean reference months of
            (that month's MTD at day D / that month's full). Reference months
            are chosen to EXCLUDE anomalies (e.g. product launches). Currently
            Apr+May 2026 (the end-June mist launch makes June a bad reference).
  future  : last-year SAME month x (1 + YTD YoY growth), with optional per-month
            manual overrides (campaign concentration) -> tier.

Data lives in boniteca_history.json (built by --build-history, which pulls the
qualifying base from Omie NF-e mod-55 + Shopify POS via boniteca_faturamento_mtd
- SLOW/throttled, run on the analyst cadence). Blended qualifying base.

CLI:
  python boniteca_projector.py --mode current --month 2026-07 --mtd 210000 --day 15
  python boniteca_projector.py --mode future  --month 2026-11
  python boniteca_projector.py --mode future  --month 2026-11 --write   # update params
"""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
GROWTH = HERE.parent
PARAMS_PATH = GROWTH / "params.json"
HISTORY_PATH = HERE / "boniteca_history.json"


def load_json(p, default=None):
    return json.loads(Path(p).read_text(encoding="utf-8")) if Path(p).exists() else (default or {})


def tier_for(revenue, tier_table):
    """Flat-cliff: the rate of the first bracket whose ceiling revenue does NOT exceed."""
    for ceiling, rate in tier_table:
        if ceiling is None or revenue <= ceiling:
            return rate
    return tier_table[-1][1]


def prev_month(month):
    y, m = int(month[:4]), int(month[5:7])
    return f"{y-1}-12" if m == 1 else f"{y}-{m-1:02d}"


def reference_fraction(history):
    """Avg in-month fraction (MTD at ref day / full) over clean reference months."""
    ref = history.get("reference_fraction") or {}
    months = ref.get("months") or {}
    fracs = [m["mtd"] / m["full"] for m in months.values() if m.get("full")]
    if not fracs:
        return None, None, None
    return sum(fracs) / len(fracs), ref.get("day"), sorted(months)


def project_current(this_mtd, ref_frac, ref_months=None):
    """In-month velocity: projected full = this_mtd / reference in-month fraction."""
    if not ref_frac:
        return None, "need reference in-month fraction (set history.reference_fraction or --ref-fraction)"
    projected = this_mtd / ref_frac
    rm = f" from {','.join(ref_months)}" if ref_months else ""
    return projected, (f"in-month velocity: this MTD R${this_mtd:,.0f} / ref fraction "
                       f"{ref_frac:.3f}{rm}")


def ytd_yoy_growth(history, ref_year):
    """Sum(YTD this year) / Sum(YTD last year) - 1, over months present in both."""
    monthly = history.get("qualifying_monthly_brl", {})
    this_ytd = sum(v for k, v in monthly.items() if k.startswith(str(ref_year)))
    months_this = [int(x[5:7]) for x in monthly if x.startswith(str(ref_year))] or [0]
    last_ytd = sum(v for k, v in monthly.items() if k.startswith(str(ref_year - 1))
                   and int(k[5:7]) <= max(months_this))
    return (this_ytd / last_ytd - 1) if last_ytd else None


def project_future(month, history):
    y, m = int(month[:4]), int(month[5:7])
    overrides = history.get("overrides_brl", {})
    if month in overrides:
        return float(overrides[month]), f"manual override (campaign concentration)"
    monthly = history.get("qualifying_monthly_brl", {})
    last = monthly.get(f"{y-1}-{m:02d}")
    g = ytd_yoy_growth(history, y)
    if last is not None and g is not None:
        return last * (1 + g), f"last-year same month R${last:,.0f} x (1 + YTD YoY {100*g:.1f}%)"
    return None, "insufficient history (need last-year same month + YTD) - run --build-history"


def write_params(rate, mode, month, basis):
    params = load_json(PARAMS_PATH)
    b = params["boniteca"]
    b["resolved_pct"] = round(rate, 4)
    b["resolved_mode"] = f"projected_{mode}"
    b["resolved_asof"] = month
    b["resolved_basis"] = basis
    PARAMS_PATH.write_text(json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Boniteca tier projector")
    ap.add_argument("--mode", choices=["current", "future"], required=True)
    ap.add_argument("--month", required=True, help="YYYY-MM")
    ap.add_argument("--mtd", type=float, help="current-mode: THIS month's MTD qualifying gross R$")
    ap.add_argument("--ref-fraction", type=float, help="current-mode: reference in-month fraction (else from history.reference_fraction)")
    ap.add_argument("--day", type=int, help="current-mode: day-of-month of the MTD window (must match the reference day)")
    ap.add_argument("--write", action="store_true", help="write resolved_pct into params.json")
    a = ap.parse_args()

    params = load_json(PARAMS_PATH)
    tiers = params["boniteca"]["tier_table_brl"]
    history = load_json(HISTORY_PATH, {})

    if a.mode == "current":
        if a.mtd is None:
            ap.error("current mode needs --mtd (this month's MTD)")
        ref_months = None
        if a.ref_fraction is not None:
            ref_frac = a.ref_fraction
        else:
            ref_frac, ref_day, ref_months = reference_fraction(history)
            if ref_frac is None:
                ap.error("no reference fraction: set history.reference_fraction.months or pass --ref-fraction")
            if a.day and ref_day and a.day != ref_day:
                print(f"  WARNING: --day {a.day} != reference day {ref_day}; fraction is day-specific.")
        projected, basis = project_current(a.mtd, ref_frac, ref_months)
    else:
        projected, basis = project_future(a.month, history)
        if projected is None:
            print(f"[{a.month}] cannot project: {basis}")
            return

    rate = tier_for(projected, tiers)
    print(f"[{a.month}] projected qualifying gross R${projected:,.0f}  ->  Boniteca {100*rate:.1f}%")
    print(f"  basis: {basis}")
    # distance to nearest lower tier (the cliff play)
    for ceiling, r in tiers:
        if ceiling and projected <= ceiling:
            print(f"  cliff: R${ceiling - projected:,.0f} below the {100*r:.0f}%->next crossing at R${ceiling:,.0f}")
            break
    if a.write:
        write_params(rate, a.mode, a.month, basis)
        print(f"  -> wrote params.json boniteca.resolved_pct = {rate}")


if __name__ == "__main__":
    main()
