#!/usr/bin/env python3
"""
keyword_research.py — keyword + question grounding. FREE by default, no API key.

PRIMARY (free, keyless): Google Autocomplete via the public complete/search
endpoint. Expands a seed with PT question-modifiers and the alphabet to surface
real long-tail and conversational (AEO) queries. This is the no-cost default.

OPTIONAL ENRICHMENT (paid): if SERPAPI_API_KEY is set in the tenant .env, also
pulls "related searches" + "People also ask" (data autocomplete can't give
keyless). Absent a key, the script still returns useful free data — it does NOT
no-op.

The /content-director brain's broader research path also uses WebSearch/WebFetch
on live SERPs and competitor content; this script is the structured-suggestion
spine that feeds pass 3.

Usage:
    python keyword_research.py --tenant gebeauty --seed "protecao termica cabelo"
    python keyword_research.py --seed "leave-in" --gl br --hl pt --expand --out kw.json
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
AUTOCOMPLETE_URL = "https://suggestqueries.google.com/complete/search"
SERP_URL = "https://serpapi.com/search.json"

# PT-BR intent/question modifiers — surface conversational + AEO-shaped queries.
PT_MODIFIERS = ["como", "qual", "melhor", "para que serve", "vale a pena",
                "passo a passo", "antes ou depois", "como usar", "qual a diferenca"]


def load_env(tenant: str) -> dict:
    env_path = REPO_ROOT / "sandbox" / tenant / ".env"
    if not env_path.exists():
        return {}
    env = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def autocomplete(query: str, gl: str, hl: str) -> list:
    """Keyless Google Autocomplete. client=firefox returns [query, [suggestions]]."""
    params = {"client": "firefox", "q": query, "hl": hl, "gl": gl}
    url = f"{AUTOCOMPLETE_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
        try:
            data = json.loads(raw.decode("utf-8"))
        except UnicodeDecodeError:
            data = json.loads(raw.decode("latin-1"))
        return data[1] if len(data) > 1 and isinstance(data[1], list) else []
    except Exception as e:
        print(f"   autocomplete error for '{query}': {e}", file=sys.stderr)
        return []


def serp_enrich(seed: str, key: str, gl: str, hl: str) -> dict:
    qs = urllib.parse.urlencode({"api_key": key, "engine": "google", "q": seed,
                                 "gl": gl, "hl": hl, "num": 10})
    try:
        with urllib.request.urlopen(f"{SERP_URL}?{qs}", timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"   SerpAPI enrich error: {e}", file=sys.stderr)
        return {"related_searches": [], "people_also_ask": []}
    return {
        "related_searches": [r["query"] for r in data.get("related_searches", []) if r.get("query")],
        "people_also_ask": [q["question"] for q in data.get("related_questions", []) if q.get("question")],
    }


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="Free keyword + question research (autocomplete; optional SerpAPI).")
    ap.add_argument("--tenant", default="gebeauty")
    ap.add_argument("--seed", required=True)
    ap.add_argument("--gl", default="br")
    ap.add_argument("--hl", default="pt")
    ap.add_argument("--expand", action="store_true",
                    help="also expand with PT question-modifiers + a-e (more long-tails, more requests)")
    ap.add_argument("--out")
    args = ap.parse_args()

    seeds = [args.seed]
    if args.expand:
        seeds += [f"{args.seed} {m}" for m in PT_MODIFIERS]
        seeds += [f"{args.seed} {c}" for c in "abcde"]

    suggestions, seen = [], set()
    for s in seeds:
        for sug in autocomplete(s, args.gl, args.hl):
            low = sug.lower().strip()
            if low and low not in seen:
                seen.add(low)
                suggestions.append(sug)
        time.sleep(0.2)  # be polite to the endpoint

    # Split suggestions into questions vs terms (questions = AEO gold)
    q_starts = ("como", "qual", "quais", "o que", "por que", "porque", "quando",
                "onde", "vale", "quanto", "preciso", "posso")
    questions = [s for s in suggestions if s.lower().startswith(q_starts)]
    terms = [s for s in suggestions if not s.lower().startswith(q_starts)]

    result = {
        "seed": args.seed,
        "source": "google_autocomplete (free)",
        "terms": terms,
        "questions": questions,
        "related_searches": [],
        "people_also_ask": [],
    }

    key = load_env(args.tenant).get("SERPAPI_API_KEY")
    if key:
        enrich = serp_enrich(args.seed, key, args.gl, args.hl)
        result["related_searches"] = enrich["related_searches"]
        result["people_also_ask"] = enrich["people_also_ask"]
        result["source"] += " + serpapi"

    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
        print(f"Wrote {len(terms)} terms + {len(questions)} questions for '{args.seed}' to {args.out}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
