"""Download the 22 generated ingredient-card images (+ alt options) to
gebeauty/ingredient-cards/ with ingredient-named files. Verifies each
download is a real image (size check) and flags failures."""
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "ingredient-cards"
OUT.mkdir(exist_ok=True)
TOKEN = "exp=1783296000"

# slug -> (production id, hmac)
IMG = {
    "manteiga-de-murumuru":       ("4770220216", "f2ef3ce7a775a2929aa3af9479ae8129f1c7f6215eb1d3a76660c30bd679d466"),
    "manteiga-de-murumuru_alt":   ("4770221244", "bd7fd1136f66a51bbf989238b56147e8a4cb20793c757517826b62ed124d4ad9"),
    "oleo-de-girassol":           ("4770283822", "56e81443cfc10092b463b075939fb0be37068d95f70adb6a4e9bb1ada5639555"),
    "oleo-de-girassol_alt":       ("4770284052", "a4f9f73f6ec799b897309d1705e26a14a6e3a6a960cfa9fa454dcb06dc60a1af"),
    "manteiga-de-cupuacu":        ("4770300946", "172a47791dcf6a381cda7bb26c04af60d106d552d12d03d03c37d8d5a97634ad"),
    "oleo-de-abacate":            ("4770300362", "f9585cc82bb6383c05676cbcd8aef3de9e1b5b990cf1ec461a041e790292d816"),
    "oleo-de-macadamia":          ("4770300480", "2ccc01d7f829e038de0f26f76af32c39a80a27ca94e6628e14290dd600db83f4"),
    "oleo-de-gergelim":           ("4770301479", "db723b73fd99000639eb5824ad360eea13ca02f56018c9478e2f89f31e9a0342"),
    "oleo-de-oliva":              ("4770300663", "e98be2fd7c6765e00a18d897f95b53f8fb6d1d190b8b73c881eab2d163c09f5a"),
    "oleo-de-coco":               ("4770301530", "f1355e2ee42781f0627fab88899ed1cde193c273ce762baadcbc07e260d3e4ff"),
    "oleo-de-mamona":             ("4770302356", "50d04c4ce65e45453bf9eb238877229174bf19701996cbaf3044d3183f576914"),
    "crambe":                     ("4770305429", "0a211912dda23c9ecca70c9f2a859397ea4855dff18ba623ffca94ecc738fb69"),
    "chia":                       ("4770307083", "b37f4c4d78a37308d777b8092c9b5e7b5207f577143202d754d1c4066068b511"),
    "linhaca":                    ("4770306114", "ae6e3baf4d14d2f2ddef8c87e569f1360b811d1e3c2cdeacd29d1aa0185ce431"),
    "algas-vermelhas":            ("4770306669", "daa4fcabb0b0ff0ceb3e572dd9eceb3fa18c45f51065e3f7363bfbd019a12a76"),
    "alcacuz":                    ("4770306699", "509e8eedca3f92c199dbe58de5591c482bcac570ffa73574001326da48dd2d3d"),
    "cha-verde":                  ("4770306741", "ba5dcbe1eb83ea98968e1dec4cea7e5133790953fa3b863d383b09c194968a2f"),
    "salvia":                     ("4770306857", "2496bda12ac66f8a4985584184cdbd0ea973c64bdea64daa111e8c5a93f20093"),
    "mentol":                     ("4770307885", "1b1ce151eca7e024adbb189e85ec0f798ebd8cfb381eba75eb125eb47884cd9d"),
    "extrato-de-angico":          ("4770311582", "bb76407c40f7afc526f26083262939e006e59534138a609a2011d877deb42068"),
    "pantenol":                   ("4770310957", "9af749a7c7b581244d42e6e4cbc3fd839b467212ae55d8827382e737396404f7"),
    "arginina":                   ("4770312651", "9b2ec6a45f626636d650f276088ecfd1342553b563b9ba6a242954be5c012dd0"),
    "trehalose":                  ("4770311750", "aa36c901a29ff1bc35080a5d02731524b1a3a6fe00e60db1da8afe8c2d3c7080"),
    "biotina":                    ("4770311659", "6af309b9eeca84fce10987251eec37de40fd3025091381d1c5dcb377862efae"),
}


def main():
    ok, bad = 0, []
    for slug, (pid, hmac) in IMG.items():
        url = f"https://pikaso.cdnpk.net/private/production/{pid}/render.png?token={TOKEN}~hmac={hmac}"
        dest = OUT / f"{slug}.png"
        try:
            urllib.request.urlretrieve(url, dest)
            size = dest.stat().st_size
            if size < 20000:  # too small = error page, not an image
                bad.append((slug, f"tiny {size}b")); print(f"  !! {slug}: only {size} bytes")
            else:
                ok += 1; print(f"  ok {slug}: {size//1024} KB")
        except Exception as e:
            bad.append((slug, str(e))); print(f"  !! {slug}: {e}")
    print(f"\n{ok}/{len(IMG)} downloaded to {OUT}")
    if bad:
        print("FAILED:", bad)


if __name__ == "__main__":
    main()
