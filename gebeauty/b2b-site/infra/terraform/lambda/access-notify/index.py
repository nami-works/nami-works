"""Emails Lucas when a client accesses a b2b.gebeauty.com.br deck.

Triggered by S3 ObjectCreated on the CloudFront standard-access-logs bucket
(prefix `cloudfront/`, see site.tf's aws_s3_bucket_notification.logs). Each
log object covers a short window of raw edge traffic; this parses it for
the tracked hits (viewer-request.js redirects a client's first request per
route to `...?_c=<client name>`, so cs-uri-query carrying `_c=` IS the
"someone actually opened a deck" signal -- the untracked request just before
it is the 401/302 preflight, not a real view).

For each tracked hit found:
  - Sends one summary email via SES (lucas@gebeauty.com.br -> itself; SES
    account is in sandbox mode, so sender and recipient must both be
    verified identities -- this is why it emails Lucas's own address rather
    than, say, a shared team inbox).
  - Best-effort increments `accessCount` on that client's KVS record (looked
    up by matching the `client` display name back to a username via
    list-keys -- log lines carry the display name, not the username). Not
    critical-path: if the KVS update fails, the email still goes out.
"""
import gzip
import io
import json
import os
import urllib.parse

import boto3

s3 = boto3.client("s3")
ses = boto3.client("sesv2")
cf_kvs = boto3.client("cloudfront-keyvaluestore")

NOTIFY_EMAIL = os.environ["NOTIFY_EMAIL"]
KVS_ARN = os.environ["KVS_ARN"]


def parse_log(body: bytes):
    """Yield dicts for each CloudFront standard-log line with a `_c=` tracking hit."""
    text = gzip.decompress(body).decode("utf-8")
    lines = text.splitlines()
    fields = None
    for line in lines:
        if line.startswith("#Fields:"):
            fields = line[len("#Fields:"):].strip().split()
            continue
        if line.startswith("#") or not line.strip():
            continue
        if fields is None:
            continue
        cols = line.split("\t")
        row = dict(zip(fields, cols))
        query = row.get("cs-uri-query", "-")
        if query == "-" or "_c=" not in query:
            continue
        params = urllib.parse.parse_qs(query)
        client = params.get("_c", [None])[0]
        if not client:
            continue
        yield {
            "client": client,
            "date": row.get("date", "?"),
            "time": row.get("time", "?"),
            "ip": row.get("c-ip", "?"),
            "uri": row.get("cs-uri-stem", "?"),
            "status": row.get("sc-status", "?"),
        }


def bump_access_count(client_name: str):
    try:
        etag = cf_kvs.describe_key_value_store(KvsARN=KVS_ARN)["ETag"]
        keys = cf_kvs.list_keys(KvsARN=KVS_ARN).get("Items", [])
        for item in keys:
            try:
                record = json.loads(item["Value"])
            except (KeyError, ValueError):
                continue
            if record.get("client") != client_name:
                continue
            record["accessCount"] = int(record.get("accessCount", 0)) + 1
            cf_kvs.put_key(
                KvsARN=KVS_ARN,
                Key=item["Key"],
                Value=json.dumps(record),
                IfMatch=etag,
            )
            return
    except Exception as e:  # best-effort -- never let this block the email
        print(f"bump_access_count failed for {client_name!r}: {e}")


def send_email(hits):
    lines = [
        f"- {h['client']} acessou {h['uri']} em {h['date']} {h['time']} UTC (IP {h['ip']}, status {h['status']})"
        for h in hits
    ]
    body = "Novos acessos ao portfólio B2B (b2b.gebeauty.com.br):\n\n" + "\n".join(lines)
    ses.send_email(
        FromEmailAddress=NOTIFY_EMAIL,
        Destination={"ToAddresses": [NOTIFY_EMAIL]},
        Content={
            "Simple": {
                "Subject": {"Data": f"[b2b.gebeauty.com.br] {len(hits)} novo(s) acesso(s)"},
                "Body": {"Text": {"Data": body}},
            }
        },
    )


def handler(event, _context):
    hits = []
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        obj = s3.get_object(Bucket=bucket, Key=key)
        hits.extend(parse_log(obj["Body"].read()))

    if not hits:
        return {"emailed": 0}

    for h in hits:
        bump_access_count(h["client"])

    send_email(hits)
    return {"emailed": len(hits)}
