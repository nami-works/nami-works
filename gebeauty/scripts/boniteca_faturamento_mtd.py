"""
Boniteca fee base — real-time month-to-date faturamento + tier verdict.

Architecture (Lucas, 2026-06-30): Omie NF-e per channel + POS added separately.
  Omie NF-e (mod 55), all 6 accounts, sale CFOP + cosmetic NCM, (vProd - vDesc):
      e-commerce + local delivery + Amazon 1P + B2B/marketplace
  Shopify POS (sourceName pos + IGLU 206755758081): the walk-in retail / NFC-e
      layer that Omie's NF-e endpoint does NOT return. Formula = productType
      'product', net of refunds, shipping excluded.
  base = Omie gross formula sales + Shopify POS formula (net)

PROVISIONAL (not yet calibrated against a reported month):
  - returns: Omie return CFOPs are polluted by industrializacao/transfer legs, so
    they are reported as a memo line, NOT deducted, until calibration.
  - Shopify channels tiktok + 316281618433 post NF-e to Omie (confirmed by Lucas
    2026-06-30), so they are ALREADY in the Omie pull. Reported as a Shopify
    cross-check memo but NEVER added, to avoid double-counting.

Usage:  python boniteca_faturamento_mtd.py [MM/YYYY]   (default: current month MTD)
Read-only. Slow (~5-7 min) due to Omie's one-request-per-method throttle.
"""
import json, sys, time, urllib.request, urllib.error
from collections import defaultdict, Counter
from datetime import date
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
NF_URL = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
_RETRY = ("requisi", "consumo", "soap-env:server", "redundante", "number of requests", "aguarde")

FORMULA_NCM = ("3303", "3304", "3305", "3306", "3307")
AMZ_ROOT = "15436940"
GE_OWN_ROOT = "34987157"   # GE's own CNPJ root: dest = inter-branch transfer, NOT faturamento
NONSALE_DEST = {"36193378000104"}  # confirmed non-sales (Lucas): Amanda Piquet (permuta/brinde, not faturamento)
POS_SOURCES = {"pos", "206755758081"}            # Shopify POS + IGLU POS (NFC-e layer, add)
XCHECK_SOURCES = {"tiktok", "316281618433"}      # post NF-e to Omie -> already in base; memo only, never add

SALE_CFOP = {
    "5101","5102","5103","5104","5105","5106","5109","5110","5111","5112","5113","5114",
    "5115","5116","5117","5118","5119","5120","5122","5123","5124","5125",
    "5401","5402","5403","5405","5408","5409","5411","5929",
    "6101","6102","6103","6104","6105","6106","6107","6108","6109","6110","6118","6119",
    "6122","6123","6124","6401","6402","6403","6404","6408","6409","6929",
}
RETURN_CFOP = {"1201","1202","1203","1410","1411","2201","2202","2203","2410","2411"}

TIERS = [(0,0.10),(500000,0.09),(750000,0.08),(1000000,0.075),
         (1250000,0.065),(1500000,0.06),(2000000,0.05)]


