"""
Analysis layer over the CS archive mirror.

Two outputs (more to come once comment hydration completes):
  index    -> deliverables/INDEX.md : frequency-ranked map of what customers
              contact GE Beauty about, built from the CS-team-curated `type`
              taxonomy + volumes + yearly trend. PII-free by construction
              (pure aggregation, no verbatims).
  anon     -> self-test of the anonymizer used for later verbatim deliverables.

The deep per-cluster objection sheets (verbatim exemplars + root cause from
private comments + remedy) are deferred until `hydrate` finishes; this file
already holds the reusable anonymize() they will use.
"""
import argparse
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DB = HERE / "cs_archive.sqlite"
OUT = HERE / "deliverables"


# ------------------------------------------------------------ anonymization
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
_CNPJ = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
_PHONE = re.compile(r"(?<!\d)(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}(?!\d)")
_CEP = re.compile(r"\b\d{5}-?\d{3}\b")
# Label-bounded PII in the agents' structured private-note template
# (Nome:/Cliente:/Endereço/Rua/Bairro/Complemento ... up to the next known label).
_NEXTLBL = (r"(?=\s*(?:CPF|CNPJ|E-?mail|Telefone|Tel\b|Endere|CEP|Pagamento|Loja|"
            r"nf\b|NF\b|Complemento|Bairro|Pedido|Data|$))")
# Separator [:\-] is REQUIRED so we only hit template fields ("Nome:", "Bairro-"),
# never the word in a sentence ("O cliente reclama...", which is the VoC we want).
_NAME = re.compile(r"(\b(?:Nome|Cliente)\s*[:\-]\s*)(.+?)" + _NEXTLBL, re.IGNORECASE)
_ADDR = re.compile(r"(\bEndere[çc]o(?:\s+de\s+entrega)?\s*[:\-]\s*)(.+?)" + _NEXTLBL, re.IGNORECASE)
_STREET = re.compile(r"(\b(?:Rua|Avenida|Av\.)\s+)(.+?)" + _NEXTLBL, re.IGNORECASE)
_BAIRRO = re.compile(r"(\bBairro\s*[:\-]\s*)(.+?)" + _NEXTLBL, re.IGNORECASE)
_COMPL = re.compile(r"(\bComplemento\s*[:\-]\s*)(.+?)" + _NEXTLBL, re.IGNORECASE)


def anonymize(text: str) -> str:
    """Redact structured PII with high precision: CPF/CNPJ/CEP/phone/email by
    pattern, and name/address by the label template the CS agents use. Free-text
    names in signatures may still slip through -- digests are internal-only and
    get a light human pass before any external sharing."""
    if not text:
        return text
    text = _CNPJ.sub("[CNPJ]", text)
    text = _CPF.sub("[CPF]", text)
    text = _CEP.sub("[CEP]", text)
    text = _PHONE.sub("[PHONE]", text)
    text = _EMAIL.sub("[EMAIL]", text)
    text = _NAME.sub(r"\1[NOME]", text)
    text = _ADDR.sub(r"\1[ENDEREÇO]", text)
    text = _STREET.sub(r"\1[ENDEREÇO]", text)
    text = _BAIRRO.sub(r"\1[BAIRRO]", text)
    text = _COMPL.sub(r"\1[COMPL]", text)
    return text


def db():
    return sqlite3.connect(DB)


# ----------------------------------------------------- text cleaning for digests
import html as _html

