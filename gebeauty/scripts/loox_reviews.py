"""Canonical Loox review source for GE Beauty.

The single entry point for pulling customer reviews. Reviews come LIVE from the
Loox API — there is NO CSV export anymore. The old `gebeauty/data/reviews.csv`
was a 4-5star-only export that hid every negative review (it made products look
flawless); it was deleted 2026-07-23. For concern mining, QA, or any honest read
of sentiment you MUST use this API — it returns all ratings 1-5star.

Env (resolved from gebeauty/.env): LOOX_PUBLIC_STORE_ID, LOOX_API_KEY.
Endpoint: https://api.loox.io/api/v1/store/<id>/product-reviews
  page-based (limit<=100), auth header `X-Api-Secret-Key`.

Usage:
    from loox_reviews import fetch_all, normalize
    raw = fetch_all()                       # every published review, all ratings
    rows = [normalize(r) for r in raw]      # flat dicts (rating/img/review/handle/...)
Run directly for a quick census:  python gebeauty/scripts/loox_reviews.py
"""
from pathlib import Path
import os
import re
import json
import time
import urllib.request

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
_SID = os.environ["LOOX_PUBLIC_STORE_ID"]
_KEY = os.environ["LOOX_API_KEY"]
_BASE = f"https://api.loox.io/api/v1/store/{_SID}/product-reviews"
_UA = "ge-beauty-reviews/1.0"


def fetch_all(max_pages: int = 80) -> list[dict]:
    """Pull the full published review corpus (all ratings) from Loox."""
    out: list[dict] = []
    page = 1
    while True:
        req = urllib.request.Request(
            f"{_BASE}?limit=100&page={page}",
            headers={"X-Api-Secret-Key": _KEY, "Accept": "application/json", "User-Agent": _UA},
        )
        d = json.loads(urllib.request.urlopen(req, timeout=60).read().decode())
        out += d.get("reviews", [])
        if not d.get("pagination", {}).get("hasMore") or page >= max_pages:
            break
        page += 1
        time.sleep(0.3)
    return out


_HANDLE_RE = re.compile(r"/products/([^/?#]+)")


def normalize(r: dict) -> dict:
    """Map a raw Loox review to the flat dict shape the ranking tools consume."""
    prod = r.get("product") or {}
    m = _HANDLE_RE.search(prod.get("url") or "")
    reviewer = r.get("reviewer") or {}
    name = reviewer.get("name") or reviewer.get("nickname") or ""
    img = ""
    for it in (r.get("media") or []):
        if isinstance(it, dict) and it.get("type") == "photo" and it.get("url"):
            img = it["url"]
            break
    reply = r.get("reply") or {}
    return {
        "id": str(r.get("id", "")),
        "rating": str(r.get("rating", "")),
        "img": img,
        "nickname": reviewer.get("nickname") or name,
        "full_name": name,
        "review": r.get("body") or "",
        "date": (r.get("date") or r.get("createdAt") or "")[:10],
        "handle": m.group(1) if m else "",
        "product_name": prod.get("name") or "",
        "verified_purchase": "true" if r.get("verified") else "false",
        "reply": reply.get("body", "") if isinstance(reply, dict) else (reply or ""),
    }


if __name__ == "__main__":
    from collections import Counter

    rows = [normalize(r) for r in fetch_all()]
    print(f"pulled {len(rows)} reviews")
    print("by rating:", dict(sorted(Counter(r["rating"] for r in rows).items())))
    print("with photo:", sum(1 for r in rows if r["img"]))
