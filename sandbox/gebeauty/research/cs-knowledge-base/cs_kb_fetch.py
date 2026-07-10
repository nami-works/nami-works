"""
Hi Platform (DirectTalk) Inbox API v1.5 -> local SQLite mirror.

Mines GE Beauty's full CS ticket archive before the platform migration.
Read-only research extraction. Raw data lands here; anonymization happens
at the deliverable stage, not at ingest.

Phases (subcommands):
  envelopes  Phase 1 - page every ticket envelope (subject, body, form answers,
             metadata) into the `tickets` table. ~28 calls. Idempotent upsert.
  classify   Local-only. Tag each ticket is_noise (auto-ingested vendor mail /
             review-request bounces / no-reply) vs real customer interaction.
             Prints a breakdown + samples so the filter can be sanity-checked
             BEFORE the long hydrate commits.
  hydrate    Phase 2 - for real customer tickets (is_noise=0), fetch the full
             comment thread (public replies + private agent notes). One call per
             ticket, newest-first, resumable on the comments_fetched flag.
  status     Print mirror counts and hydration progress.

Pacing: ~15 req/min (the API ceiling is 100 req / 5 min = 20/min). Exponential
backoff on throttle (non-JSON / 429 / 403-HTML).

Usage:
  python cs_kb_fetch.py envelopes
  python cs_kb_fetch.py classify [--sample N]
  python cs_kb_fetch.py hydrate [--limit N]
  python cs_kb_fetch.py status
"""
import argparse
import base64
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.directtalk.com.br/1.5/ticket/tickets"
HERE = Path(__file__).resolve().parent
DB = HERE / "cs_archive.sqlite"
REQ_INTERVAL = 4.0  # seconds between requests => ~15/min, under the 20/min ceiling


# --------------------------------------------------------------------------- env
def find_env(start: Path) -> Path:
    """Walk up from this script until a .env is found (cwd-independent)."""
    for parent in [start, *start.parents]:
        candidate = parent / ".env"
        if candidate.exists():
            return candidate
    raise FileNotFoundError("no .env found walking up from " + str(start))


def load_env() -> dict:
    env = {}
    for line in find_env(HERE).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"')
    return env


_ENV = load_env()
_TOKEN = base64.b64encode(
    f"{_ENV['HIPLATFORM_USER']}:{_ENV['HIPLATFORM_PASS']}".encode()
).decode()
_last_call = [0.0]


# --------------------------------------------------------------------------- http
def api_get(url: str, max_retries: int = 6):
    """GET with self-throttle + exponential backoff. Returns parsed JSON, or None
    if every retry failed (caller decides how to skip — a single bad ticket must
    never crash the whole run). Catches OSError (covers TimeoutError, URLError,
    HTTPError, connection resets) + JSON decode errors."""
    for attempt in range(max_retries):
        wait = REQ_INTERVAL - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        req = urllib.request.Request(
            url, headers={"Authorization": f"Basic {_TOKEN}", "Accept": "application/json"}
        )
        _last_call[0] = time.time()
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read().decode("utf-8", "replace")
            return json.loads(body)
        except (OSError, json.JSONDecodeError) as e:
            code = getattr(e, "code", "?")
            backoff = min(90, 15 * (2 ** attempt))
            print(f"    err ({type(e).__name__} {code}); backoff {backoff}s "
                  f"[{attempt + 1}/{max_retries}]", flush=True)
            time.sleep(backoff)
    print(f"    GAVE UP after {max_retries} retries: {url}", flush=True)
    return None


