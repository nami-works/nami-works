"""Dry-render store-credit__notification.liquid for all three contexts (python-liquid).

Regenerates the *_preview.html eyeball files in this directory so they always match
the live template. Run this after any edit to store-credit__notification.liquid.

Usage: "C:/Python314/python.exe" render_previews.py
"""
from pathlib import Path
from liquid import Environment

TEMPLATE_PATH = Path(__file__).parent / "store-credit__notification.liquid"
SUBJECT_PATH = Path(__file__).parent / "store-credit__notification.subject.liquid"
OUT_DIR = TEMPLATE_PATH.parent

REAL_SHOP_EMAIL = "sac@gebeauty.com.br"  # confirmed via GraphQL `shop { email }`, 2026-07-31
REAL_LOGO_URL = "https://cdn.shopify.com/s/files/1/0807/8344/2240/files/ge_beauty_logo_horizontal.png?v=1777325446"

env = Environment()


def money_filter(val):
    return f"R$ {val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def money_without_trailing_zeros_filter(val):
    s = money_filter(val)
    return s[:-3] if s.endswith(",00") else s


def date_filter(val, **kwargs):
    months = ["janeiro", "fevereiro", "mar\u00e7o", "abril", "maio", "junho", "julho",
              "agosto", "setembro", "outubro", "novembro", "dezembro"]
    y, m, d = [int(x) for x in str(val).split("-")]
    return f"{d} de {months[m - 1]} de {y}"


def shopify_asset_url_filter(val):
    return f"/assets/{val}"


env.filters["money"] = money_filter
env.filters["money_without_trailing_zeros"] = money_without_trailing_zeros_filter
env.filters["date"] = date_filter
env.filters["shopify_asset_url"] = shopify_asset_url_filter

template = env.from_string(TEMPLATE_PATH.read_text(encoding="utf-8"))
subject_template = env.from_string(SUBJECT_PATH.read_text(encoding="utf-8").strip())

BASE_SHOP = {
    "url": "https://www.gebeauty.com.br",
    "email": REAL_SHOP_EMAIL,
    "email_logo_url": REAL_LOGO_URL,
    "email_logo_width": 120,
    "email_accent_color": "#DF3630",
    "name": "GE Beauty",
}

SCENARIOS = [
    {
        "file": "store-credit__still-active_preview.html",
        "customer": {"first_name": "Lucas", "tags": [], "orders_count": 1},
        "issued_store_credit": {"amount": 50.00, "expires_at": "2026-11-15", "balance_after_transaction": 50.00},
    },
    {
        "file": "store-credit__reactivation_preview.html",
        "customer": {"first_name": "Marina", "tags": ["credit-reactivation"], "orders_count": 3},
        "issued_store_credit": {"amount": 45.60, "expires_at": "2026-08-07", "balance_after_transaction": 45.60},
    },
    {
        "file": "store-credit__goodwill_preview.html",
        "customer": {"first_name": "Marina", "tags": ["atraso_extrema-jul-27"], "orders_count": 2},
        "issued_store_credit": {"amount": 45.60, "expires_at": "2026-11-15", "balance_after_transaction": 45.60},
    },
]

for scenario in SCENARIOS:
    ctx = {
        "shop": BASE_SHOP,
        "customer": scenario["customer"],
        "issued_store_credit": scenario["issued_store_credit"],
        "email_title": "Credito",
        "routes": {"account_profile_url": "https://www.gebeauty.com.br/account"},
        "company_location": None,
    }
    subject = subject_template.render(**ctx)
    rendered = template.render(**ctx)
    banner = (
        '<div style="background:#111;color:#fff;font:13px monospace;padding:8px 16px;">'
        f'SUBJECT: {subject}</div>'
    )
    rendered = rendered.replace("<body>", f"<body>{banner}", 1)
    out_path = OUT_DIR / scenario["file"]
    out_path.write_text(rendered, encoding="utf-8")
    print(f"wrote {out_path.name}  subject: {subject}")
