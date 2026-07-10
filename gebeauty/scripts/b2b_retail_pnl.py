"""
B2B Retail Channel P&L / Break-even + Counter-proposal Simulator — GE Beauty
============================================================================
First P&L for a sellout-support retail channel (vs. discount-only box deals in
box_deal_simulator.py).

Channel #1: Drogaria Iguatemi / Grupo DI (curated SP pharmacy-perfumery).
Terms from the "GE Beauty | Next Steps" thread (Jun 2026) + Lucas's P&L inputs:
  - They ASKED: retailer margin 45%, trade package R$150.000 / 12 mo.
    NEITHER is agreed yet -> both are negotiable levers in the counter-proposal.
  - First order 100% bonificado: 6 units/SKU/store + 1 tester/item (cost to GE)
  - Deliver to ONE CD (Brooklin, SP); 7 SP stores; weekly replenishment.

ANCHOR (so margin can move):
  COGS is fixed in R$, not as a % of sell-in. From Lucas's example
  (R$95 shelf -> R$52.25 sell-in @45% -> ~R$26.5 COGS), COGS = 50% of sell-in
  at the asked 45% margin => COGS = 0.50 x 0.55 x D2C = 0.275 x D2C (27.5% of shelf).
  Then for ANY retailer margin m:  sell-in = D2C x (1-m),
       gross margin% = 1 - COGS/sell-in = 1 - 0.275/(1-m).
  Lower retailer margin => higher sell-in price => higher GE gross margin.

Locked taxes (Lucas 29/06): ICMS 1.1% (COMPETE-ES) + PIS/COFINS 9.25% = 10.35% of sell-in.
Freight R$500/order x 52 = R$26.000/yr (fixed). Free goods anchored on COGS (fixed).

Usage:
  python b2b_retail_pnl.py                 # base break-even + counter-proposal @ R$4k
  python b2b_retail_pnl.py --target 4500   # change the per-store/month sell-in target
"""

import argparse

# ===========================================================================
# DEAL TERMS + ANCHORS
# ===========================================================================
STORES = 7
HORIZON_MONTHS = 12
COGS_PCT_OF_D2C = 0.275          # fixed COGS anchor (derived; see header)
ICMS_PCT = 0.011                 # COMPETE-ES Atacadista effective
PIS_COFINS_PCT = 0.0925          # federal, non-cumulative
TAX = ICMS_PCT + PIS_COFINS_PCT  # 10.35% of sell-in
FREIGHT = 500.0 * 52             # fixed, weekly replenishment to the CD
FREE_UNITS_PER_SKU_PER_STORE = 6
TESTERS_PER_SKU_PER_STORE = 1

REQUESTED_MARGIN = 0.45          # what Iguatemi asked (not agreed)
REQUESTED_TRADE = 150_000.0      # what Iguatemi asked (not agreed)

# Catalog: D2C shelf price (mists = Melon Mood, assumed). tier for the unit mix.
CATALOG = {
    "GEB001": ("HAIR",  80.75),  "GEB002": ("HAIR",  80.75),  "GEB003": ("HAIR",  84.15),
    "GEB101": ("HAIR",  126.65), "GEB102": ("HAIR",  118.15), "GEB120": ("HAIR",  126.65),
    "GEB022": ("BOOST", 67.15),  "GEB019": ("BOOST", 63.75),  "GEB020": ("BOOST", 58.65),
    "GEB021": ("BOOST", 58.65),  "GEB023": ("BOOST", 63.75),
    "GEB024": ("MIST",  129.00), "GEB031": ("MIST",  129.00), "GEB032": ("MIST",  129.00),
    "GEB033": ("MIST",  129.00),
}
MIX_WEIGHT = {"HAIR": 3.0, "BOOST": 1.0, "MIST": 1.5}   # relative reorder units/SKU/store/mo


def brl(v):
    return f"R$ {v:>11,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def k(v):
    return f"{v:,.0f}".replace(",", "X").replace(".", ",").replace("X", ".")


def gm(m):                       # gross margin % of sell-in at retailer margin m
    return 1 - COGS_PCT_OF_D2C / (1 - m)


def cm(m):                       # contribution margin % of sell-in
    return gm(m) - TAX


def free_goods():                # COGS of the 100%-free first order (fixed, COGS-anchored)
    units = (FREE_UNITS_PER_SKU_PER_STORE + TESTERS_PER_SKU_PER_STORE) * STORES
    return sum(COGS_PCT_OF_D2C * d2c * units for _, (ln, d2c) in CATALOG.items())


