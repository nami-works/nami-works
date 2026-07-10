"""
Pure helpers for BEAUTYBACK cashback issuance. No Shopify I/O lives here.

Imported by scripts/cashback_generate.py. Stays stdlib-only except for openpyxl
(used in write_final_xlsx). Keeping this layer free of network calls makes the
math + formatting easy to unit-test or eyeball in isolation.

NOTE: Reconstructed 2026-06-30 from scripts/__pycache__/_cashback_lib.cpython-314.pyc
after the source was lost from disk (untracked file, removed by a tree clean).
Behaviour is byte-faithful to the compiled bytecode; only comments were re-added.
"""

import json
import re
import secrets
import time
from pathlib import Path

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/I/L — unambiguous when read aloud
DEFAULT_PREFIX = "BEAUTYBACK"
GROUP_LEN = 4
GROUP_COUNT = 3
XLSX_HEADERS = ["First Name", "Email", "Telefone oficial", "Cashback", "Compra mínima", "Cupom", "Link"]
STOREFRONT_DISCOUNT_BASE = "https://www.gebeauty.com.br/discount/"


def random_code(prefix: str = DEFAULT_PREFIX) -> str:
    """`BEAUTYBACK-AAAA-BBBB-CCCC` — 3 independent random groups of 4 chars."""
    groups = ["".join(secrets.choice(ALPHABET) for _ in range(GROUP_LEN)) for _ in range(GROUP_COUNT)]
    return f"{prefix}-{'-'.join(groups)}"


_NON_DIGITS = re.compile(r"\D")


def normalize_phone_br(raw: str) -> str:
    """Collapse a BR phone to '+55DDXXXXXXXXX'. Returns '' if unrecognized."""
    if not raw:
        return ""
    digits = _NON_DIGITS.sub("", raw)
    if not digits:
        return ""
    if digits.startswith("55") and len(digits) in (12, 13):
        return f"+{digits}"
    if len(digits) in (10, 11):
        return f"+55{digits}"
    return ""


def compute_cashback(subtotal: float, cashback_pct: float) -> float:
    return float(subtotal) * cashback_pct


def compute_min_purchase(cashback: float, redeem_pct: float) -> float:
    return cashback / redeem_pct


def pick_discount_type(min_purchase: float, min_purchase_cap: float) -> str:
    """'fixed' below or equal to the cap, 'percentage' above."""
    if min_purchase <= min_purchase_cap:
        return "fixed"
    return "percentage"


def build_discount_input(
    code: str,
    title: str,
    starts_at_iso: str,
    ends_at_iso: str,
    discount_type: str,
    cashback: float,
    min_purchase: float,
    redeem_pct: float,
) -> dict:
    """Return the DiscountCodeBasicInput dict for `discountCodeBasicCreate`.

    Shape mirrors the historical BEAUTYBACK-46M1 cohort except for the title:
    we use a per-customer admin label (e.g. 'Beauty Back | <email>') so admins
    can scan attribution at a glance, while `code` stays the random body the
    customer types. Other fields: appliesOncePerCustomer=true alongside
    usageLimit=1, and percentage codes carry a R$ 0.01 minimum (the convention
    Shopify's UI emits for percentage codes — kept for parity even though
    Shopify accepts null here).
    """
    payload = {
        "title": title,
        "code": code,
        "startsAt": starts_at_iso,
        "endsAt": ends_at_iso,
        "customerSelection": {"all": True},
        "customerGets": {"items": {"all": True}, "value": None},
        "combinesWith": {
            "orderDiscounts": True,
            "productDiscounts": True,
            "shippingDiscounts": True,
        },
        "appliesOncePerCustomer": True,
        "usageLimit": 1,
    }
    if discount_type == "fixed":
        payload["customerGets"]["value"] = {
            "discountAmount": {"amount": f"{cashback:.2f}", "appliesOnEachItem": False}
        }
        payload["minimumRequirement"] = {
            "subtotal": {"greaterThanOrEqualToSubtotal": f"{min_purchase:.2f}"}
        }
    else:
        payload["customerGets"]["value"] = {"percentage": redeem_pct}
        payload["minimumRequirement"] = {
            "subtotal": {"greaterThanOrEqualToSubtotal": "0.01"}
        }
    return payload


def storefront_link(code: str) -> str:
    return f"{STOREFRONT_DISCOUNT_BASE}{code}"


def admin_link_from_gid(code_gid: str, shop_handle: str) -> str:
    """gid://shopify/DiscountCodeNode/123 → admin.shopify.com/store/<shop>/discounts/123."""
    numeric = code_gid.rsplit("/", 1)[-1]
    return f"https://admin.shopify.com/store/{shop_handle}/discounts/{numeric}"


def write_final_xlsx(rows: list, output_path: str) -> None:
    """Overwrite `output_path` with a single 'final' sheet matching XLSX_HEADERS."""
    import openpyxl

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "final"
    ws.append(XLSX_HEADERS)
    for row in rows:
        ws.append(row)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)


def load_env(env_path) -> dict:
    """Tiny .env parser: KEY=VALUE per line, # comments, no quoting."""
    env = {}
    for line in Path(env_path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def load_state(state_path) -> dict:
    p = Path(state_path)
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def save_state(state, state_path) -> None:
    p = Path(state_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    # Atomic write: dump to .tmp then replace. Windows can hold a transient lock
    # (AV / Drive sync), so retry the replace a few times before giving up.
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    for attempt in range(6):
        try:
            tmp.replace(p)
            return
        except PermissionError:
            time.sleep(0.1)
