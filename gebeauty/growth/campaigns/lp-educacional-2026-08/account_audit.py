#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Margin-true audit of the live Meta account against the GE Beauty gate.

Input: campaign rows read from ad account 606199920079315 (GE_Beauty, BRL),
Jul 1-30 2026, via the Meta MCP on 2026-07-31.

Platform ROAS is NOT the gate. The gate is:
  net margin per purchase after media >= 10% of total revenue
  AND marginal CAC under the R$68 ceiling.

Method: for each campaign take reported AOV and CPA, run the ABSOLUTE cost model
from params.json, and solve for the max CPA that still lands on the floor.
Basket composition per campaign is unknown, so units are estimated from AOV at the
catalogue's average full-size unit price. Directional. Exact per-campaign margin
needs Module A against real order lines (growth-analyst).
"""
import json
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
P = json.load(open(os.path.join(BASE, "params.json"), encoding="utf-8"))
SKUS = json.load(open(os.path.join(BASE, "cost-basis.json"), encoding="utf-8"))["skus"]

FLOOR = P["profit_floor_pct"]
FREIGHT_REV_PCT = P["freight_revenue_pct"]
FREE_SHIP = P["free_shipping_threshold_brl"]
PO = P["per_order_brl"]
AV = P["ad_valorem_pct"]["tax"] + P["ad_valorem_pct"]["payment_fee"]
BONITECA = P["boniteca"]["resolved_pct"]
CAC_CEILING = 68.0

full = [v for v in SKUS.values() if v.get("size") == "full"]
AVG_UNIT_PRICE = sum(v["retail_brl"] for v in full) / len(full)
COGS_RATIO = sum(v["unit_cost_brl"] for v in full) / sum(v["retail_brl"] for v in full)

# name, spend, purchases, purchase_value, status, roas, lpv, atc
CAMPAIGNS = [
    ("[CS] [REGULAR] [CONVERSAO] [ABO] [MISTO]",              40487.68, 984, 184494.32, "ACTIVE", 4.56, 26267, 5729),
    ("[CS] Novos Videos | Teste de criativos",                 15184.61, 388,  71562.51, "ACTIVE", 4.71,  5837, 2275),
    ("[CS] Primer Liso | Teste de criativos | ABO",             9484.37,  99,  22015.24, "ACTIVE", 2.32,  8883,  620),
    ("[CS] Primer Cachos | Teste de criativos | ABO",           8634.87, 128,  27008.18, "ACTIVE", 3.13,  5426,  917),
    ("[GE] MIST-LAUNCH | Test | Hooks ABO",                     7102.16,  11,   2258.20, "PAUSED", 0.32,  6133,  644),
    ("[CS] Primer Cachos | Coloquial Estatico | ABO",           3174.04,  25,   6772.12, "PAUSED", 2.13,   744,  179),
    ("[CS] Primer Cachos | Institucional Estatico | ABO",       2746.69,  30,   6967.44, "PAUSED", 2.54,   475,  138),
    ("[CS] Primer Liso | Institucional Estatico | ABO",         2175.52,  17,   3774.73, "PAUSED", 1.74,   325,  103),
    ("[CS] Primer Liso | Coloquial Estatico | ABO",             2022.89,  11,   2380.16, "PAUSED", 1.18,   301,   70),
    ("[GE] primeira-rotina-r95 | TESTE | ABO",                  1583.90,  73,   9187.12, "ACTIVE", 5.80,  1194,  639),
    ("[GE] [GANHE MINI] [CONVERSAO] [ABO] [NOVOS]",             1508.03, 444,  11096.20, "PAUSED", 7.36,  3832, 2331),
    ("[CS] Primer Cachos | Review | ABO",                       1320.03,  27,   5617.18, "PAUSED", 4.26,   338,  129),
    ("[CS] Novos Videos | Validados",                           1169.24,  44,   9274.93, "ACTIVE", 7.93,   921,  248),
    ("[CS] Primer Liso | Review | ABO",                         1008.65,  31,   6728.81, "PAUSED", 6.67,   218,  138),
    ("[GE] MIST - TESTE",                                        929.46,   1,    146.43, "ACTIVE", 0.16,  1183,  150),
    ("[CS] Body & hair mist | Lancamento | ABO",                 381.24,   4,   1264.55, "ACTIVE", 3.32,   218,   23),
    ("[CS] PRIMER LISO INTACTO | Teste de criativos",            202.69,   5,    830.76, "PAUSED", 4.10,   113,   32),
]


def packaging(units):
    t = PO["packaging_tiers_brl"]
    if units <= t["small_max"]:
        return t["small"]
    if units <= t["medium_max"]:
        return t["medium"]
    return t["large"]


def max_cpa_at_floor(aov):
    """Largest media cost per purchase that still leaves 10% net on this AOV."""
    units = max(1, round(aov / AVG_UNIT_PRICE))
    cogs = aov * COGS_RATIO
    bills_freight = aov < FREE_SHIP
    freight_rev = aov * FREIGHT_REV_PCT if bills_freight else 0.0
    total_rev = aov + freight_rev
    per_order = PO["freight"] + PO["fulfillment"] + packaging(units)
    contrib = total_rev - cogs - per_order - total_rev * AV - aov * BONITECA
    return contrib - FLOOR * total_rev, total_rev, units


print(f"floor {FLOOR:.0%} | CAC ceiling R${CAC_CEILING:.0f} | avg full-size unit R${AVG_UNIT_PRICE:.2f} | "
      f"catalogue COGS ratio {COGS_RATIO:.1%}")
print("=" * 132)
print(f"{'campaign':<44}{'spend':>10}{'AOV':>9}{'CPA':>9}{'maxCPA':>9}{'net%':>8}{'ROAS':>7}"
      f"{'LPV>ATC':>9}{'st':>8}{'verdict':>12}")
print("-" * 132)

rows = []
for name, spend, purch, value, status, roas, lpv, atc in CAMPAIGNS:
    aov = value / purch
    cpa = spend / purch
    headroom, total_rev, units = max_cpa_at_floor(aov)
    net_pct = (headroom + FLOOR * total_rev - cpa) / total_rev
    lpv_atc = (atc / lpv * 100) if lpv else 0
    if cpa <= headroom and cpa <= CAC_CEILING:
        verdict = "CLEARS"
    elif cpa <= headroom:
        verdict = "floor ok/CAC>"
    else:
        verdict = "BELOW FLOOR"
    rows.append((name, spend, aov, cpa, headroom, net_pct, roas, lpv_atc, status, verdict))
    print(f"{name[:43]:<44}{spend:>10,.0f}{aov:>9.0f}{cpa:>9.2f}{headroom:>9.2f}{net_pct:>7.1%}"
          f"{roas:>7.2f}{lpv_atc:>8.1f}%{status[:6]:>8}{verdict:>12}")

print("-" * 132)
tot_spend = sum(r[1] for r in CAMPAIGNS if False) or sum(c[1] for c in CAMPAIGNS)
tot_purch = sum(c[2] for c in CAMPAIGNS)
tot_value = sum(c[3] for c in CAMPAIGNS)
print(f"{'ACCOUNT TOTAL':<44}{tot_spend:>10,.0f}{tot_value/tot_purch:>9.0f}"
      f"{tot_spend/tot_purch:>9.2f}{'':>9}{'':>7}{tot_value/tot_spend:>7.2f}")
print()
print("maxCPA = media per purchase that still lands exactly on the 10% net floor at that AOV.")
print("net%   = net margin as % of total revenue at the CPA actually paid.")
print("CPA is cost per PURCHASE, not per NEW customer. True CAC is higher wherever repeat")
print("buyers sit in the mix, so a campaign near its maxCPA is already effectively over.")
print()
print("Money bleeding below the floor, active only:")
for r in rows:
    if r[9] != "CLEARS" and r[8] == "ACTIVE":
        print(f"  {r[0][:60]:<62} spend R${r[1]:>9,.0f}  CPA R${r[3]:>7.2f} vs maxCPA R${r[4]:.2f}")
