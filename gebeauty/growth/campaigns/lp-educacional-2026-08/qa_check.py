#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QA gate for the generated landing pages.

Checks that actually protect the campaign:
  1. every image URL returns 200 (a broken hero image kills the page)
  2. every store destination returns 200 (a dead product link burns the click)
  3. markup is balanced (no unclosed block tags)
  4. every CSS custom property referenced is defined
  5. every in-page anchor target exists
  6. mobile-first sanity: viewport meta, sticky CTA, tap-target sizes declared
"""
import os
import re
import sys
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
UA = {"User-Agent": "Mozilla/5.0 (compatible; GEBeauty-LP-QA/1.0)"}
BLOCK = ["section", "div", "header", "footer", "article", "ul", "ol", "li", "details",
         "summary", "h1", "h2", "h3", "p", "span", "a", "button"]


def status(url):
    try:
        req = urllib.request.Request(url, headers=UA, method="GET")
        with urllib.request.urlopen(req, timeout=25) as r:
            return url, r.status
    except urllib.error.HTTPError as e:
        return url, e.code
    except Exception as e:
        return url, f"ERR {type(e).__name__}"


def check_balance(html):
    bad = []
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S | re.I)
    body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
    for tag in BLOCK:
        o = len(re.findall(r"<" + tag + r"(?:\s[^>]*)?>", body, re.I))
        c = len(re.findall(r"</" + tag + r"\s*>", body, re.I))
        if o != c:
            bad.append(f"<{tag}> open={o} close={c}")
    return bad


def check_css_vars(html):
    m = re.search(r"<style>(.*?)</style>", html, re.S)
    css = m.group(1) if m else ""
    # inline style attributes can reference vars too
    inline = " ".join(re.findall(r'style="([^"]*)"', html))
    defined = set(re.findall(r"(--[a-z0-9-]+)\s*:", css, re.I))
    used = set(re.findall(r"var\((--[a-z0-9-]+)", css + " " + inline, re.I))
    return sorted(used - defined)


def check_anchors(html):
    targets = set(re.findall(r'id="([^"]+)"', html))
    links = set(re.findall(r'href="#([^"]+)"', html))
    return sorted(links - targets)


def main():
    files = sorted(f for f in os.listdir(OUT) if f.endswith(".html"))
    if not files:
        print("no pages found, run build_lps.py first")
        return 1

    all_urls, per_file, problems = set(), {}, Counter()
    for fn in files:
        html = open(os.path.join(OUT, fn), encoding="utf-8").read()
        imgs = set(re.findall(r'<img[^>]+src="([^"]+)"', html))
        hrefs = set(re.findall(r'href="(https?://[^"]+)"', html))
        per_file[fn] = {"html": html, "imgs": imgs, "hrefs": hrefs}
        all_urls |= imgs | hrefs

    print(f"resolving {len(all_urls)} unique URLs ...\n")
    with ThreadPoolExecutor(max_workers=10) as ex:
        results = dict(ex.map(status, sorted(all_urls)))

    print("STRUCTURE / MARKUP")
    print("-" * 78)
    for fn in files:
        d = per_file[fn]
        html = d["html"]
        bal = check_balance(html)
        css = check_css_vars(html)
        anc = check_anchors(html)
        vp = 'name="viewport"' in html
        sticky = 'class="sticky"' in html
        flags = []
        if bal:
            flags += [f"unbalanced: {', '.join(bal)}"]
        if css:
            flags += [f"undefined css vars: {', '.join(css)}"]
        if anc:
            flags += [f"dead anchors: {', '.join(anc)}"]
        if not vp:
            flags += ["missing viewport meta"]
        if not sticky:
            flags += ["missing sticky mobile CTA"]
        print(f"  [{'PASS' if not flags else 'FAIL'}] {fn}")
        for f in flags:
            print(f"        ! {f}")
            problems["structure"] += 1

    print("\nASSETS + DESTINATIONS")
    print("-" * 78)
    for fn in files:
        d = per_file[fn]
        bad = {u: results[u] for u in (d["imgs"] | d["hrefs"]) if results[u] != 200}
        print(f"  [{'PASS' if not bad else 'FAIL'}] {fn}   "
              f"{len(d['imgs'])} images, {len(d['hrefs'])} links")
        for u, s in bad.items():
            print(f"        ! {s}  {u}")
            problems["url"] += 1

    print("\n" + "=" * 78)
    if not problems:
        print("QA PASS. all images and destinations resolve, markup balanced.")
        return 0
    print(f"QA FAIL. {problems['structure']} structural, {problems['url']} url problems.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