# --------------------------------------------------------------------------- db
def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS tickets (
            id TEXT PRIMARY KEY,
            number INTEGER,
            subject TEXT,
            description TEXT,
            type_name TEXT,
            group_name TEXT,
            state_name TEXT,
            responsible_name TEXT,
            creation_user TEXT,
            creation_date INTEGER,
            last_change_date INTEGER,
            end_date INTEGER,
            form_answers TEXT,
            raw TEXT,
            is_noise INTEGER,
            noise_reason TEXT,
            comments_fetched INTEGER DEFAULT 0,
            comment_count INTEGER
        );
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            ticket_id TEXT,
            ticket_number INTEGER,
            date INTEGER,
            author TEXT,
            public INTEGER,
            content TEXT,
            raw TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_comments_ticket ON comments(ticket_id);
        CREATE INDEX IF NOT EXISTS ix_tickets_number ON tickets(number);
    """)
    # Migration: track per-ticket fetch attempts so a permanently-failing thread
    # gets retried a few times then set aside instead of blocking completion.
    cols = [r[1] for r in conn.execute("PRAGMA table_info(tickets)")]
    if "comment_fetch_attempts" not in cols:
        conn.execute("ALTER TABLE tickets ADD COLUMN comment_fetch_attempts INTEGER DEFAULT 0")
        conn.commit()
    return conn


def _name(d):
    return d.get("name") if isinstance(d, dict) else None


# --------------------------------------------------------------------- phase 1
def cmd_envelopes(_args):
    conn = db()
    page, page_size, total = 1, 1000, None
    seen = 0
    while True:
        url = f"{API}?pageNumber={page}&pageSize={page_size}&sort=number&desc=true"
        rows = api_get(url)
        if not rows:
            break
        for t in rows:
            conn.execute("""
                INSERT INTO tickets (id, number, subject, description, type_name,
                    group_name, state_name, responsible_name, creation_user,
                    creation_date, last_change_date, end_date, form_answers, raw)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET
                    subject=excluded.subject, description=excluded.description,
                    state_name=excluded.state_name,
                    responsible_name=excluded.responsible_name,
                    last_change_date=excluded.last_change_date,
                    end_date=excluded.end_date, form_answers=excluded.form_answers,
                    raw=excluded.raw
            """, (
                t["id"], t.get("number"), t.get("subject"), t.get("description"),
                _name(t.get("type")), _name(t.get("group")), _name(t.get("state")),
                _name(t.get("responsible")), _name(t.get("creationUser")),
                t.get("creationDate"), t.get("lastChangeDate"), t.get("endDate"),
                json.dumps(t.get("formAnswers"), ensure_ascii=False), json.dumps(t, ensure_ascii=False),
            ))
        conn.commit()
        seen += len(rows)
        print(f"  page {page}: +{len(rows)} (total {seen})", flush=True)
        if len(rows) < page_size:
            break
        page += 1
    print(f"Phase 1 done. {seen} envelopes mirrored to {DB.name}")


# --------------------------------------------------------------------- classify
# GE Beauty's CS team tags every ticket by `type`. That curated taxonomy is the
# reliable discriminator (far better than body heuristics). Skip the types that
# are not end-customer voice-of-customer.
NOISE_TYPES = {
    "Contato - spam",              # explicitly triaged spam
    "Contato - parceria",          # inbound B2B partnership pitches
    "Contato - parceria comercial",
    "Contato - fornecedor",        # supplier communications
    "Contato - currículo",         # job applications
    "Contato - imprensa",          # press inquiries
}
# Borderline B2B (resellers, not end consumers). Skipped by default; flip via
# --keep-revenda if wholesale voice is wanted.
RESELLER_TYPES = {"Contato - revenda"}


def classify_one(type_name, keep_revenda=False):
    """Return (is_noise, reason) from the curated ticket type."""
    if type_name in NOISE_TYPES:
        return 1, f"non-customer type: {type_name}"
    if type_name in RESELLER_TYPES and not keep_revenda:
        return 1, f"reseller (B2B) type: {type_name}"
    return 0, None


def cmd_classify(args):
    conn = db()
    rows = conn.execute("SELECT id, type_name FROM tickets").fetchall()
    counts = {"customer": 0, "noise": 0}
    by_reason = {}
    for tid, type_name in rows:
        is_noise, reason = classify_one(type_name, keep_revenda=args.keep_revenda)
        conn.execute("UPDATE tickets SET is_noise=?, noise_reason=? WHERE id=?",
                     (is_noise, reason, tid))
        counts["noise" if is_noise else "customer"] += 1
        if is_noise:
            by_reason[reason] = by_reason.get(reason, 0) + 1
    conn.commit()

    total = len(rows)
    print(f"\nClassified {total} tickets:")
    print(f"  real customer : {counts['customer']:>6}  -> will hydrate comments")
    print(f"  noise/skip    : {counts['noise']:>6}")
    for r, n in sorted(by_reason.items(), key=lambda x: -x[1]):
        print(f"      {n:>6}  {r}")

    n = args.sample
    print(f"\n--- sample of {n} tickets KEPT as customer (subject) ---")
    for (subj,) in conn.execute(
        "SELECT subject FROM tickets WHERE is_noise=0 ORDER BY number DESC LIMIT ?", (n,)
    ):
        print(f"  KEEP  {(subj or '')[:90]}")
    print(f"\n--- sample of {n} tickets FILTERED as noise (subject) ---")
    for (subj,) in conn.execute(
        "SELECT subject FROM tickets WHERE is_noise=1 ORDER BY number DESC LIMIT ?", (n,)
    ):
        print(f"  SKIP  {(subj or '')[:90]}")
    print(f"\nEstimated hydrate time: ~{counts['customer'] * REQ_INTERVAL / 3600:.1f}h "
          f"at {REQ_INTERVAL}s/call")


# --------------------------------------------------------------------- phase 2
def cmd_hydrate(args):
    conn = db()
    # Skip tickets that already failed MAX_ATTEMPTS times so a permanently-stuck
    # thread can't block completion; a later `hydrate --retry-failed` can revisit.
    MAX_ATTEMPTS = 4
    todo = conn.execute(
        "SELECT id, number FROM tickets "
        "WHERE is_noise=0 AND comments_fetched=0 AND comment_fetch_attempts < ? "
        "ORDER BY number DESC", (MAX_ATTEMPTS,)
    ).fetchall()
    if args.limit:
        todo = todo[: args.limit]
    print(f"Hydrating comments for {len(todo)} tickets (newest-first, resumable)...")
    done = failed = 0
    for tid, number in todo:
        try:
            comments = api_get(f"{API}/{tid}/comments?pageNumber=1&pageSize=200")
            if comments is None:                       # all retries failed -> defer
                conn.execute(
                    "UPDATE tickets SET comment_fetch_attempts = comment_fetch_attempts + 1 "
                    "WHERE id=?", (tid,))
                conn.commit()
                failed += 1
                continue
            for c in comments:
                conn.execute("""
                    INSERT INTO comments (id, ticket_id, ticket_number, date, author,
                        public, content, raw)
                    VALUES (?,?,?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET content=excluded.content
                """, (
                    c.get("id"), tid, number, c.get("date"),
                    _name(c.get("user")), 1 if c.get("public") else 0,
                    c.get("content"), json.dumps(c, ensure_ascii=False),
                ))
            conn.execute(
                "UPDATE tickets SET comments_fetched=1, comment_count=? WHERE id=?",
                (len(comments), tid),
            )
            conn.commit()
            done += 1
            if done % 25 == 0:
                print(f"  {done}/{len(todo)}  (#{number}, {len(comments)} comments)", flush=True)
        except Exception as e:                         # never let one ticket kill the run
            print(f"    SKIP #{number}: {type(e).__name__}: {e}", flush=True)
            conn.execute(
                "UPDATE tickets SET comment_fetch_attempts = comment_fetch_attempts + 1 "
                "WHERE id=?", (tid,))
            conn.commit()
            failed += 1
    print(f"Hydrate pass done. {done} processed, {failed} deferred.")


# --------------------------------------------------------------------- status
def cmd_status(_args):
    conn = db()
    q = lambda sql: conn.execute(sql).fetchone()[0]
    total = q("SELECT COUNT(*) FROM tickets")
    classified = q("SELECT COUNT(*) FROM tickets WHERE is_noise IS NOT NULL")
    customer = q("SELECT COUNT(*) FROM tickets WHERE is_noise=0")
    hydrated = q("SELECT COUNT(*) FROM tickets WHERE comments_fetched=1")
    pending = q("SELECT COUNT(*) FROM tickets WHERE is_noise=0 AND comments_fetched=0 "
                "AND comment_fetch_attempts < 4")
    deferred = q("SELECT COUNT(*) FROM tickets WHERE is_noise=0 AND comments_fetched=0 "
                 "AND comment_fetch_attempts >= 4")
    ncomments = q("SELECT COUNT(*) FROM comments")
    rng = conn.execute("SELECT MIN(number), MAX(number) FROM tickets").fetchone()
    print(f"DB: {DB}")
    print(f"  envelopes mirrored : {total}  (ticket # {rng[0]}..{rng[1]})")
    print(f"  classified         : {classified}")
    print(f"  real customer      : {customer}")
    print(f"  comments hydrated  : {hydrated}/{customer}"
          + (f"  ({100 * hydrated / customer:.0f}%)" if customer else ""))
    print(f"  still pending      : {pending}")
    print(f"  deferred (>=4 fail): {deferred}")
    print(f"  comments stored    : {ncomments}")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("envelopes")
    c = sub.add_parser("classify")
    c.add_argument("--sample", type=int, default=15)
    c.add_argument("--keep-revenda", action="store_true")
    h = sub.add_parser("hydrate"); h.add_argument("--limit", type=int, default=0)
    sub.add_parser("status")
    args = p.parse_args()
    {"envelopes": cmd_envelopes, "classify": cmd_classify,
     "hydrate": cmd_hydrate, "status": cmd_status}[args.cmd](args)


if __name__ == "__main__":
    main()
