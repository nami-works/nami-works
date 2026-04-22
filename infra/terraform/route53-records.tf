// Mirrors the email-critical records currently served by GoDaddy's DNS for
// nami.works. Created in Terraform so that when the registrar's NS pointers
// flip from GoDaddy to Route 53, email keeps flowing without a gap.
//
// What's NOT mirrored (intentional):
//   - GoDaddy NS records (ns11/ns12.domaincontrol.com) — they ARE the
//     "GoDaddy is authoritative" statement; flipping NS at the registrar
//     replaces them.
//   - SOA — Route 53 auto-creates its own.
//   - `_domainconnect` CNAME — GoDaddy service-discovery; meaningless here.
//   - Apex A → GoDaddy WebsiteBuilder — never resolved publicly anyway.
//   - `www` CNAME → apex — only useful if apex resolves. Re-add when a
//     marketing site at nami.works exists.
//   - `dc-aa8e722993._spfm.nami.works` SPF flattening chain — GoDaddy-
//     proprietary indirection that just proxies include:_spf.google.com.
//     The TXT below replaces it directly.

locals {
  ttl_standard = 3600
}

# ---- MX (Google Workspace) ----

resource "aws_route53_record" "mx" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "MX"
  ttl     = local.ttl_standard

  records = [
    "1 aspmx.l.google.com.",
    "5 alt1.aspmx.l.google.com.",
    "5 alt2.aspmx.l.google.com.",
    "10 alt3.aspmx.l.google.com.",
    "10 alt4.aspmx.l.google.com.",
  ]
}

# ---- SPF + Google site verification (apex TXT, both share the name) ----

resource "aws_route53_record" "apex_txt" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "TXT"
  ttl     = local.ttl_standard

  // Multiple TXT records at the same name are served as one RRset.
  records = [
    "v=spf1 include:_spf.google.com ~all",
    "google-site-verification=nOCIIJmF6q9eBw80gduYsGGkxD3Pmc563My2j538xz0",
  ]
}

# ---- DMARC ----
// Preserved exactly as GoDaddy served it. The `rua` reporting endpoint still
// points at GoDaddy's DMARC service — that won't break anything, but reports
// will go to a mailbox you don't own. If you want to receive the reports
// yourself, swap `dmarc_rua@onsecureserver.net` for `lucas@nami.works` (or
// any address on a verified domain).

resource "aws_route53_record" "dmarc" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = local.ttl_standard

  records = [
    "v=DMARC1; p=reject; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;",
  ]
}