# ---------- env ----------
def load_omie_connections(path):
    conns, label, pending = [], None, {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("##"):
            label, pending = s.lstrip("#").strip(), {}; continue
        if s.startswith("#") or "=" not in s: continue
        k, v = (x.strip() for x in s.split("=", 1))
        if k.startswith("OMIE_APP_KEY_"): pending["app_key"] = v
        elif k.startswith("OMIE_APP_SECRET_"): pending["app_secret"] = v
        if "app_key" in pending and "app_secret" in pending:
            conns.append({"label": label, **pending}); pending = {}
    return conns


def load_env_flat(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1); env.setdefault(k.strip(), v.strip())
    return env


def dig(s): return "".join(c for c in (s or "") if c.isdigit())
def is_formula(ncm): return (ncm or "").replace(".", "").startswith(FORMULA_NCM)


# ---------- Omie ----------
def omie_call(ak, as_, param, retries=7):
    body = json.dumps({"app_key": ak, "app_secret": as_, "call": "ListarNF", "param": [param]}).encode()
    for attempt in range(retries):
        time.sleep(1.0)
        try:
            req = urllib.request.Request(NF_URL, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            txt = e.read().decode("utf-8", "replace")
            if any(m in txt.lower() for m in _RETRY): time.sleep(10.0*(attempt+1)); continue
            return {"_error": txt}
        except (urllib.error.URLError, OSError):
            time.sleep(5.0*(attempt+1))
    return {"_error": "exhausted"}


def omie_faturamento(d_lo, d_hi):
    conns = load_omie_connections(ENV_PATH)
    g = {"consumer": 0.0, "b2b": 0.0, "amazon": 0.0, "ret": 0.0, "acc": 0.0, "excl": 0.0, "transfer": 0.0}
    for c in conns:
        ak, as_ = c["app_key"], c["app_secret"]
        page, total_pages = 1, None
        e = defaultdict(float)
        while True:
            res = omie_call(ak, as_, {"pagina": page, "registros_por_pagina": 50,
                                      "apenas_importado_api": "N", "dEmiInicial": d_lo, "dEmiFinal": d_hi})
            if "_error" in res:
                print(f"  [omie:{c['label']}] p{page} ERR {res['_error'][:60]}", file=sys.stderr); break
            if total_pages is None:
                total_pages = res.get("total_de_paginas") or 1
            for nf in res.get("nfCadastro") or []:
                ide = nf.get("ide", {})
                if (ide.get("dCan") or "").strip() or ide.get("cDeneg") == "S" or (ide.get("dInut") or "").strip():
                    continue
                tp = str(ide.get("tpNF"))
                dest = dig(nf.get("nfDestInt", {}).get("cnpj_cpf", ""))
                own = dest.startswith(GE_OWN_ROOT) or dest in NONSALE_DEST   # transfer / confirmed non-sale
                amz, cnpj = dest.startswith(AMZ_ROOT), len(dest) == 14
                for d in nf.get("det", []):
                    p = d.get("prod", {})
                    cfop = str(p.get("CFOP", "")).replace(".", "")
                    net = float(p.get("vProd", 0) or 0) - float(p.get("vDesc", 0) or 0)
                    if not is_formula(p.get("NCM")):
                        if tp == "1" and cfop in SALE_CFOP and not own: e["acc"] += net
                        continue
                    if tp == "1" and cfop in SALE_CFOP:
                        if own: e["transfer"] += net          # GE -> GE branch; excluded from base
                        else: e["amazon" if amz else ("b2b" if cnpj else "consumer")] += net
                    elif tp == "1":
                        e["excl"] += net
                    elif tp == "0" and cfop in RETURN_CFOP and not own:
                        e["ret"] += net
            if page >= (total_pages or 1): break
            page += 1
        for k in g: g[k] += e[k]
        print(f"  [omie:{c['label']:15s}] consumer R${e['consumer']:>11,.0f}  b2b R${e['b2b']:>9,.0f}  "
              f"amazon R${e['amazon']:>8,.0f}", flush=True)
    return g


# ---------- Shopify POS ----------
SHOP_Q = """
query($first:Int!,$after:String,$q:String){
 orders(first:$first, after:$after, query:$q, sortKey:CREATED_AT){
  pageInfo{hasNextPage endCursor}
  nodes{ sourceName cancelledAt displayFinancialStatus
   lineItems(first:50){nodes{ discountedTotalSet{shopMoney{amount}} product{productType} }}
   refunds{refundLineItems(first:50){nodes{ subtotalSet{shopMoney{amount}} lineItem{product{productType}} }}}
  }}}"""


def shop_call(env, q, v):
    url = f"https://{env['SHOPIFY_SHOP_DOMAIN']}/admin/api/{env.get('SHOPIFY_API_VERSION','2026-01')}/graphql.json"
    body = json.dumps({"query": q, "variables": v}).encode()
    req = urllib.request.Request(url, data=body,
        headers={"Content-Type": "application/json", "X-Shopify-Access-Token": env["SHOPIFY_ADMIN_ACCESS_TOKEN"]})
    with urllib.request.urlopen(req) as r:
        res = json.loads(r.read().decode())
    if res.get("extensions", {}).get("cost", {}).get("throttleStatus", {}).get("currentlyAvailable", 4000) < 400:
        time.sleep(2)
    return res


def _amt(node, *path):
    cur = node
    for k in path:
        if cur is None: return 0.0
        cur = cur.get(k)
    return float(cur) if cur is not None else 0.0


def shopify_pos(d_lo_iso, d_hi_iso):
    env = load_env_flat(ENV_PATH)
    after = None
    pos_form = 0.0; src = Counter(); xcheck_form = 0.0
    q = f"created_at:>={d_lo_iso} created_at:<={d_hi_iso}"
    while True:
        res = shop_call(env, SHOP_Q, {"first": 100, "after": after, "q": q})
        d = res.get("data", {}).get("orders")
        if not d: break
        for o in d["nodes"]:
            s = o.get("sourceName") or "<null>"
            src[s] += 1
            if o.get("cancelledAt") or o.get("displayFinancialStatus") == "VOIDED": continue
            if s in POS_SOURCES or s in XCHECK_SOURCES:
                net = 0.0
                for li in o.get("lineItems", {}).get("nodes", []):
                    if ((li.get("product") or {}).get("productType")) == "product":
                        net += _amt(li, "discountedTotalSet", "shopMoney", "amount")
                for rf in o.get("refunds", []):
                    for rli in rf.get("refundLineItems", {}).get("nodes", []):
                        if (((rli.get("lineItem") or {}).get("product") or {}).get("productType")) == "product":
                            net -= _amt(rli, "subtotalSet", "shopMoney", "amount")
                if s in POS_SOURCES: pos_form += net
                else: xcheck_form += net
        if not d["pageInfo"]["hasNextPage"]: break
        after = d["pageInfo"]["endCursor"]
    return pos_form, xcheck_form, src


# ---------- tier logic ----------
def rate_of(R):
    r = TIERS[0][1]
    for mn, rt in TIERS:
        if R >= mn: r = rt
    return r


def next_threshold(R):
    for mn, _ in TIERS[1:]:
        if mn > R: return mn
    return None


def verdict(base):
    r0 = rate_of(base); fee0 = r0 * base
    T = next_threshold(base)
    print("\n" + "=" * 60)
    print(f"  FATURAMENTO BASE (MTD)  R$ {base:,.2f}")
    print(f"  Faixa atual: {r0*100:.2f}%   Fee no fechamento atual: R$ {fee0:,.2f}")
    if T is None:
        print("  Faixa maxima (5%). Sem limite acima."); print("=" * 60); return
    r1 = rate_of(T); fee_cross = r1 * T; saving = fee0 - fee_cross; gap = T - base
    floor = max((mn for mn, _ in TIERS if mn <= base), default=0)
    print(f"  Proximo limite: R$ {T:,.0f}  (faltam R$ {gap:,.2f})")
    print(f"  Se cruzar: fee {r0*100:.2f}% -> {r1*100:.2f}%  =>  R$ {fee0:,.2f} -> R$ {fee_cross:,.2f}")
    if saving > 0:
        print(f"  >>> ANTECIPAR E CRUZAR: economia de R$ {saving:,.2f} no mes "
              f"(vale se da para faturar +R$ {gap:,.2f}).")
    else:
        print(f"  >>> NAO VALE CRUZAR AGORA: cruzar {T:,.0f} custaria R$ {-saving:,.2f} A MAIS.")
        print(f"      Posicao boa: logo acima do piso de R$ {floor:,.0f} a {r0*100:.2f}%. "
              f"Segurar; so cruzar se a receita chegar perto de R$ {T:,.0f}.")
    print("=" * 60)


def main():
    today = date.today()
    if len(sys.argv) > 1:
        mm, yyyy = sys.argv[1].split("/"); mm, yyyy = int(mm), int(yyyy)
    else:
        mm, yyyy = today.month, today.year
    d_hi_date = today if (mm == today.month and yyyy == today.year) else date(yyyy, mm, 28)
    d_lo, d_hi = f"01/{mm:02d}/{yyyy}", d_hi_date.strftime("%d/%m/%Y")
    lo_iso, hi_iso = f"{yyyy}-{mm:02d}-01", d_hi_date.isoformat()

    print(f"Boniteca faturamento — MTD {d_lo}..{d_hi}\n--- Omie NF-e ---")
    g = omie_faturamento(d_lo, d_hi)
    print("\n--- Shopify POS (NFC-e layer) ---")
    pos_form, xcheck_form, src = shopify_pos(lo_iso, hi_iso)

    omie_sales = g["consumer"] + g["b2b"] + g["amazon"]
    base = omie_sales + pos_form

    print("\n================ COMPOSICAO (formula, mercadoria - desconto) ================")
    print(f"  Omie e-commerce + LD (consumer)  R$ {g['consumer']:>13,.2f}")
    print(f"  Omie B2B / marketplace           R$ {g['b2b']:>13,.2f}")
    print(f"  Omie Amazon 1P                   R$ {g['amazon']:>13,.2f}")
    print(f"  Shopify POS (pos + IGLU)         R$ {pos_form:>13,.2f}")
    print(f"  --------------------------------------------------")
    print(f"  BASE (incluida)                  R$ {base:>13,.2f}")
    print(f"\n  memo  transfer/nao-venda (excluidas)     R$ {g['transfer']:,.2f}  (intra-GE 34987157 + NONSALE_DEST)")
    print(f"  memo  acessorios excluidos (Omie)        R$ {g['acc']:,.2f}")
    print(f"  memo  devolucoes Omie (NAO deduzido*)    R$ {g['ret']:,.2f}   *CFOP polui com industrializacao")
    print(f"  xchk  Shopify tiktok+316281618433        R$ {xcheck_form:,.2f}  (postam NF-e na Omie; ja na base, memo)")
    print(f"  Shopify sourceNames: {dict(src)}")

    verdict(base)


if __name__ == "__main__":
    main()