def blended_d2c_per_unit():      # mix-weighted average shelf price per reorder unit
    n, sd2c = {}, {}
    for _, (ln, d2c) in CATALOG.items():
        n[ln] = n.get(ln, 0) + 1
        sd2c[ln] = sd2c.get(ln, 0.0) + d2c
    num = sum(MIX_WEIGHT[ln] * sd2c[ln] for ln in n)            # weight * (sum of d2c in line)
    den = sum(MIX_WEIGHT[ln] * n[ln] for ln in n)
    return num / den


def main():
    ap = argparse.ArgumentParser(description="GE Beauty B2B retail scenario")
    ap.add_argument("--margin", type=float, default=0.40, help="retailer margin (counter)")
    ap.add_argument("--sellout", type=float, default=7000.0, help="sellout R$/store/month")
    ap.add_argument("--trade", type=float, default=REQUESTED_TRADE, help="trade investment to test")
    args = ap.parse_args()
    m, sellout, trade = args.margin, args.sellout, args.trade

    fg = free_goods()
    fixed_non_trade = fg + FREIGHT
    sellin = sellout * (1 - m)                       # per store/month
    annual_sellin = sellin * STORES * HORIZON_MONTHS
    contribution = annual_sellin * cm(m)
    available = contribution - fixed_non_trade       # to fund trade + profit + activation
    result = available - trade
    d2c_unit = blended_d2c_per_unit()
    units = sellin / (d2c_unit * (1 - m))

    print("=" * 82)
    print("  GE BEAUTY  |  B2B SCENARIO  |  Drogaria Iguatemi (Grupo DI)")
    print("=" * 82)
    print(f"  Anchors: COGS {COGS_PCT_OF_D2C:.1%} of shelf | ICMS {ICMS_PCT:.2%} + PIS/COFINS "
          f"{PIS_COFINS_PCT:.2%} | {STORES} stores x {HORIZON_MONTHS} mo")
    print(f"  Their ask (not agreed): {REQUESTED_MARGIN:.0%} margin + {brl(REQUESTED_TRADE).strip()} trade")

    print(f"\n  SCENARIO: {m:.0%} margin (your counter)  |  {brl(sellout).strip()} sellout/store/month")
    print(f"    Sellout / store / month        {brl(sellout)}")
    print(f"    Sell-in / store / month        {brl(sellin)}   (sellout x {1-m:.2f})")
    print(f"    ~ units / store / month        {units:>14.0f}")
    print(f"    GE gross margin                {gm(m):>13.1%}")
    print(f"    Contribution margin            {cm(m):>13.1%}")

    print(f"\n  ANNUAL P&L  ({STORES} stores x {HORIZON_MONTHS} mo)")
    print(f"    Sell-in revenue                {brl(annual_sellin)}")
    print(f"    = Contribution (after COGS+tax){brl(contribution)}")
    print(f"    (-) Free goods (bonificado)    {brl(-fg)}")
    print(f"    (-) Freight                    {brl(-FREIGHT)}")
    print(f"    = Available for trade/profit   {brl(available)}")
    print(f"    (-) Trade investment (tested)  {brl(-trade)}")
    print(f"    = CHANNEL RESULT               {brl(result)}   {'PROFIT' if result>=0 else 'LOSS'}")

    # ---- break-even points at this margin ----------------------------------
    be_trade = available                                        # max trade at zero result
    be_sellin = (trade + fixed_non_trade) / cm(m) / STORES / HORIZON_MONTHS
    be_sellout = be_sellin / (1 - m)
    print(f"\n  AT {m:.0%} MARGIN, TO BREAK EVEN:")
    print(f"    Max trade investment (this sellout)   {brl(be_trade)}")
    print(f"    OR sellout needed (their R$150k trade) {brl(be_sellout)}/store/mo "
          f"({brl(be_sellin).strip()} sell-in)")

    # ---- sensitivity: vary sellout at this margin --------------------------
    print(f"\n  SELLOUT SENSITIVITY @ {m:.0%} margin  (result vs {brl(trade).strip()} trade)")
    print(f"    {'sellout/st/mo':>14}{'sell-in/st/mo':>15}{'contribution/yr':>17}"
          f"{'avail for trade':>17}{'result vs trade':>17}")
    for so in (5000, 6000, 7000, 8000, 8852, 10000):
        si = so * (1 - m)
        contrib = si * STORES * HORIZON_MONTHS * cm(m)
        avail = contrib - fixed_non_trade
        res = avail - trade
        tag = "  <-break-even" if abs(res) < 600 else ""
        print(f"    {k(so):>14}{k(si):>15}{k(contrib):>17}{k(avail):>17}{k(res):>17}{tag}")

    print("\n  NOTE: 'available for trade' = what's left after GE's free goods + freight, to")
    print("        cover the trade package, profit, and activation. Activation comes out of")
    print("        any positive result. COGS anchor + taxes locked with Lucas 29/06.\n")


if __name__ == "__main__":
    main()
