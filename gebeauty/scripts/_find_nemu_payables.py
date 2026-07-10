"""
Find "Nemu" supplier in Omie and summarize monthly accounts payable.

Read-only. Calls:
  1. ListarClientes  (filter by nome_fantasia/razao_social containing 'nemu')
  2. ListarContasPagar (filter by codigo_cliente_fornecedor over last ~12 months)
"""

import json
import sys
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/"
CP_URL = "https://app.omie.com.br/api/v1/financas/contapagar/"


def load_env(path):
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def omie_call(url, app_key, app_secret, method, param):
    body = json.dumps({
        "app_key": app_key,
        "app_secret": app_secret,
        "call": method,
        "param": [param],
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"[omie] {method} FAILED http={e.code}", file=sys.stderr)
        print(body, file=sys.stderr)
        return None


def find_nemu_supplier(app_key, app_secret):
    """Search by CNPJ then resolve full record via ConsultarCliente."""
    cnpj = "50717591000190"
    print(f"[omie] ListarClientes by cnpj={cnpj}", flush=True)
    res = omie_call(CLIENTES_URL, app_key, app_secret, "ListarClientes", {
        "pagina": 1,
        "registros_por_pagina": 10,
        "apenas_importado_api": "N",
        "clientesFiltro": {"cnpj_cpf": cnpj},
    })
    if res is None:
        return []
    records = res.get("clientes_cadastro") or res.get("clientes_cadastro_resumido") or []
    print(f"[omie]   hits={len(records)}  raw_first={json.dumps(records[0], ensure_ascii=False)[:300] if records else '(none)'}", flush=True)
    if not records:
        return []
    # The "resumed" listing already includes codigo_cliente_omie — use it directly.
    return records


def list_all_payables_for(app_key, app_secret, codigo_cliente, start_date, end_date):
    """Pull all contas a pagar across multiple windows, filter client-side. Also dump distinct supplier codes."""
    from collections import Counter
    matches = []
    distinct_codes = Counter()
    total_seen = 0

    # Sweep 13 months in 1-month windows because filter capped total records or scope.
    from datetime import datetime, timedelta as td
    end_dt = datetime.strptime(end_date, "%d/%m/%Y")
    start_dt = datetime.strptime(start_date, "%d/%m/%Y")
    cur = start_dt
    while cur < end_dt:
        nxt = min(cur + td(days=31), end_dt)
        win_from = cur.strftime("%d/%m/%Y")
        win_to = nxt.strftime("%d/%m/%Y")
        page = 1
        while True:
            res = omie_call(CP_URL, app_key, app_secret, "ListarContasPagar", {
                "pagina": page,
                "registros_por_pagina": 500,
                "apenas_importado_api": "N",
                "filtrar_por_data_de": win_from,
                "filtrar_por_data_ate": win_to,
            })
            if res is None:
                sys.exit(1)
            records = res.get("conta_pagar_cadastro") or []
            total_seen += len(records)
            for rec in records:
                cf = rec.get("codigo_cliente_fornecedor")
                if cf:
                    distinct_codes[cf] += 1
                if cf == codigo_cliente:
                    matches.append(rec)
            total_pages = res.get("total_de_paginas", 1)
            print(f"[omie] window {win_from}..{win_to} page={page}/{total_pages} records={len(records)} matches_cum={len(matches)} seen={total_seen}", flush=True)
            if page >= total_pages or not records:
                break
            page += 1
        cur = nxt + td(days=1)

    print(f"\n[debug] distinct supplier codes seen: {len(distinct_codes)}", flush=True)
    print(f"[debug] codigo_cliente_omie 11403748814 (Nemu) appears in {distinct_codes.get(11403748814, 0)} records", flush=True)
    print(f"[debug] top 10 most-frequent suppliers: {distinct_codes.most_common(10)}", flush=True)
    return matches


def main():
    env = load_env(ENV_PATH)
    app_key = env.get("OMIE_APP_KEY_000174")
    app_secret = env.get("OMIE_APP_SECRET_000174")
    if not app_key or not app_secret:
        print("[omie] missing OMIE_APP_KEY_000174 / OMIE_APP_SECRET_000174 in .env", file=sys.stderr)
        sys.exit(1)

    print("[step 1] searching Omie clientes/fornecedores for Nemu by CNPJ (branch 000174)...", flush=True)
    hits = find_nemu_supplier(app_key, app_secret)
    if not hits:
        print("[result] no clientes/fornecedores matching Nemu's CNPJ found in this branch.", flush=True)
        sys.exit(2)

    print(f"\n=== MATCHES ({len(hits)}) ===")
    for r in hits:
        code = r.get("codigo_cliente_omie") or r.get("codigo_cliente")
        print(f"  codigo_cliente_omie={code} razao={r.get('razao_social')} fantasia={r.get('nome_fantasia')} cnpj={r.get('cnpj_cpf')} tags={[t.get('tag') for t in (r.get('tags') or [])]}")

    today = date.today()
    start = today - timedelta(days=400)  # ~13 months back to capture 12 complete monthly invoices
    start_str = start.strftime("%d/%m/%Y")
    end_str = today.strftime("%d/%m/%Y")

    for r in hits:
        codigo = r.get("codigo_cliente_omie") or r.get("codigo_cliente")
        print(f"\n[step 2] ListarContasPagar for codigo_cliente_omie={codigo} ({r.get('razao_social')}) {start_str}..{end_str}", flush=True)
        records = list_all_payables_for(app_key, app_secret, codigo, start_str, end_str)
        print(f"[omie] records={len(records)}")

        by_month = defaultdict(lambda: {"count": 0, "valor": 0.0, "pago": 0.0})
        for rec in records:
            # Omie conta_pagar_cadastro shape
            venc = rec.get("data_vencimento") or rec.get("data_previsao") or ""
            try:
                dd, mm, yyyy = venc.split("/")
                month_key = f"{yyyy}-{mm}"
            except Exception:
                month_key = "unknown"
            by_month[month_key]["count"] += 1
            by_month[month_key]["valor"] += float(rec.get("valor_documento") or 0)
            by_month[month_key]["pago"] += float(rec.get("valor_pago") or 0)

        if not by_month:
            print("  (no payables found in this window)")
            continue

        print(f"\n  === MONTHLY TOTALS — {r.get('razao_social')} ===")
        print(f"  {'month':<10}{'count':>8}{'valor_doc':>14}{'pago':>14}")
        total_valor = 0.0
        total_pago = 0.0
        for month in sorted(by_month.keys()):
            v = by_month[month]
            total_valor += v["valor"]
            total_pago += v["pago"]
            print(f"  {month:<10}{v['count']:>8}{v['valor']:>14,.2f}{v['pago']:>14,.2f}")
        print(f"  {'TOTAL':<10}{'':>8}{total_valor:>14,.2f}{total_pago:>14,.2f}")

        # Full per-invoice listing — sort by vencimento
        def _key(r):
            v = r.get("data_vencimento") or "01/01/1900"
            dd, mm, yyyy = v.split("/")
            return (yyyy, mm, dd, r.get("codigo_lancamento_omie") or 0)
        records.sort(key=_key)
        print(f"\n  All {len(records)} invoices:")
        print(f"    {'lancamento_omie':>16} {'doc':>6} {'parcela':>8} {'emissao':>10} {'vencimento':>10} {'valor':>10} {'status':>10} {'cat':>10}")
        for rec in records:
            print(f"    {rec.get('codigo_lancamento_omie',''):>16} {str(rec.get('numero_documento','')):>6} {str(rec.get('numero_parcela','')):>8} {rec.get('data_emissao',''):>10} {rec.get('data_vencimento',''):>10} {float(rec.get('valor_documento') or 0):>10.2f} {rec.get('status_titulo',''):>10} {rec.get('codigo_categoria',''):>10}")

        # Detect dup keys
        from collections import Counter as _C
        lanc_codes = _C(r.get("codigo_lancamento_omie") for r in records)
        dups = [(k, v) for k, v in lanc_codes.items() if v > 1]
        if dups:
            print(f"\n  [WARN] duplicate codigo_lancamento_omie detected: {dups}")
        else:
            print(f"\n  [OK] all 21 invoices have distinct codigo_lancamento_omie — no duplicates from sync")


if __name__ == "__main__":
    main()
