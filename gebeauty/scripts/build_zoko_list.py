"""
Curate the BEAUTYBACK base into a Zoko-ready xlsx: curated first name +
international phone + store-credit value.

Reads beautyback-base_jan-apr-2026.xlsx (positional columns, since the base was
written with the library's 7-col header stamp). Emits:
  beautyback-zoko_jan-apr-2026.xlsx
    - sheet 'zoko'      : issuable + has phone  (First Name | Phone | Store Credit)
    - sheet 'no_phone'  : issuable, no phone    (credit still applies; not messageable)
    - sheet 'name_review': every row where the name was sentinel'd or auto-fixed

Name curation rules (per Lucas, 2026-06-30):
  - Title-case; Portuguese particles (de/da/do/das/dos/e) stay lowercase.
  - Drop surnames wrongly typed into the first-name field (Maria Silva -> Maria).
  - Keep genuine compound first names (Maria de Fátima, Ana Carolina).
  - Fix clear typos (Gsbrielle -> Gabrielle) only when a dominant corpus match exists.
  - If a name looks broken but the fix is < 90% certain -> replace with '#gebeautie'.
"""

import math
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

import openpyxl

BASE = Path(__file__).resolve().parent.parent / "beautyback-base_jan-apr-2026.xlsx"
OUT = Path(__file__).resolve().parent.parent / "beautyback-zoko_jan-apr-2026.xlsx"
SENTINEL = "#gebeautie"

PARTICLES = {"de", "da", "do", "das", "dos", "e", "di", "del", "della", "du", "dello", "van", "von", "la", "le"}

# Common BR surnames that frequently get mis-typed into the first-name field.
SURNAMES = {
    "silva", "santos", "souza", "sousa", "oliveira", "pereira", "lima", "costa", "rodrigues",
    "almeida", "nascimento", "ferreira", "carvalho", "gomes", "martins", "rocha", "ribeiro",
    "alves", "monteiro", "mendes", "barbosa", "freitas", "barros", "pinto", "moura", "cardoso",
    "teixeira", "correia", "correa", "cunha", "dias", "castro", "campos", "goncalves", "araujo",
    "vieira", "lopes", "marques", "machado", "moreira", "fernandes", "batista", "ramos", "melo",
    "azevedo", "brandao", "nunes", "cavalcante", "cavalcanti", "andrade", "reis", "borges",
    "farias", "peixoto", "duarte", "guimaraes", "tavares", "coelho", "pires", "figueiredo",
    "nogueira", "miranda", "assis", "leite", "sales", "bezerra", "aguiar", "macedo", "vasconcelos",
    "menezes", "prado", "camargo", "fonseca", "sampaio", "siqueira", "medeiros", "maia", "neves",
    "xavier", "franca", "brito", "matos", "chaves", "domingues", "antunes", "paiva", "quintao",
}

# Tokens that mark a company / non-person record.
COMPANY = {
    "ltda", "ltd", "me", "eireli", "epp", "sa", "s/a", "inc", "global", "logistics", "brasil",
    "transportes", "comercio", "comercial", "distribuidora", "servicos", "importacao", "industria",
    "cosmeticos", "beauty", "store", "shop", "cnpj", "empresa", "company",
}


def deaccent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm(tok):
    return deaccent(tok).lower()


def levenshtein(a, b):
    if abs(len(a) - len(b)) > 2:
        return 3
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def titlecase_token(tok):
    n = norm(tok)
    if n in PARTICLES:
        return n
    # keep the accented original but fix casing
    return tok[:1].upper() + tok[1:].lower() if tok else tok


def load_rows():
    wb = openpyxl.load_workbook(BASE)
    ws = wb.active
    rows = [r for r in ws.iter_rows(min_row=2, values_only=True)]
    # positional: 0 name, 1 email, 2 phone, 6 cashback, 9 issuable, 10 customer gid
    return [
        {"name": r[0], "email": r[1], "phone": r[2], "credit": r[6],
         "issuable": r[9], "gid": r[10] if len(r) > 10 else ""}
        for r in rows
    ]


SHOP_HANDLE = "ge-beauty-cosmeticos"


def admin_customer_link(gid):
    """gid://shopify/Customer/123 -> clickable admin customer-page HYPERLINK formula."""
    if not gid:
        return ""
    numeric = str(gid).rsplit("/", 1)[-1]
    url = f"https://admin.shopify.com/store/{SHOP_HANDLE}/customers/{numeric}"
    return f'=HYPERLINK("{url}","abrir")'


def fmt_credit(v):
    """Display value: floor to whole reais, prefix R$, as text (e.g. 246.84 -> 'R$246')."""
    return f"R${math.floor(float(v))}"


def write_credit(ws, col):
    """Reformat an already-appended numeric Store Credit column to floored R$ text."""
    for row in range(2, ws.max_row + 1):
        cell = ws.cell(row, col)
        if cell.value is not None and cell.value != "":
            cell.value = fmt_credit(cell.value)
            cell.number_format = "@"


def build_firstname_freq(rows):
    """A token is 'given-name-like' if it appears often as the FIRST token of records."""
    freq = Counter()
    for r in rows:
        nm = (r["name"] or "").strip()
        if nm:
            freq[norm(nm.split()[0])] += 1
    return freq


