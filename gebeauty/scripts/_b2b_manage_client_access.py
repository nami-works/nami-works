"""Manage per-client magic-link access to b2b.gebeauty.com.br.

Each client gets a unique unguessable link (?k=<token>) instead of a
username/password to type in -- a prior version used a custom login screen
(username+password+name) that turned out to be broken in real browsers: it
worked by having the page's JS navigate to https://user:pass@host/path, but
modern Chromium silently refuses JS navigation to URLs with embedded
credentials (confirmed by direct browser testing -- no request even fires).
A plain query-string token has none of that baggage and needs no form at all.

Tokens live in a CloudFront KeyValueStore (gebeauty/b2b-site/infra/terraform/
site.tf: aws_cloudfront_key_value_store.b2b_clients), read at the edge by
the CloudFront Function (cloudfront-functions/viewer-request.js) -- NOT in
Terraform state. Add/remove/rotate a client here; no `terraform apply`, no
function redeploy, no propagation wait. Changes are live within seconds.

Each KVS entry: key = token (random, opaque -- this IS the credential, so
it must not be guessable), value = JSON {"company": "<as typed>"}.
`company` is what shows up in the access-notify/access-digest emails via
the ?_co= tracking redirect the CloudFront Function adds.

Usage:
  C:/Python314/python.exe gebeauty/scripts/_b2b_manage_client_access.py add "<Company Name>"
  C:/Python314/python.exe gebeauty/scripts/_b2b_manage_client_access.py remove "<Company Name>"   (or a token)
  C:/Python314/python.exe gebeauty/scripts/_b2b_manage_client_access.py list
"""
import json
import secrets
import string
import subprocess
import sys

KVS_NAME = "b2b_gebeauty_site_clients"
DOMAIN = "https://b2b.gebeauty.com.br"


def run(*args):
    r = subprocess.run(["aws", "cloudfront-keyvaluestore", *args], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or r.stdout.strip())
    return json.loads(r.stdout) if r.stdout.strip() else {}


def kvs_arn():
    r = subprocess.run(
        ["aws", "cloudfront", "list-key-value-stores",
         "--query", f"KeyValueStoreList.Items[?Name=='{KVS_NAME}'].ARN", "--output", "text"],
        capture_output=True, text=True,
    )
    arn = r.stdout.strip()
    if r.returncode != 0 or not arn:
        raise RuntimeError(
            f"Could not find KeyValueStore '{KVS_NAME}' -- has `terraform apply` run in "
            "gebeauty/b2b-site/infra/terraform?\n" + (r.stderr or "")
        )
    return arn


def etag(arn):
    return run("describe-key-value-store", "--kvs-arn", arn)["ETag"]


def gen_token(length=24):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def all_entries(arn):
    for item in run("list-keys", "--kvs-arn", arn).get("Items", []):
        try:
            company = json.loads(item["Value"]).get("company", "?")
        except (KeyError, ValueError):
            company = "?"
        yield item["Key"], company


def cmd_add(args):
    if len(args) < 1:
        sys.exit('usage: add "<Company Name>"')
    company = args[0]
    token = gen_token()

    arn = kvs_arn()
    value = json.dumps({"company": company})
    run("put-key", "--kvs-arn", arn, "--key", token, "--value", value, "--if-match", etag(arn))

    print(f"Added client '{company}'")
    print(f"  Comercial: {DOMAIN}/comercial?k={token}")
    print(f"  Parceiros: {DOMAIN}/parceiros?k={token}")
    print("Send one of these links -- no separate credential to communicate.")


def cmd_remove(args):
    if len(args) < 1:
        sys.exit('usage: remove "<Company Name>"  (or the token)')
    target = args[0]
    arn = kvs_arn()

    token = target
    for key, company in all_entries(arn):
        if key == target or company == target:
            token = key
            break

    run("delete-key", "--kvs-arn", arn, "--key", token, "--if-match", etag(arn))
    print(f"Removed access for '{target}'.")


def cmd_list(args):
    arn = kvs_arn()
    entries = list(all_entries(arn))
    if not entries:
        print("No clients configured yet.")
        return
    for token, company in entries:
        print(f"{company:30}  {DOMAIN}/comercial?k={token}")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    action, args = sys.argv[1], sys.argv[2:]
    {"add": cmd_add, "remove": cmd_remove, "list": cmd_list}.get(
        action, lambda _: sys.exit(f"unknown command '{action}' -- use add|remove|list")
    )(args)


if __name__ == "__main__":
    main()
