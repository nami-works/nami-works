"""
extract_email.py - pull clean plaintext out of a saved Gmail thread JSON.

The Gmail `get_thread` MCP tool returns huge HTML newsletters that overflow the token
limit and get saved to a file. This reads that file (or any thread-JSON file) and prints
cleaned, readable plaintext per message, so /digest can read the substance without the
markup bloat.

Usage:
  python extract_email.py <thread.json> [--chars 3200] [--msg N]
"""
import argparse
import html
import json
import re
import sys

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def clean(t):
    t = html.unescape(t or "")
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)                       # strip tags
    t = re.sub(r"\[.*?\]\(https?://[^)]+\)", "", t)       # md links
    t = re.sub(r"https?://\S+", "", t)                    # bare urls
    t = t.encode("ascii", "ignore").decode()               # drop non-ascii noise
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def body(m):
    for k in m:
        if "plain" in k.lower() and isinstance(m[k], str) and m[k].strip():
            return m[k]
    for k in m:
        if "html" in k.lower() and isinstance(m[k], str) and m[k].strip():
            return m[k]
    return m.get("snippet", "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--chars", type=int, default=3200)
    ap.add_argument("--msg", type=int, default=None, help="only this message index")
    args = ap.parse_args()

    d = json.load(open(args.file, encoding="utf-8"))
    msgs = d.get("messages", [d]) if isinstance(d, dict) else d
    idxs = [args.msg] if args.msg is not None else range(len(msgs))
    for i in idxs:
        m = msgs[i]
        hdr = f"[msg {i}] {m.get('sender','')} | {m.get('subject','')} | {m.get('date','')}"
        print("=" * 72 + "\n" + hdr + "\n" + "=" * 72)
        print(clean(body(m))[:args.chars])
        print()


if __name__ == "__main__":
    main()
