"""Rank GE Beauty Loox reviews for conversion and emit top-10 per product family.

Read-only analysis on sandbox/gebeauty/data/reviews.csv. Consolidates the
duplicate Shopify handles (full-size / travel-size / rappi / migrated) into one
product family, scores each review for *conversion value* (photo-first,
benefit/objection language, substance), de-dupes, and writes a markdown
deliverable + a JSON companion.

Run from anywhere:  python sandbox/gebeauty/scripts/_rank_top_reviews.py
"""
from pathlib import Path
import csv
import json
import re
import unicodedata

ROOT = Path(__file__).resolve().parent.parent          # sandbox/gebeauty
CSV = ROOT / "data" / "reviews.csv"
OUT_DIR = ROOT / "research" / "top-reviews"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# --- handle -> (family_key, display_name, tier) -----------------------------
# tier: hero (core catalog), kit, other
HERO = {
    "shampoo sem sulfato": ["shampoo-sem-sulfato-ge-beauty-250ml", "shampoo-sem-sulfato",
                            "shampoo-sem-sulfato-travel-size", "rappi-shampoo-sem-sulfato-ge-beauty-250ml"],
    "shampoo a seco": ["shampoo-a-seco"],
    "mascara condicionadora": ["mascara-condicionadora-ge-beauty-200ml", "mascara-condicionadora",
                              "mascara-condicionadora-travel-size", "rappi-mascara-condicionadora-ge-beauty-200ml"],
    "mascara mayday": ["mascara-mayday"],
    "leave-in pluma": ["leave-in-pluma"],
    "primer liso intacto": ["primer-liso-intacto"],
    "primer cachos definidos": ["primer-cachos-definidos"],
    "leave-in com protecao termica": ["leave-in-com-protecao-termica-ge-beauty-150ml",
                                       "leave-in-com-protecao-termica", "leave-in-com-protecao-termica-travel-size",
                                       "travel-size-leave-in-com-protecao-termica", "charm-bag-leave-in"],
    "booster antifrizz": ["booster-antifrizz", "brinde-booster-antifrizz"],
    "booster hidratante": ["booster-hidratante-ge-beauty-15ml", "booster-hidratante", "leave-in-booster-hidratante-b"],
    "booster definicao": ["booster-definicao-ge-beauty-15ml", "booster-definicao", "leave-in-booster-definicao-b",
                          "brinde-booster-definicao", "rappi-booster-definicao-ge-beauty-15ml"],
    "booster fortificante": ["booster-fortificante-ge-beauty-15ml", "booster-fortificante"],
    "booster antioxidante": ["booster-antioxidante-ge-beauty-15ml", "booster-antioxidante", "leave-in-booster-antioxidante-b"],
    "melon mood body & hair splash": ["melon-mood-body-hair-splash", "melon-mood-body-hair-splash-travel-size"],
}
DISPLAY = {
    "shampoo sem sulfato": "Shampoo sem Sulfato",
    "shampoo a seco": "Shampoo a Seco",
    "mascara condicionadora": "Máscara Condicionadora",
    "mascara mayday": "Máscara Mayday",
    "leave-in pluma": "Leave-in Pluma",
    "primer liso intacto": "Primer Liso Intacto",
    "primer cachos definidos": "Primer Cachos Definidos",
    "leave-in com protecao termica": "Leave-in com Proteção Térmica",
    "booster antifrizz": "Booster Antifrizz",
    "booster hidratante": "Booster Hidratante",
    "booster definicao": "Booster Definição",
    "booster fortificante": "Booster Fortificante",
    "booster antioxidante": "Booster Antioxidante",
    "melon mood body & hair splash": "Melon Mood Body & Hair Splash",
}
HANDLE2FAMILY = {}
for fam, handles in HERO.items():
    for h in handles:
        HANDLE2FAMILY[h] = (fam, DISPLAY[fam], "hero")

