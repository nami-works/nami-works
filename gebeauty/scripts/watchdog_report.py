"""Watchdog report runner — daily exception-report + weekly fixed-digest, emailed via SES.

Part of initiative .claude/initiatives/gebeauty-storefront-rules-watchdog.md (phase 4).

Modes:
  --mode daily   (cron 09:00 BRT) refresh discount audit -> auto-fix combine drift on
                 CODE discounts -> run full storefront audit -> email lucas@ ONLY if a
                 HIGH or NORMAL inconsistency remains. Silent when clean (LOW-only days
                 send nothing — no daily "all OK" noise). Logs the flip count.
  --mode weekly  (cron Mon 09:00 BRT) email a digest of discounts fixed over the last 7
                 days (from the flip-log). Always sent.

Live actions (the fix `--apply` AND the SES send) are gated behind --live. Without it the
run is a full dry-run: fix runs in preview, audit is read-only, the email is printed not
sent, and nothing is logged. Safe to run ad-hoc for testing.

SES: from == to == lucas@gebeauty.com.br (single verified identity; works in SES sandbox
because sender and recipient are the same verified address). boto3 imported lazily so dry
runs need no AWS deps.
"""
import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
PY = sys.executable
FLIP_LOG = HERE.parent / "inputs" / "combine_flip_log.jsonl"
FROM_ADDR = TO_ADDR = "lucas@gebeauty.com.br"
SES_REGION = "us-east-1"


def run(script_args):
    # errors="replace": child scripts emit cp1252 accented titles; parsed fields are ASCII
    return subprocess.run([PY, *script_args], cwd=str(HERE), capture_output=True,
                          text=True, encoding="utf-8", errors="replace")


def deliver(subject, body, live):
    if not live:
        print("=" * 60)
        print(f"[DRY EMAIL] From: {FROM_ADDR}  To: {TO_ADDR}")
        print(f"Subject: {subject}\n\n{body}")
        print("=" * 60)
        return
    import boto3  # lazy: only needed for a real send
    ses = boto3.client("ses", region_name=SES_REGION)
    ses.send_email(
        Source=FROM_ADDR,
        Destination={"ToAddresses": [TO_ADDR]},
        Message={"Subject": {"Data": subject}, "Body": {"Text": {"Data": body}}},
    )
    print(f"[SES] sent to {TO_ADDR}: {subject}")


def daily(live):
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    today = datetime.now().strftime("%Y-%m-%d")

    # 1. refresh the discount audit JSON so the fix tool sees today's inventory
    run(["audit_discount_shipping_combine.py"])

    # 2. auto-remediate combine drift on CODE discounts (app-owned + free-ship Function left alone)
    fix_args = ["fix_discount_shipping_combine.py", "--all", "--no-app"] + (["--apply"] if live else [])
    fx = run(fix_args)
    if live:
        m = re.search(r"updated:\s*(\d+)", fx.stdout)
        flipped = int(m.group(1)) if m else 0
        with open(FLIP_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps({"date": today, "flipped": flipped}) + "\n")
    else:
        m = re.search(r"matched targets:\s*(\d+)", fx.stdout)
        flipped = int(m.group(1)) if m else 0  # would-flip count in dry mode

    # 3. full storefront audit
    au = run(["audit_storefront_rules.py"])
    sm = re.search(r"SUMMARY high=(\d+) normal=(\d+) low=(\d+)", au.stdout)
    high, normal, low = (int(sm[1]), int(sm[2]), int(sm[3])) if sm else (0, 0, 0)
    print(f"[daily {stamp}] flipped={flipped} high={high} normal={normal} low={low} live={live}")

    # 4. email ONLY if a HIGH or NORMAL inconsistency remains (LOW never triggers)
    if high + normal > 0:
        subject = f"[GE watchdog] {high} alta + {normal} media inconsistencia(s) na loja — {datetime.now():%d/%m}"
        body = (
            f"Varredura diaria de regras da loja — {stamp} BRT.\n"
            f"Descontos corrigidos automaticamente nesta execucao: {flipped}.\n\n"
            f"{au.stdout}"
        )
        deliver(subject, body, live)
    else:
        print("clean (no HIGH/NORMAL) — no email.")


def weekly(live):
    cutoff = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    rows = []
    if FLIP_LOG.exists():
        for line in FLIP_LOG.read_text(encoding="utf-8").splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("date", "") >= cutoff:
                rows.append(r)
    total = sum(r.get("flipped", 0) for r in rows)
    detail = "\n".join(f"  {r['date']}: {r['flipped']} descontos" for r in rows) or "  (nenhuma execucao registrada)"
    subject = f"[GE watchdog] resumo semanal — {total} desconto(s) corrigido(s)"
    body = (
        "Descontos ajustados automaticamente para combinar com o frete gratis, ultimos 7 dias:\n\n"
        f"{detail}\n\nTotal: {total}\n"
    )
    deliver(subject, body, live)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["daily", "weekly"], required=True)
    ap.add_argument("--live", action="store_true", help="Perform real fix --apply AND send via SES (default: dry-run)")
    args = ap.parse_args()
    (daily if args.mode == "daily" else weekly)(args.live)


if __name__ == "__main__":
    main()
