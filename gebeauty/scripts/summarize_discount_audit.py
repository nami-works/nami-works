"""Summarize the discount_shipping_audit.json output into a compact report."""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

DATA = json.loads((Path(__file__).resolve().parent.parent / "inputs" / "discount_shipping_audit.json").read_text(encoding="utf-8"))

not_comb = DATA["not_combining_shipping"]
comb = DATA["combining_shipping"]
free = DATA["free_shipping_discounts"]

print(f"TOTAL active discounts: {DATA['total']}")
print(f"  combines with shipping = TRUE : {len(comb)}")
print(f"  combines with shipping = FALSE: {len(not_comb)}")
print(f"  free-shipping discount (N/A) : {len(free)}")
print()

# Breakdown of NOT-combining by type
type_counts = Counter(d["type"] for d in not_comb)
print("NOT combining with shipping — by type:")
for t, n in type_counts.most_common():
    print(f"  {t}: {n}")
print()

# Pattern-based grouping of titles
def classify(title: str) -> str:
    t = title.strip()
    if t.startswith("BEAUTYBACK-"):
        m = re.match(r"BEAUTYBACK-([A-Z0-9]+)-", t)
        return f"BEAUTYBACK-{m.group(1)}-*" if m else "BEAUTYBACK-*"
    if t.startswith("NIVER-"):
        return "NIVER-* (birthday codes)"
    if t.startswith("gift_"):
        return "gift_* (gift cards)"
    if t.startswith("Loox Photo/Video Reviews:"):
        return "Loox Photo/Video Reviews: LX-*"
    if t.startswith("Loox Referrals"):
        return "Loox Referrals - Friend Discount - LXZ-*"
    if re.match(r"^[A-Z]+10OFF\b", t):
        return "<NAME>10OFF (affiliate 10% codes)"
    if re.match(r"^[A-Z]+10\b", t) and len(t.split()) == 1:
        return "<NAME>10 (affiliate 10% codes)"
    if re.match(r"^[A-Z0-9]{10,}$", t):
        return "random-alphanumeric (unknown)"
    return t  # unique

groups = defaultdict(list)
for d in not_comb:
    groups[classify(d["title"])].append(d)

print("NOT combining with shipping — grouped by title pattern:")
for pattern, items in sorted(groups.items(), key=lambda x: -len(x[1])):
    if len(items) == 1:
        d = items[0]
        print(f"  [{d['type']}] {d['title']}")
    else:
        sample = sorted(i["title"] for i in items)[:3]
        print(f"  {pattern}  x{len(items)}  e.g. {', '.join(sample)}")

# Separately list the combining=TRUE discounts (for context)
print()
print("COMBINING with shipping — by type:")
tcomb = Counter(d["type"] for d in comb)
for t, n in tcomb.most_common():
    print(f"  {t}: {n}")

print()
print("COMBINING with shipping — individual (non-BEAUTYBACK) titles:")
for d in comb:
    if d["title"].startswith("BEAUTYBACK-"):
        continue
    print(f"  [{d['type']}] {d['title']}")

print()
print("Free-shipping discounts (N/A on combinesShipping):")
for d in free:
    print(f"  [{d['type']}] {d['title']}  combinesOrder={d['combinesOrder']} combinesProduct={d['combinesProduct']}")