_TAG = re.compile(r"<[^>]+>")
_STYLE = re.compile(r"<(style|script)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
# CSS that survived as plain text in email-bridge notifications: `selector { ... }`
# blocks and @media wrappers. Strip them so the real message surfaces.
_CSS = re.compile(r"@media[^{]*\{[^{}]*\}|[^{}\n]{0,120}\{[^{}]*\}")
_CSS_EMPTY = re.compile(r"@media[^{]*\{\s*\}|[^{}\n]{0,80}\{\s*\}")
_NOTIF_PREFIX = re.compile(r"^\s*Nova mensagem de cliente em .*?\d{2}:\d{2}\s*", re.IGNORECASE)
# Shopify contact-form wrapper around the real customer message.
_FORM_WRAP = re.compile(
    r".*?Comentário\s*:\s*(.*?)(?:Você pode habilitar a filtragem de spam.*)?$",
    re.IGNORECASE | re.DOTALL)
# Markers where a quoted reply-chain / signature / footer begins — cut everything after.
_QUOTE = re.compile(
    r"(Em\s.{0,80}?escreveu:|On\s.{0,80}?wrote:|De:\s|From:\s|-{3,}\s*Mensagem original"
    r"|_{6,}|Atenciosamente|Mensagem Confidencial|Esta mensagem cont[eé]m)",
    re.IGNORECASE,
)


def clean_text(raw: str) -> str:
    """HTML -> plain text, drop quoted reply-chains/signatures, collapse whitespace,
    then anonymize. Returns the customer's actual message, not the email cruft."""
    if not raw:
        return ""
    t = _STYLE.sub(" ", raw)
    t = _TAG.sub(" ", t)
    t = _html.unescape(t)
    for _ in range(3):              # strip CSS that leaked as plain text (nested)
        t = _CSS.sub(" ", t)
    t = _CSS_EMPTY.sub(" ", t)      # leftover empty `@media { }` shells
    m = _QUOTE.search(t)
    if m:
        t = t[: m.start()]
    t = _NOTIF_PREFIX.sub("", t)    # drop "Nova mensagem de cliente em <date>" boilerplate
    fm = _FORM_WRAP.match(t)        # unwrap Shopify contact-form -> just the comment
    if fm and fm.group(1).strip():
        t = fm.group(1)
    t = " ".join(t.split())
    return anonymize(t)


# ------------------------------------------------------------------- index
def split_type(type_name):
    """'Entrega - atrasada' -> ('Entrega', 'atrasada'); 'Contato' -> ('Contato', '(geral)')."""
    if not type_name:
        return ("(sem tipo)", "(geral)")
    if " - " in type_name:
        theme, sub = type_name.split(" - ", 1)
        return (theme.strip(), sub.strip())
    return (type_name.strip(), "(geral)")


# First-pass surface recommendation per top-level theme (refined after hydration).
THEME_SURFACE = {
    "Entrega": "FAQ + página de envio/prazos + política de entrega; rastreio proativo",
    "Atendimento": "FAQ + automações de pós-compra (status do pedido)",
    "Contato": "triagem (mistura de canais); refinar com hidratação de comentários",
    "Reclamação": "política + correção de processo; alguns viram fixes de produto/PDP",
    "Dúvidas": "PDP (objeções pré-compra) + FAQ",
    "Devolução": "política de devolução + FAQ; clareza no PDP sobre adequação",
    "Pagamento": "checkout + FAQ de pagamento; antifraude",
    "Cancelamento": "política + janela de cancelamento no fluxo de pedido",
    "Troca": "política de troca + FAQ",
    "Reembolso": "política de reembolso + transparência de prazo",
    "Problema": "site/checkout (bug surface)",
    "Elogio": "prova social / depoimentos (marketing)",
    "Sugestão": "backlog de produto / roadmap",
}


def cmd_index(_args):
    conn = db()
    rows = conn.execute(
        "SELECT type_name, creation_date FROM tickets WHERE is_noise=0"
    ).fetchall()
    total = len(rows)

    theme_ct = Counter()
    sub_ct = defaultdict(Counter)
    year_ct = Counter()
    for type_name, created in rows:
        theme, sub = split_type(type_name)
        theme_ct[theme] += 1
        sub_ct[theme][sub] += 1
        if created:
            year_ct[datetime.fromtimestamp(created, timezone.utc).year] += 1

    OUT.mkdir(exist_ok=True)
    hydrated = conn.execute(
        "SELECT COUNT(*) FROM tickets WHERE comments_fetched=1"
    ).fetchone()[0]

    L = []
    L.append("# GE Beauty — Mapa de Contatos do Cliente (Hi Platform CS)\n")
    L.append("> **Interim deliverable** — construído sobre a taxonomia de `tipo` "
             "curada pela equipe de CS, completa para todas as 28.080 tickets. "
             "A camada profunda (verbatims + causa-raiz dos comentários privados "
             f"+ remédio) chega quando a hidratação terminar (hoje: {hydrated:,} de "
             "25.300 conversas hidratadas). Este arquivo é livre de PII (só agregação).\n")
    L.append(f"\n**Base:** {total:,} tickets de clientes reais "
             "(noise/spam/parceria/fornecedor/currículo/imprensa/revenda excluídos).\n")

    L.append("\n## Volume por ano\n")
    for y in sorted(year_ct):
        L.append(f"- **{y}**: {year_ct[y]:,}")

    L.append("\n## Temas, por frequência\n")
    L.append("| # | Tema | Tickets | % | Superfície recomendada (1ª passada) |")
    L.append("|---|------|--------:|--:|-------------------------------------|")
    for i, (theme, n) in enumerate(theme_ct.most_common(), 1):
        pct = 100 * n / total
        surf = THEME_SURFACE.get(theme, "—")
        L.append(f"| {i} | {theme} | {n:,} | {pct:.1f}% | {surf} |")

    L.append("\n## Sub-motivos por tema (top 8 temas)\n")
    for theme, _ in theme_ct.most_common(8):
        L.append(f"\n### {theme} ({theme_ct[theme]:,})\n")
        L.append("| Sub-motivo | Tickets |")
        L.append("|------------|--------:|")
        for sub, n in sub_ct[theme].most_common():
            L.append(f"| {sub} | {n:,} |")

    L.append("\n## Próximo passo\n")
    L.append("Após hidratação completa: por cluster de alto volume, extrair "
             "exemplares verbatim (anonimizados), causa-raiz dos comentários "
             "privados e remédio dado; produzir ficha por SKU de objeções. "
             "Viés conhecido: o arquivo captura bem **arrependimento pós-compra "
             "+ falha de execução**, e mal **objeções pré-compra de não-compradores**.\n")

    path = OUT / "INDEX.md"
    path.write_text("\n".join(L), encoding="utf-8")
    print(f"Wrote {path}  ({total:,} customer tickets, {len(theme_ct)} themes)")
    # Console preview of the theme ranking.
    print("\nTop themes:")
    for theme, n in theme_ct.most_common(12):
        print(f"  {n:>6}  {100*n/total:4.1f}%  {theme}")


def cmd_digest(args):
    """Pull anonymized, cleaned exemplars for a cluster (by --type substring or
    --theme prefix): customer opening + earliest private agent note (root cause/
    remedy). Writes deliverables/digests/<slug>.md and prints the first few."""
    conn = db()
    where = "is_noise=0 AND comment_count>0"
    params = []
    if args.type:
        where += " AND type_name LIKE ?"
        params.append(f"%{args.type}%")
    elif args.theme:
        where += " AND (type_name = ? OR type_name LIKE ?)"
        params += [args.theme, f"{args.theme} - %"]
    rows = conn.execute(
        f"SELECT id, number, type_name, description FROM tickets WHERE {where} "
        f"ORDER BY number DESC LIMIT ?", (*params, args.n)
    ).fetchall()

    OUT.mkdir(exist_ok=True)
    dpath = OUT / "digests"
    dpath.mkdir(exist_ok=True)
    slug = (args.type or args.theme or "all").lower().replace(" ", "-").replace("/", "-")

    L = [f"# Digest: {args.type or args.theme or 'all'}  ({len(rows)} exemplars)\n",
         "> Anonymized. Customer opening + earliest private agent note (root cause/remedy).\n"]
    for tid, number, type_name, desc in rows:
        cust = clean_text(desc)[:600]
        note_row = conn.execute(
            "SELECT content FROM comments WHERE ticket_id=? AND public=0 "
            "ORDER BY date ASC LIMIT 1", (tid,)
        ).fetchone()
        note = clean_text(note_row[0])[:600] if note_row else "(no private note)"
        L.append(f"\n## #{number}  ·  {type_name}")
        L.append(f"- **Cliente:** {cust or '(vazio)'}")
        L.append(f"- **Nota interna:** {note}")
    path = dpath / f"{slug}.md"
    path.write_text("\n".join(L), encoding="utf-8")
    print(f"Wrote {path}  ({len(rows)} exemplars)\n")
    for line in L[2:][:24]:
        print(line)


# ---- second-pass content filter for the untagged 'Contato' catch-all ----------
# The bare 'Contato' type is ~93% non-customer (SaaS pitches, Shopify system
# notifications, cold B2B outreach, newsletters, bot transcripts). Keep only
# tickets showing a genuine customer-of-the-store signal.
_CONTATO_NOISE = re.compile(
    r"(recurring charge|approved a recurring|charge name|free trial|payments? settings|"
    r"ativou.*provedor|provedor de pagamento|PagBrasil|c[óo]digo de verifica|"
    r"verification code|verify your|verificar sua conta|\bOlist\b|Upsell\.com|\bNaper\b|"
    r"Function Studio|Discounty|BixGrow|Crisp E-mail|represento|sou representante|"
    r"atuo (com|na|como)|apresentar a|posicionamento estrat[ée]gic|solu[çc][õo]es de|"
    r"infraestrutura|consultoria|parceria comercial|unsubscribe|descadastr|"
    r"visualizar este e-?mail|newsletter|resposta autom[áa]tica|ausente do escrit[óo]rio|"
    r"out of office|transcri[çc][ãa]o da conversa|PicRights|direitos autorais|copyright|"
    r"First Advantage|antecedentes|background check|comprobaci[óo]n|meta-badge|blue badge|"
    r"crescimento da sua loja|growth opportunit|aumente o seu faturamento|mesmo dia)",
    re.IGNORECASE)
_CONTATO_CUST = re.compile(
    r"(\bpedido\b|\bcomprei\b|minha compra|fiz uma compra|n[ãa]o recebi|meu pedido|"
    r"recebi o produto|\bentrega\b|\brastre|troca|devolu|reembolso|\bcupom\b|"
    r"frete gr[áa]tis|loja f[íi]sica|onde comprar|usar o produto|meu cabelo|alergi|"
    r"rea[çc][ãa]o|\bnota fiscal\b|me entregaram|boleto)",
    re.IGNORECASE)


def cmd_reclassify_contato(_args):
    conn = db()
    rows = conn.execute(
        "SELECT id, description FROM tickets WHERE is_noise=0 AND type_name LIKE 'Contato%'"
    ).fetchall()
    kept = dropped = 0
    for tid, desc in rows:
        text = clean_text(desc)
        note = conn.execute("SELECT content FROM comments WHERE ticket_id=? ORDER BY date ASC LIMIT 1",
                            (tid,)).fetchone()
        blob = text + " " + (clean_text(note[0]) if note else "")
        is_cust = bool(_CONTATO_CUST.search(blob)) and not bool(_CONTATO_NOISE.search(blob))
        if is_cust:
            kept += 1
        else:
            conn.execute("UPDATE tickets SET is_noise=1, noise_reason=? WHERE id=?",
                         ("contato content-noise (vendor/system/B2B)", tid))
            dropped += 1
    conn.commit()
    print(f"Contato reclassified: kept {kept} as customer, dropped {dropped} as noise.")
    cust = conn.execute("SELECT COUNT(*) FROM tickets WHERE is_noise=0").fetchone()[0]
    print(f"Clean customer-voice corpus now: {cust}")


def light_clean(raw: str) -> str:
    """HTML/CSS -> plain text, whitespace-normalized, but LOSSLESS otherwise:
    no quote-chain cutting, no truncation, no anonymization. For the supplier
    handover we preserve the full message; only markup noise is removed."""
    if not raw:
        return ""
    t = _STYLE.sub(" ", raw)
    t = _TAG.sub(" ", t)
    t = _html.unescape(t)
    for _ in range(3):
        t = _CSS.sub(" ", t)
    t = _CSS_EMPTY.sub(" ", t)
    return " ".join(t.split())


def _iso(epoch):
    try:
        return datetime.fromtimestamp(epoch, timezone.utc).isoformat() if epoch else None
    except Exception:
        return None


def cmd_export(args):
    """Build the supplier-handover package: every ticket as a self-contained JSONL
    document (full thread inline, flagged is_noise/customer_voice). Writes a
    full (PII-intact) and a reduced-PII variant. Does NOT transmit anything."""
    import json as _json
    conn = db()
    OUT.mkdir(exist_ok=True)
    edir = OUT / "export"
    edir.mkdir(exist_ok=True)
    full_path = edir / "tickets.full.jsonl"
    anon_path = edir / "tickets.reduced-pii.jsonl"

    tickets = conn.execute(
        "SELECT id, number, subject, type_name, group_name, state_name, responsible_name, "
        "creation_user, creation_date, last_change_date, end_date, form_answers, "
        "is_noise, noise_reason, description FROM tickets ORDER BY number ASC"
    ).fetchall()

    n = 0
    with full_path.open("w", encoding="utf-8") as ff, anon_path.open("w", encoding="utf-8") as af:
        for (tid, number, subject, type_name, group_name, state_name, responsible,
             cuser, cdate, ldate, edate, form_json, is_noise, noise_reason, desc) in tickets:
            try:
                forms = _json.loads(form_json) if form_json else []
            except Exception:
                forms = []
            msgs = conn.execute(
                "SELECT date, author, public, content FROM comments WHERE ticket_id=? "
                "ORDER BY date ASC", (tid,)
            ).fetchall()
            base = {
                "ticket_number": number,
                "ticket_id": tid,
                "subject": subject,
                "type": type_name,
                "group": group_name,
                "state": state_name,
                "responsible": responsible,
                "created_at": _iso(cdate),
                "last_change_at": _iso(ldate),
                "closed_at": _iso(edate),
                "is_noise": bool(is_noise),
                "noise_reason": noise_reason,
                "customer_voice": not bool(is_noise),
                "form_answers": forms,
                "opening_message": light_clean(desc),
                "messages": [
                    {"date": _iso(d), "author": a,
                     "visibility": "public" if p else "private",
                     "text": light_clean(content)}
                    for (d, a, p, content) in msgs
                ],
            }
            ff.write(_json.dumps(base, ensure_ascii=False) + "\n")

            # reduced-PII clone
            red = dict(base)
            red["subject"] = anonymize(subject or "")
            red["opening_message"] = anonymize(base["opening_message"])
            red["form_answers"] = _json.loads(anonymize(_json.dumps(forms, ensure_ascii=False)))
            red["messages"] = [
                {**m, "text": anonymize(m["text"])} for m in base["messages"]
            ]
            af.write(_json.dumps(red, ensure_ascii=False) + "\n")
            n += 1

    cust = sum(1 for t in tickets if not t[12])
    print(f"Exported {n} tickets:")
    print(f"  {full_path.name}        (PII intact)")
    print(f"  {anon_path.name}  (reduced PII)")
    print(f"  customer_voice=true: {cust}   is_noise=true: {n - cust}")
    print(f"  full size : {full_path.stat().st_size/1e6:.1f} MB")
    print(f"  anon size : {anon_path.stat().st_size/1e6:.1f} MB")


def cmd_anon(_args):
    samples = [
        "Cliente Lila, CPF 123.456.789-09, tel (81) 99999-8888, lila@gmail.com, CEP 50000-000",
        "CNPJ 12.345.678/0001-99 pedido nao chegou",
    ]
    for s in samples:
        print("IN :", s)
        print("OUT:", anonymize(s), "\n")


def main():
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("index")
    d = sub.add_parser("digest")
    d.add_argument("--type", help="type_name substring (e.g. 'Entrega - atrasada')")
    d.add_argument("--theme", help="top-level theme (e.g. 'Entrega')")
    d.add_argument("--n", type=int, default=40)
    sub.add_parser("reclassify-contato")
    sub.add_parser("export")
    sub.add_parser("anon")
    args = p.parse_args()
    {"index": cmd_index, "digest": cmd_digest, "anon": cmd_anon,
     "reclassify-contato": cmd_reclassify_contato, "export": cmd_export}[args.cmd](args)


if __name__ == "__main__":
    main()
