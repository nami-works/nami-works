"""Emails Lucas a once-daily digest of who opened a b2b.gebeauty.com.br deck.

Triggered on a schedule (EventBridge Scheduler, see access-digest.tf --
default 09:00 UTC / 06:00 BRT). Reads ALL of yesterday's CloudFront
standard-access-log objects (S3 key names embed the date:
`cloudfront/<distribution-id>.<YYYY-MM-DD-HH>.<random>.gz`), extracts every
real deck view (same filter as access-notify's Lambda: cs-uri-stem is
/comercial/ or /parceiros/, sc-status 200, a `_co=` tracking param
present, and c-ip not in EXCLUDED_IPS -- Lucas's own QA/demo visits don't
belong in a digest of client activity either), and sends one summary
email listing every visit in chronological order.

The log-parsing logic here is a near-duplicate of
lambda/access-notify/index.py's -- kept as a second small file rather than
factored into a shared module, since these are two independently deployed
Lambda zips and a shared module would need its own Lambda Layer for what's
~25 lines of parsing code.
"""
import datetime
import gzip
import os
import urllib.parse

import boto3

s3 = boto3.client("s3")
ses = boto3.client("sesv2")

NOTIFY_EMAIL = os.environ["NOTIFY_EMAIL"]
LOGS_BUCKET = os.environ["LOGS_BUCKET"]
DECK_ROOTS = {"/comercial/", "/parceiros/"}
EXCLUDED_IPS = {ip.strip() for ip in os.environ.get("EXCLUDED_IPS", "").split(",") if ip.strip()}


def parse_log(body: bytes):
    text = gzip.decompress(body).decode("utf-8")
    fields = None
    for line in text.splitlines():
        if line.startswith("#Fields:"):
            fields = line[len("#Fields:"):].strip().split()
            continue
        if line.startswith("#") or not line.strip():
            continue
        if fields is None:
            continue
        row = dict(zip(fields, line.split("\t")))

        if row.get("cs-uri-stem") not in DECK_ROOTS:
            continue
        if row.get("sc-status") != "200":
            continue
        if row.get("c-ip") in EXCLUDED_IPS:
            continue

        raw_query = row.get("cs-uri-query", "-")
        if raw_query == "-":
            continue
        query = urllib.parse.unquote(raw_query)  # undo the log format's own encoding pass
        params = urllib.parse.parse_qs(query)
        company = params.get("_co", [None])[0]
        if not company:
            continue

        yield {
            "company": company,
            "name": params.get("_n", [""])[0],
            "date": row.get("date", "?"),
            "time": row.get("time", "?"),
        }


def who(hit) -> str:
    return f"{hit['name']}, de {hit['company']}" if hit["name"] else hit["company"]


def list_yesterdays_logs(yesterday: str):
    date_marker = f".{yesterday}-"  # matches the -HH hour suffix CloudFront appends
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=LOGS_BUCKET, Prefix="cloudfront/"):
        for obj in page.get("Contents", []):
            if date_marker in obj["Key"]:
                yield obj["Key"]


def send_digest(hits, yesterday: str):
    hits.sort(key=lambda h: (h["date"], h["time"]))
    lines = [f"{who(h)} acessou às {h['time'][:5]}" for h in hits]
    body = f"Ontem ({yesterday}) o catálogo B2B foi acessado {len(hits)} vez(es):\n\n" + "\n".join(lines)
    ses.send_email(
        FromEmailAddress=NOTIFY_EMAIL,
        Destination={"ToAddresses": [NOTIFY_EMAIL]},
        Content={
            "Simple": {
                "Subject": {"Data": f"[b2b.gebeauty.com.br] Resumo diário -- {len(hits)} acesso(s) em {yesterday}"},
                "Body": {"Text": {"Data": body}},
            }
        },
    )


def handler(_event, _context):
    yesterday = (datetime.datetime.utcnow().date() - datetime.timedelta(days=1)).isoformat()

    hits = []
    for key in list_yesterdays_logs(yesterday):
        obj = s3.get_object(Bucket=LOGS_BUCKET, Key=key)
        hits.extend(parse_log(obj["Body"].read()))

    if not hits:
        return {"emailed": False, "hits": 0}

    send_digest(hits, yesterday)
    return {"emailed": True, "hits": len(hits)}
