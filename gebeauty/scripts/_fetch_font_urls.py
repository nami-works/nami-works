"""One-off: grab live CDN URLs of the Italian Plate font files the storefront serves."""
import re, urllib.request

for URL in ("https://www.gebeauty.com.br/", "https://gebeauty.com.br/"):
    try:
        req = urllib.request.Request(URL, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml",
        })
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
    except Exception as e:
        print(URL, "-> ERROR", e)
        continue
    print(f"\n=== {URL}  ({len(html)} bytes)  ItalianPlate occurrences: {html.count('ItalianPlate')} / font-face: {html.lower().count('@font-face')} ===")
    urls = sorted(set(re.findall(r'(?:(?:https?:)?//|/)[^"\')\s]*ItalianPlate[^"\')\s]*\.(?:woff2|woff|ttf|otf)[^"\')\s]*', html, re.I)))
    for u in urls:
        print(u)
    if not urls:
        i = html.find("ItalianPlate")
        if i != -1:
            print("CONTEXT:", html[max(0, i-200):i+120].replace("\n", " "))
    if urls:
        break
