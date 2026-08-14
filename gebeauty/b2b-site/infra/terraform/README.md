# b2b.gebeauty.com.br — B2B portfolio decks infra (S3 + CloudFront)

Provisions hosting for the two B2B portfolio decks (`gebeauty/b2b-site/comercial`
and `gebeauty/b2b-site/parceiros`). Own Terraform root module, same reasoning
as `nami/site/infra/terraform`: this is a single static-asset lifecycle, not
part of the omnify/CPG-Labs stack or the connector stack.

Full migration context: `docs/handoff-b2b-subdomain-migration.md`.

## Why this module can't fully self-apply

Unlike `nami.works` (already in Route53), **`gebeauty.com.br`'s DNS lives at
registro.br**, which has no Terraform provider / API. That means:

- No `data "aws_route53_zone"` to read — there's no hosted zone.
- The ACM validation CNAME and the final CloudFront-alias CNAME both have to
  be pasted into the registro.br web panel **by hand**, by whoever has access
  to that panel.

Terraform still owns everything AWS-side (cert request, bucket, distribution,
Basic Auth function). The DNS half is a manual two-step handoff.

## Two-step apply

```bash
cd gebeauty/b2b-site/infra/terraform
terraform init

# Step 1 — request the cert only, get the validation record.
terraform apply -target=aws_acm_certificate.site
terraform output acm_validation_record
# -> add the printed CNAME (name -> value) at registro.br for gebeauty.com.br.
# ACM validation is usually minutes, up to ~30 min after the record resolves.

# Step 2 — once ACM shows the cert ISSUED (check the AWS console, or wait for
# `aws_acm_certificate_validation.site` to stop blocking), run the full apply.
terraform apply
```

After the full apply:

```bash
terraform output site_cloudfront_domain_name
# -> add a second CNAME at registro.br:  b2b  ->  <that value>
```

Propagation on registro.br is usually quick; verify with
`nslookup b2b.gebeauty.com.br` and a cache-busted browser hit.

Then add at least one client credential (see below) before sharing a link —
there's no default/shared password anymore.

## Per-client access

Each client gets their own Basic Auth username/password instead of one
shared credential. Credentials live in a CloudFront KeyValueStore
(`aws_cloudfront_key_value_store.b2b_clients`), **not Terraform state** —
manage them with the script, which is live within seconds (no apply, no
function redeploy):

```bash
# Add a client -- username is auto-derived from the company name
# (slugify: "BIM Distribuidora" -> "bim-distribuidora"). Omit --password
# to auto-generate one.
C:/Python314/python.exe gebeauty/scripts/_b2b_manage_client_access.py add "Acme Distribuidora"

# Remove a client (revokes just their access)
C:/Python314/python.exe gebeauty/scripts/_b2b_manage_client_access.py remove "Acme Distribuidora"

# List configured clients
C:/Python314/python.exe gebeauty/scripts/_b2b_manage_client_access.py list
```

**One custom login screen, not the browser's native Basic Auth popup.**
`viewer-request.js` never returns a 401 + `WWW-Authenticate` (that combo is
exactly what triggers the browser's native prompt) -- instead, whenever
credentials are missing or wrong, it serves its own small HTML page with
three fields: username, password, and the visitor's name (free text, filled
in by them -- Basic Auth is shared per company, not per person, so there's
no other way to learn who specifically is looking). On submit, the page's
JS navigates to `https://<user>:<pass>@b2b.gebeauty.com.br<path>?_n=<name>`.
Embedding credentials in the URL's userinfo makes the *browser* attach a
real `Authorization: Basic ...` header (and cache it for the origin
afterward) -- so the wire protocol underneath is unchanged HTTP Basic Auth
against the same KVS lookup, only the on-screen experience is a single
unified form instead of the browser's own dialog. Wrong credentials re-show
the same page with an inline error instead of the browser retrying its own
prompt.

Once authenticated, the function redirects to add `?_co=<company>` (and
carries `_n` along) for the two deck roots (`/comercial`, `/parceiros` --
NOT arbitrary paths like `/favicon.ico`, which browsers request
automatically). That redirect is a REAL second browser request, so it lands
in the CloudFront standard access logs (`terraform output
access_logs_bucket`, `cloudfront/` prefix) with the company, name, a
timestamp, and the visitor's IP — no extra infra (Lambda@Edge, a webhook)
needed. An internal-only URI rewrite would NOT show up this way; the
visible redirect is what makes it land in the viewer-facing log line.
`access-notify.tf`'s Lambda reads that same log line to send Lucas an
immediate email; `access-digest.tf`'s Lambda rolls up a whole day's worth
into one morning summary. (A lighter "quem está acessando?" name-only page
still exists as a fallback for the rare case a browser arrives already
authenticated -- e.g. cached credentials from an earlier login -- but
without `_n` on the URL.)

## What this module creates

- S3 bucket (private, versioned, SSE-encrypted, 30-day noncurrent-version
  lifecycle) holding `comercial/index.html` and `parceiros/index.html`.
- A second S3 bucket (90-day expiration) receiving CloudFront standard
  access logs.
- ACM certificate for `b2b.gebeauty.com.br` (us-east-1, DNS-validated).
- CloudFront KeyValueStore holding per-client Basic Auth credentials.
- CloudFront distribution (OAC to the bucket, security headers policy incl.
  `X-Robots-Tag: noindex, nofollow`, `b2b.gebeauty.com.br` as the sole alias,
  PriceClass_100, default root `comercial/index.html`, standard logging on).
- One CloudFront Function (viewer-request) doing per-client HTTP Basic Auth
  (against the KeyValueStore), the tracking redirect, and clean-URL
  rewriting (`/comercial` -> `/comercial/index.html`, `/` -> redirect to
  `/comercial/`) — a cache behavior only accepts one function per event
  type, so all three jobs live in `cloudfront-functions/viewer-request.js`.

## What this module does NOT create

- Any DNS record (see above — registro.br has no API).
- Client credentials — those are data-plane KVS entries managed by
  `_b2b_manage_client_access.py`, not Terraform resources (there's no
  first-class Terraform resource for individual KVS keys; the data-plane API
  is ETag-based CRUD that doesn't map cleanly onto Terraform's model, and
  Lucas wants frequent add/remove without a redeploy anyway).
- The deck content itself — that's built by
  `gebeauty/scripts/_b2b_build_site.py` (font-inlines the commercial +
  neutral decks into `gebeauty/b2b-site/{comercial,parceiros}/index.html`)
  and shipped by `gebeauty/scripts/_b2b_deploy_site.py` (S3 sync +
  CloudFront invalidation), not by Terraform.

## Root default landing target

`/` redirects to `/comercial/` (the wholesale/commercial deck) by default —
a call made without a standing decision from Lucas; flip the target in
`cloudfront-functions/viewer-request.js` if `/parceiros/` (or a chooser page)
should be the default instead.
