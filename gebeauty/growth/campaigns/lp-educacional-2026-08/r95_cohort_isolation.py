#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Cohort-isolated economics for [GE] primeira-rotina-r95.

CORRECTION (Lucas, 2026-07-31): this campaign carries a ~60% discount wired into
the offer and targets never-purchased customers only. It is an acquisition
loss-leader, so under the cohort-isolation rule in brand-context.md it must NOT be
ranked against full-price campaigns and must NOT be judged on first-order economics.
The earlier ACCOUNT-AUDIT.md table did exactly that. This script replaces that read.

Full routine (001+002+008) list = R$259. Offer sticker = R$95 => 63.3% off.
Observed campaign AOV = R$125.85 (R$9,187.12 / 73 purchases, Jul 1-30 2026).

The point of this file: quantify the deliberate first-order loss, then state what
downstream number has to be true for the loss to be worth paying.
"""
import json
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
P = json.load(open(os.path.join(BASE, "params.json"), encoding="utf-8"))
SKUS = json.load(open(os.path.join(BASE, "cost-basis.json"), encoding="utf-8"))["skus"]

FLOOR = P["profit_floor_pct"]
FREIGHT_PCT = P["freight_revenue_pct"]
FREE_SHIP = P["free_shipping_threshold_brl"]
PO = P["per_order_brl"]
AV = P["ad_valorem_pct"]["tax"] + P["ad_valorem_pct"]["payment_fee"]
BON = P["boniteca"]["resolved_pct"]

WASH = ["GEB 001", "GEB 002", "GEB 008"]
LIST_PRICE = sum(SKUS[s]["retail_brl"] for s in WASH)
COGS = sum(SKUS[s]["unit_cost_brl"] for s in WASH)
UNITS = len(WASH)

# Observed, Jul 1-30 2026
SPEND = 1583.90
PURCHASES = 73
VALUE = 9187.12
AOV = VALUE / PURCHASES
CPA = SPEND / PURCHASES
REPEAT_BASELINE = 0.158  # brand-context.md, as_of 2026-07, CGO-TEAM.md


def packaging(u):
    t = PO["packaging_tiers_brl"]
    return t["small"] if u <= t["small_max"] else (t["medium"] if u <= t["medium_max"] else t["large"])


def order(product_net, units=UNITS, cogs=COGS):
    freight_rev = product_net * FREIGHT_PCT if product_net < FREE_SHIP else 0.0
    total_rev = product_net + freight_rev
    per_order = PO["freight"] + PO["fulfillment"] + packaging(units)
    contrib = total_rev - cogs - per_order - total_rev * AV - product_net * BON
    return contrib, total_rev, per_order


print("=" * 92)
print("primeira-rotina-r95 :: ISOLATED COHORT (loss-leader, never-purchased only)")
print("=" * 92)
print(f"routine list price        R$ {LIST_PRICE:>8.2f}   (001 + 002 + 008, {UNITS} units)")
print(f"offer sticker             R$ {95.00:>8.2f}   = {(1-95/LIST_PRICE):.1%} off")
print(f"absolute COGS             R$ {COGS:>8.2f}   fixed, does NOT shrink with the discount")
print()

for label, net in [("at the R$95 sticker", 95.00), (f"at observed AOV R${AOV:.2f}", AOV)]:
    contrib, total_rev, per_order = order(net)
    after_media = contrib - CPA
    print(f"{label}")
    print(f"  total revenue           R$ {total_rev:>8.2f}")
    print(f"  contribution b/ media   R$ {contrib:>8.2f}   ({contrib/total_rev:>6.1%} of revenue)")
    print(f"  less CPA R${CPA:.2f}          R$ {after_media:>8.2f}   ({after_media/total_rev:>6.1%} of revenue)")
    print(f"  vs 10% floor            {'CLEARS' if after_media >= FLOOR*total_rev else 'BELOW FLOOR by R$ %.2f' % (FLOOR*total_rev - after_media)}")
    print()

contrib_aov, total_rev_aov, _ = order(AOV)
first_order_gap = FLOOR * total_rev_aov - (contrib_aov - CPA)
total_subsidy = (contrib_aov - CPA) * PURCHASES

print("-" * 92)
print("WHAT THIS COHORT ACTUALLY IS")
print("-" * 92)
print(f"first-order net per customer      R$ {contrib_aov - CPA:>8.2f}")
print(f"gap to the 10% floor per order    R$ {first_order_gap:>8.2f}")
print(f"cohort first-order contribution   R$ {total_subsidy:>8.2f}  across {PURCHASES} customers")
print(f"true acquisition cost per customer R$ {CPA + max(0.0, -(contrib_aov - CPA)):>7.2f}  "
      f"(media + any first-order loss)")
print()
print("This is a deliberate subsidy, not a failure. The question is not whether the")
print("first order clears the floor (it does not, by design) but whether the SECOND")
print("order pays the subsidy back.")
print()

# Breakeven: what does a full-price repeat order contribute, and how many of the
# cohort must repeat for the cohort to clear the floor overall?
repeat_contrib, repeat_rev, _ = order(LIST_PRICE)  # a full-price routine repurchase
print("-" * 92)
print("PAYBACK TEST (the number that decides this cohort)")
print("-" * 92)
print(f"a full-price routine repurchase contributes R$ {repeat_contrib:.2f} (no media, organic repeat)")

need_per_customer = max(0.0, first_order_gap)
breakeven_repeat = need_per_customer / repeat_contrib
print(f"per acquired customer we must recover        R$ {need_per_customer:.2f}")
print(f"=> required repeat rate to clear the floor   {breakeven_repeat:.1%}")
print(f"   brand repeat baseline (2026-07 snapshot)  {REPEAT_BASELINE:.1%}")
print(f"   routine-first repeat (retention study)    25.0%")
print()
if breakeven_repeat <= REPEAT_BASELINE:
    print("VERDICT: clears on the baseline repeat rate alone. The subsidy is affordable")
    print("even if this cohort behaves like an average GE customer.")
else:
    print("VERDICT: needs an above-baseline repeat rate. Only defensible if the routine-first")
    print("retention effect actually shows up in THIS cohort. Measure it, do not assume it.")
print()
print("MEASUREMENT REQUIREMENT: tag these orders at creation, exclude them from blended")
print("Module A reporting, and read the cohort on 2nd-purchase rate and payback window,")
print("never on first-order AOV or platform ROAS.")
