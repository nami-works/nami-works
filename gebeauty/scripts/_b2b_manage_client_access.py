"""Manage per-client Basic Auth credentials for b2b.gebeauty.com.br.

Credentials live in a CloudFront KeyValueStore (gebeauty/b2b-site/infra/
terraform/site.tf: aws_cloudfront_key_value_store.b2b_clients), read at the
edge by the CloudFront Function (cloudfront-functions/viewer-request.js) --
NOT in Terraform state. Add/remove/rotate a client here; no `terraform
apply`, no function redeploy, no propagation wait. Changes are live within
seconds.

Each KVS entry: key = username (auto-derived from the company name, see
slugify() -- e.g. "BIM Distribuidora" -> "bim-distribuidora", hyphenated so
it stays readable), value = JSON {"password": "...", "company": "<as typed>"}.

There's no `name` field here anymore -- the visitor's name is a free-text
field they fill in themselves on first access (viewer-request.js serves a
small "quem esta acessando?" page before the deck), not something set when
the credential is created. See the access-notify/access-digest Lambdas for
how that shows up in emails.

Usage:
  C:/Python314/python.exe gebeauty/scripts/_b2b_manage_client_access.py add "<Company Name>" [--password PASS]
  C:/Python314/python.exe gebeauty/scripts/_b2b_manage_client_access.py remove <username-or-company>
  C:/Python314/python.exe gebeauty/scripts/_b2b_manage_client_access.py list

If --password is omitted on `add`, a random password is generated and
printed -- copy it immediately, it is not stored anywhere else.
"""
import json
import re
import secrets
import string
import subprocess
import sys

KVS_NAME = "b2b_gebeauty_site_clients"


def slugify(company: str) -> str:
    """'BIM Distribuidora' -> 'bim-distribuidora' -- hyphen-joined words, not squashed together."""
    words = re.findall(r"[a-z0-9]+", company.lower())
    return "-".join(words)


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


def gen_password(length=20):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def cmd_add(args):
    if len(args) < 1:
        sys.exit('usage: add "<Company Name>" [--password PASS]')
    company = args[0]
    username = slugify(company)
    if not username:
        sys.exit(f"'{company}' has no usable characters after slugifying -- pick a company name with letters/digits.")

    password = None
    if "--password" in args:
        password = args[args.index("--password") + 1]
    if not password:
        password = gen_password()

    arn = kvs_arn()
    value = json.dumps({"password": password, "company": company})
    run("put-key", "--kvs-arn", arn, "--key", username, "--value", value, "--if-match", etag(arn))

    print(f"Added client '{company}' (username: {username})")
    print("  URL:      https://b2b.gebeauty.com.br/comercial  (or /parceiros)")
    print(f"  Username: {username}")
    print(f"  Password: {password}")
    print("Copy the password now -- it is not stored or shown anywhere else.")


def cmd_remove(args):
    if len(args) < 1:
        sys.exit("usage: remove <username-or-company>")
    username = slugify(args[0])
    arn = kvs_arn()
    run("delete-key", "--kvs-arn", arn, "--key", username, "--if-match", etag(arn))
    print(f"Removed username '{username}'.")


def cmd_list(args):
    arn = kvs_arn()
    keys = run("list-keys", "--kvs-arn", arn).get("Items", [])
    if not keys:
        print("No clients configured yet.")
        return
    for k in keys:
        try:
            company = json.loads(k["Value"]).get("company", "?")
        except (KeyError, ValueError):
            company = "?"
        print(f"{k['Key']:24}  {company}")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    action, args = sys.argv[1], sys.argv[2:]
    {"add": cmd_add, "remove": cmd_remove, "list": cmd_list}.get(
        action, lambda _: sys.exit(f"unknown command '{action}' -- use add|remove|list")
    )(args)


if __name__ == "__main__":
    main()
