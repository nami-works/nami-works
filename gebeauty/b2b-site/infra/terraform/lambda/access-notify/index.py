"""Emails Lucas immediately when a client opens a b2b.gebeauty.com.br deck.

Triggered by S3 ObjectCreated on the CloudFront standard-access-logs bucket
(prefix `cloudfront/`, see site.tf's aws_s3_bucket_notification.logs). Each
log object covers a short window of raw edge traffic; this parses it for
real deck views -- viewer-request.js redirects a client's first request to
one of the two deck roots (/comercial, /parceiros) to
`...?_co=<company>[&_n=<name>]`, so a hit with `_co=` present AND a 200
status IS the "someone actually opened a deck" signal. Everything else
(the 401 preflight before that redirect, a browser's automatic
/favicon.ico request, a stale bookmarked tracking URL replayed after the
credential was revoked) is noise and gets filtered out.

NOTE on double-encoding: CloudFront standard logs URI-encode field values
for the log format itself, INCLUDING query strings that were already
percent-encoded on the wire (e.g. a company name with a space, encoded by
the CloudFront Function as %20, gets re-escaped to %2520 in the log). So
cs-uri-query needs one unquote() pass to undo the log's own encoding
BEFORE running it through parse_qs (which does its own, normal, decode of
the actual query string) -- skipping that first pass is why an earlier
version of this Lambda emailed literal "%20" instead of a space.
"""
import gzip
import os
import urllib.parse

import boto3

s3 = boto3.client("s3")
ses = boto3.client("sesv2")

NOTIFY_EMAIL = os.environ["NOTIFY_EMAIL"]
DECK_ROOTS = {"/comercial/", "/parceiros/"}


def parse_log(body: bytes):
    """Yield dicts for each CloudFront standard-log line that is a real tracked deck view."""
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
            "ip": row.get("c-ip", "?"),
            "uri": row.get("cs-uri-stem", "?"),
        }


def who(hit) -> str:
    return f"{hit['name']}, de {hit['company']}" if hit["name"] else hit["company"]


def send_email(hit):
    subject = f"[b2b.gebeauty.com.br] Novo acesso -- {hit['company']}"
    body = (
        f"{who(hit)} acessou o catálogo B2B.\n\n"
        f"Página: {hit['uri']}\n"
        f"Quando: {hit['date']} {hit['time']} UTC\n"
        f"IP: {hit['ip']}"
    )
    ses.send_email(
        FromEmailAddress=NOTIFY_EMAIL,
        Destination={"ToAddresses": [NOTIFY_EMAIL]},
        Content={"Simple": {"Subject": {"Data": subject}, "Body": {"Text": {"Data": body}}}},
    )


def handler(event, _context):
    hits = []
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        obj = s3.get_object(Bucket=bucket, Key=key)
        hits.extend(parse_log(obj["Body"].read()))

    for hit in hits:
        send_email(hit)

    return {"emailed": len(hits)}
