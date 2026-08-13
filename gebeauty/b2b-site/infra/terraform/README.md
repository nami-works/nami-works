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
# This also needs the Basic Auth credential (never commit it):
export TF_VAR_basic_auth_username="..."
export TF_VAR_basic_auth_password="..."
terraform apply
```

After the full apply:

```bash
terraform output site_cloudfront_domain_name
# -> add a second CNAME at registro.br:  b2b  ->  <that value>
```

Propagation on registro.br is usually quick; verify with
`nslookup b2b.gebeauty.com.br` and a cache-busted browser hit (accept the
Basic Auth prompt with the shared credential).

## What this module creates

- S3 bucket (private, versioned, SSE-encrypted, 30-day noncurrent-version
  lifecycle) holding `comercial/index.html` and `parceiros/index.html`.
- ACM certificate for `b2b.gebeauty.com.br` (us-east-1, DNS-validated).
- CloudFront distribution (OAC to the bucket, security headers policy incl.
  `X-Robots-Tag: noindex, nofollow`, `b2b.gebeauty.com.br` as the sole alias,
  PriceClass_100, default root `comercial/index.html`).
- One CloudFront Function (viewer-request) doing both HTTP Basic Auth and
  clean-URL rewriting (`/comercial` -> `/comercial/index.html`, `/` ->
  redirect to `/comercial/`) — a cache behavior only accepts one function per
  event type, so both jobs live in `cloudfront-functions/viewer-request.js.tftpl`.

## What this module does NOT create

- Any DNS record (see above — registro.br has no API).
- The deck content itself — that's built by
  `gebeauty/scripts/_b2b_build_site.py` (font-inlines the commercial +
  neutral decks into `gebeauty/b2b-site/{comercial,parceiros}/index.html`)
  and shipped by `gebeauty/scripts/_b2b_deploy_site.py` (S3 sync +
  CloudFront invalidation), not by Terraform.

## Rotating the Basic Auth credential

Change `TF_VAR_basic_auth_username` / `TF_VAR_basic_auth_password` and
`terraform apply` — CloudFront Functions redeploy the new code (and the new
credential compiled into it) atomically. No downtime, no separate
invalidation needed (functions aren't cached).

## Root default landing target

`/` redirects to `/comercial/` (the wholesale/commercial deck) by default —
a call made without a standing decision from Lucas; flip the target in
`cloudfront-functions/viewer-request.js.tftpl` if `/parceiros/` (or a chooser
page) should be the default instead.