def curate_name(raw, freq):
    """Return (curated_name, flag) where flag in {'', 'fixed', 'sentinel'}."""
    if not raw or not raw.strip():
        return SENTINEL, "sentinel"
    raw = re.sub(r"\s+", " ", raw.strip())
    toks = raw.split()
    ntoks = [norm(t) for t in toks]

    # Company / junk detection
    if any(t in COMPANY for t in ntoks):
        return SENTINEL, "sentinel"
    if re.search(r"[0-9@_/\\]", raw) or len(deaccent(raw).replace(" ", "")) < 2:
        return SENTINEL, "sentinel"
    # a single non-letter-ish token or all-caps multiword screamer with a surname tail
    if len(toks) >= 4 and all(t.isupper() for t in toks):
        # long ALL-CAPS run is usually a full legal name dumped in the field
        pass  # handled by span logic below; not auto-sentinel

    # Build the first-name span.
    span = [toks[0]]
    i = 1
    given_first = freq.get(ntoks[0], 0)
    while i < len(toks):
        t = ntoks[i]
        if t in PARTICLES:
            # compound like "de Fátima": need a following token
            if i + 1 < len(toks) and ntoks[i + 1] not in SURNAMES:
                span.append(toks[i])
                span.append(toks[i + 1])
                i += 2
                continue
            break
        if t in SURNAMES:
            break
        # keep a second given name only if it reads as a first name (frequent) and
        # we haven't already got a 2-part compound
        if len([s for s in span if norm(s) not in PARTICLES]) < 2 and freq.get(t, 0) >= 5:
            span.append(toks[i])
            i += 1
            continue
        break

    curated = " ".join(titlecase_token(t) for t in span)

    # Garbled leading token -> sentinel (no vowel at all, or 3+ repeated chars).
    lead = norm(span[0])
    if not re.search(r"[aeiou]", lead) or re.search(r"(.)\1\1", lead):
        return SENTINEL, "sentinel"

    # Rare lead token: could be a legit rare name OR a typo. Deterministic code can't
    # tell them apart safely (Brazilian names have countless real variants), so we
    # KEEP the title-cased form and flag it for the LLM judgment pass. No fabricated fix.
    if freq.get(lead, 0) <= 2:
        return curated, "review"

    return curated, ""


FLOOR = 30.0  # store-credit minimum cutoff (R$); customers under this are excluded


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows = load_rows()
    freq = build_firstname_freq(rows)
    # Eligibility is driven by the live cutoff, not the base's stored Issuable flag
    # (the base was computed at the old R$10 floor).
    issuable = [r for r in rows if float(r["credit"]) >= FLOOR]

    # Optional overrides from the LLM judgment pass: {raw_name: curated_or_sentinel}
    overrides = {}
    ov_path = Path(__file__).resolve().parent.parent / "beautyback-name-overrides.json"
    if ov_path.exists():
        import json
        overrides = json.loads(ov_path.read_text(encoding="utf-8"))

    # Three destinations:
    #   named       -> personalized WhatsApp (has phone AND a usable first name)
    #   no_name     -> generic WhatsApp by phone only (name unusable -> #gebeautie)
    #   no_phone    -> credit applies, but not messageable
    named, no_name, no_phone, review = [], [], [], []
    uncertain_names = set()
    stats = Counter()
    for r in issuable:
        curated, flag = curate_name(r["name"], freq)
        if flag == "review":
            uncertain_names.add(r["name"])
            if r["name"] in overrides:
                curated = overrides[r["name"]]
                flag = "llm"
        stats[flag or "clean"] += 1
        credit = round(float(r["credit"]), 2)
        if flag:
            review.append([r["name"], curated, flag, r["phone"] or "", credit])

        has_name = curated != SENTINEL
        if not r["phone"]:
            no_phone.append([curated, r["email"] or "", credit])
        elif has_name:
            named.append([curated, str(r["phone"]), credit, admin_customer_link(r["gid"])])
        else:
            no_name.append([str(r["phone"]), credit])

    # Dump the unique uncertain raw names for the LLM judgment pass.
    if uncertain_names:
        import json
        unc_path = Path(__file__).resolve().parent.parent / "beautyback-uncertain-names.json"
        unc_path.write_text(json.dumps(sorted(uncertain_names), ensure_ascii=False, indent=2), encoding="utf-8")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "zoko_named"
    ws.append(["First Name", "Phone", "Store Credit", "Customer Page"])
    for row in named:
        ws.append(row)

    ws2 = wb.create_sheet("zoko_no_name")
    ws2.append(["Phone", "Store Credit"])
    for row in no_name:
        ws2.append(row)

    ws3 = wb.create_sheet("no_phone")
    ws3.append(["First Name", "Email", "Store Credit"])
    for row in no_phone:
        ws3.append(row)

    ws4 = wb.create_sheet("name_review")
    ws4.append(["Raw Name", "Curated", "Action", "Phone", "Store Credit"])
    for row in review:
        ws4.append(row)

    # Store Credit -> floored "R$<int>" text, per-sheet column position.
    write_credit(ws, 3)    # zoko_named
    write_credit(ws2, 2)   # zoko_no_name
    write_credit(ws3, 3)   # no_phone
    write_credit(ws4, 5)   # name_review

    wb.save(OUT)

    print("=== Zoko list built ===")
    print(f"  floor (cutoff)     : R$ {FLOOR:.2f}")
    print(f"  issuable customers : {len(issuable)}")
    print(f"  zoko_named (name+phone) : {len(named)}")
    print(f"  zoko_no_name (phone only): {len(no_name)}")
    print(f"  no_phone (credit only)  : {len(no_phone)}")
    print(f"  name curation:")
    print(f"    clean/title-cased  : {stats['clean']}")
    print(f"    llm-resolved       : {stats['llm']}")
    print(f"    review (uncertain) : {stats['review']}  (unique: {len(uncertain_names)})")
    print(f"    sentinel #gebeautie: {stats['sentinel']}")
    print(f"  output -> {OUT}")


if __name__ == "__main__":
    main()