# --- conversion keyword groups (PT, accent-insensitive match) ----------------
KW_GROUPS = [
    ["resultado", "transform", "mudou", "mudanca", "diferenca"],          # results
    ["cheiro", "perfum", "cheiros", "aroma", "fragran"],                  # fragrance (retention driver)
    ["maciez", "macio", "sedos", "brilho", "leve", "soltura", "soltinho"],# sensory
    ["defini", "cachos", "ondula", "frizz", "volume"],                    # curl/finish
    ["hidrat", "nutri", "reparac", "saud"],                               # care
    ["transicao", "quimica", "alisad", "natural"],                       # journey/transition
    ["queda", "cresc", "fortalec", "forca"],                              # growth/strength
]
BUSTER = ["nunca mais", "melhor que ja usei", "melhor que ja", "o melhor", "viciei", "viciad",
          "apaixon", "salvou", "mudou minha vida", "valeu cada", "vale cada", "indico", "recomend"]

def deaccent(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()

def score(r: dict) -> float:
    text = r["review"].strip()
    flat = deaccent(text)
    L = len(text)
    s = 0.0
    s += 50 if r["rating"] == "5" else 30 if r["rating"] == "4" else 0
    if r["img"].strip():
        s += 45                                   # photo reviews are the scarce, high-converting asset
    if r["verified_purchase"] == "true":
        s += 18
    if L < 25:    s += 0
    elif L < 60:  s += 8
    elif L <= 420: s += 26                        # scannable sweet spot
    else:          s += 16                        # wall-of-text, less effective on a widget
    hits = sum(1 for grp in KW_GROUPS if any(k in flat for k in grp))
    s += min(hits, 6) * 6                          # up to 36
    if any(b in flat for b in BUSTER):
        s += 12
    # mild freshness nudge so a top-10 isn't all 2020 reviews
    y = r["date"][:4]
    if y >= "2025":   s += 8
    elif y >= "2024": s += 4
    return s

def norm_key(r: dict) -> str:
    return deaccent(r["full_name"].strip())[:30] + "|" + deaccent(r["review"].strip())[:50]

def main():
    rows = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
    families = {}        # key -> {display, tier, reviews:[]}
    for r in rows:
        h = r["handle"].strip()
        if h in HANDLE2FAMILY:
            fam, disp, tier = HANDLE2FAMILY[h]
        elif h.startswith("kit-"):
            fam, disp, tier = h, h.replace("kit-", "Kit ").replace("-", " ").title(), "kit"
        else:
            fam, disp, tier = ("other:" + (h or "(none)")), (h or "(none)"), "other"
        families.setdefault(fam, {"display": disp, "tier": tier, "reviews": []})
        rr = dict(r); rr["_score"] = score(r); rr["_src"] = h
        families[fam]["reviews"].append(rr)

    # de-dupe within family, sort by score
    for fam, d in families.items():
        seen, uniq = {}, []
        for rr in sorted(d["reviews"], key=lambda x: -x["_score"]):
            k = norm_key(rr)
            if k in seen:
                continue
            seen[k] = True
            uniq.append(rr)
        d["reviews"] = uniq

    tier_order = {"hero": 0, "kit": 1, "other": 2}
    fams = sorted(families.items(), key=lambda kv: (tier_order[kv[1]["tier"]], -len(kv[1]["reviews"])))

    # ---- markdown ----
    md = []
    md.append("# GE Beauty — Top Reviews per Product (conversion-ranked)\n")
    md.append("Source: `sandbox/gebeauty/data/reviews.csv` (1,882 reviews). "
              "Ranked for conversion value: photo > benefit/objection language > substance > 5-star > verified > recency. "
              "Handle variants (full-size / travel-size / rappi / migrated) are pooled into one product family.\n")

    # gap table (hero only matters for the gap call, but list all tiers)
    md.append("## Gap report — products short of 10 quality reviews\n")
    md.append("\"Quality\" = score ≥ 80 (5-star + at least some substance/benefit language). "
              "Below that, the pool is padded with weaker reviews to reach 10 where possible.\n")
    md.append("| Product | Tier | Total pooled | Quality (≥80) | Photos | Can fill top-10? |")
    md.append("|---|---|---:|---:|---:|---|")
    for fam, d in fams:
        if d["tier"] == "other":
            continue
        n = len(d["reviews"]); q = sum(1 for r in d["reviews"] if r["_score"] >= 80)
        ph = sum(1 for r in d["reviews"] if r["img"].strip())
        fill = "✅ yes" if n >= 10 else f"⚠️ only {n}"
        md.append(f"| {d['display']} | {d['tier']} | {n} | {q} | {ph} | {fill} |")
    md.append("")

    # per-family top 10
    for tier_label, tier_key in [("Hero products", "hero"), ("Kits", "kit")]:
        md.append(f"\n## {tier_label}\n")
        for fam, d in fams:
            if d["tier"] != tier_key:
                continue
            top = d["reviews"][:10]
            ph = sum(1 for r in d["reviews"] if r["img"].strip())
            md.append(f"### {d['display']}  ·  {len(d['reviews'])} pooled · {ph} photo\n")
            srcs = sorted({r["_src"] for r in d["reviews"]})
            if len(srcs) > 1:
                md.append(f"_Pooled from handles: {', '.join('`'+s+'`' for s in srcs)}_\n")
            for i, r in enumerate(top, 1):
                flags = []
                if r["img"].strip():               flags.append("📷 PHOTO")
                if r["verified_purchase"] == "true": flags.append("✓ verified")
                flags.append(f"{r['rating']}★")
                flags.append(r["date"][:10])
                name = r["full_name"].strip() or r["nickname"].strip() or "—"
                md.append(f"{i}. **{name}** _({' · '.join(flags)}, score {int(r['_score'])})_")
                md.append(f"   > {r['review'].strip()}")
                if r["img"].strip():
                    md.append(f"   > 📷 {r['img'].strip()}")
                md.append("")
            if len(top) < 10:
                md.append(f"> ⚠️ Only {len(top)} reviews available — {10-len(top)} short of a full top-10.\n")

    (OUT_DIR / "top-reviews-per-product.md").write_text("\n".join(md), encoding="utf-8")

    # ---- json companion (for later Loox featuring automation) ----
    jdump = {}
    for fam, d in fams:
        if d["tier"] == "other":
            continue
        jdump[d["display"]] = {
            "tier": d["tier"], "pooled": len(d["reviews"]),
            "source_handles": sorted({r["_src"] for r in d["reviews"]}),
            "top10": [{
                "id": r["id"], "rating": r["rating"], "verified": r["verified_purchase"] == "true",
                "has_photo": bool(r["img"].strip()), "img": r["img"].strip(),
                "name": r["full_name"].strip(), "date": r["date"][:10],
                "src_handle": r["_src"], "score": int(r["_score"]), "review": r["review"].strip(),
            } for r in d["reviews"][:10]],
        }
    (OUT_DIR / "top-reviews-per-product.json").write_text(json.dumps(jdump, ensure_ascii=False, indent=2), encoding="utf-8")

    # console summary
    print("wrote:", OUT_DIR / "top-reviews-per-product.md")
    print("wrote:", OUT_DIR / "top-reviews-per-product.json")
    print()
    print(f"{'PRODUCT':<34}{'pooled':>7}{'qual>=80':>9}{'photo':>7}  fill")
    for fam, d in fams:
        if d["tier"] != "hero":
            continue
        n = len(d["reviews"]); q = sum(1 for r in d["reviews"] if r["_score"] >= 80)
        ph = sum(1 for r in d["reviews"] if r["img"].strip())
        print(f"{d['display']:<34}{n:>7}{q:>9}{ph:>7}  {'ok' if n>=10 else 'SHORT('+str(n)+')'}")

if __name__ == "__main__":
    main()
