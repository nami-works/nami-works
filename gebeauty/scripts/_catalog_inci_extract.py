"""Extract label-truth INCI per core product from NON-SECRET files only.

GUARDIAN RULE: hard-excludes formulacoes/ precificacao/ orcamentos/ and any
FÓRMULA-signed file. Reads only packaging/claims/ANVISA-notification/release
files. Extracts the QUALITATIVE INCI name list only; never percentages.

Runs in the trusted main session (not agents). pdftotext (text layer) + docx
(zip/xml) extraction, per-file timeout. Files with no text layer are flagged
for a visual pass. Output: _catalog_inci_labeltruth.out.json
"""
import json
import re
import subprocess
import zipfile
from pathlib import Path

BASE = Path("G:/Drives compartilhados/GEB_Produto")
HERE = Path(__file__).resolve().parent

SECRET = re.compile(r"(formulacoes|precifica|orcamento|F[ÓO]RMULA ASSINADA|F[ÓO]RMULA)", re.I)
# folder per core SKU
FOLDER = {
    "GEB 001": "shampoo-sem-sulfato", "GEB 002": "mascara-condicionadora",
    "GEB 003": "leave-in-com-protecao-termica", "GEB 008": "shampoo-a-seco",
    "GEB 019": "booster-fortificante", "GEB 020": "booster-hidratante",
    "GEB 021": "booster-definicao", "GEB 022": "booster-antifrizz",
    "GEB 023": "booster-antioxidante", "GEB 101": "primer-cachos-definidos",
    "GEB 102": "primer-liso-intacto", "GEB 120": "leave-in-pluma",
    "GEB 121": "mascara-mayday", "GEB 024": "melon-mood-body-hair-splash",
}
# name heuristics -> files that most likely carry a real TEXT LAYER with INCI
GOOD = re.compile(r"(claims|ativos|inci|composi|ingredient|release|informa|"
                  r"protocolo|anvisa|petic|peti[çc]|fispq|texto|V15)", re.I)
# pure artwork / cost files: no text layer or off-limits — skip entirely
SKIP = re.compile(r"(AF_|Faca|vetor|VETOR|EG_INCOM|GABARITO|Arcade|cost|custo|MOQ|"
                  r"ADESIVO|R[ÓO]TULO|TOPO|\bPACK\b|Cartucho|SAQUINHO|tampa|"
                  r"Corre[çc][ãa]o|Altera[çc])", re.I)
INCI_HINT = re.compile(r"(ingredient|composi[cç][aã]o|\bINCI\b|\b(Aqua|Water|Alcohol)\b\s*,)", re.I)


def docx_text(p):
    try:
        with zipfile.ZipFile(p) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
        return re.sub(r"<[^>]+>", " ", xml)
    except Exception:
        return ""


def pdf_text(p):
    try:
        r = subprocess.run(["pdftotext", "-f", "1", "-l", "4", str(p), "-"],
                           capture_output=True, timeout=15)
        return r.stdout.decode("utf-8", "ignore")
    except Exception:
        return ""


def find_inci(txt):
    """Pull a plausible INCI list; strip anything that looks like a percentage."""
    if not txt:
        return None
    flat = re.sub(r"\s+", " ", txt)
    # forbid returning quantitative data
    if re.search(r"\d{1,2}[.,]\d{1,3}\s?%", flat):
        flat = re.sub(r"\d{1,2}[.,]\d{1,3}\s?%", "[pct-redacted]", flat)
    m = re.search(r"(Ingredient[es]*|Composi[cç][aã]o|INCI)[:\s]+([A-Z][A-Za-z0-9 ,/()\-\.]{40,600})", flat)
    if m:
        return m.group(0)[:600]
    m = re.search(r"\b(Aqua|Water)\b\s*,[A-Za-z0-9 ,/()\-\.]{40,600}", flat)
    return m.group(0)[:600] if m else None


def candidates(folder):
    root = BASE / folder
    if not root.exists():
        return []
    files = []
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in (".pdf", ".docx"):
            continue
        rel = str(p.relative_to(BASE))
        if SECRET.search(rel) or SKIP.search(p.name):
            continue
        if p.stat().st_size > 8_000_000:  # skip heavy artwork
            continue
        is_docx = p.suffix.lower() == ".docx"
        if not is_docx and not GOOD.search(p.name):
            continue  # PDFs: only try ones likely to have a text layer
        # docx are cheap text; always try. prefer named-good, de-prioritize dups
        score = (2 if GOOD.search(p.name) else (1 if is_docx else 0)) - (1 if "_dup" in p.name else 0)
        files.append((score, p))
    files.sort(key=lambda x: -x[0])
    return [p for _, p in files[:5]]


def main():
    out = {}
    for sku, folder in FOLDER.items():
        got, src, tried = None, None, []
        for p in candidates(folder):
            tried.append(p.name)
            txt = docx_text(p) if p.suffix.lower() == ".docx" else pdf_text(p)
            inci = find_inci(txt)
            if inci:
                got, src = inci, str(p.relative_to(BASE))
                break
        out[sku] = {"folder": folder, "inci_labeltruth": got, "source_file": src,
                    "needs_visual": got is None, "files_tried": tried}
        flag = "OK  " if got else "VIS "
        print(f"{flag}{sku} {folder:32} <- {src or 'no text layer; needs visual'}")

    (HERE / "_catalog_inci_labeltruth.out.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    vis = [s for s, v in out.items() if v["needs_visual"]]
    print(f"\nextracted: {len(out)-len(vis)}/{len(out)} | needs visual pass: {vis}")


if __name__ == "__main__":
    main()
