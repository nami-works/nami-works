"""
Export B2B proposal HTML → PDF using Chrome headless.
Picks up @page { size: A4 landscape; } from the HTML CSS.

Run:
  C:/Python314/python.exe sandbox/gebeauty/scripts/_b2b_export_pdf.py
"""
import subprocess, sys, shutil
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

SCRATCHPAD = (
    Path.home()
    / "AppData/Local/Temp/claude"
    / "c--Users-Lucas-Guimar-es-Desktop-nami-works"
    / "a2c061e3-8713-4ea9-b77f-5ab2d67ebe63"
    / "scratchpad"
)

SAND = Path(__file__).resolve().parent.parent
TODAY = datetime.now().strftime("%Y%m%d")

EXPORTS = [
    (
        SCRATCHPAD / "proposta-magenta.html",
        SAND / f"B2B_Proposta_Magenta_{TODAY}.pdf",
    ),
    (
        SCRATCHPAD / "proposta-canonical.html",
        SAND / f"B2B_Proposta_Canonical_{TODAY}.pdf",
    ),
]


def export(html: Path, pdf: Path):
    if not html.exists():
        print(f"  [!] HTML not found: {html.name}")
        return False

    cmd = [
        CHROME,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--print-to-pdf={pdf}",
        "--print-to-pdf-no-header",
        html.as_uri(),
    ]

    print(f"  {html.name} -> {pdf.name}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

    if pdf.exists() and pdf.stat().st_size > 0:
        print(f"  ok ({pdf.stat().st_size // 1024} kB)")
        return True
    else:
        print(f"  [!] failed — {result.stderr[:200]}")
        return False


if __name__ == "__main__":
    for html_path, pdf_path in EXPORTS:
        export(html_path, pdf_path)

    print("\nDone.")
