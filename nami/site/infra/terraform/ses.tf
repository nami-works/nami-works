# ─────────────────────────────────────────────────────────────────────────────
# SES domain identity for lead-capture email, self-hosted (no third-party
# form service). nami.works already has real Google Workspace mail (MX) and a
# STRICT DMARC policy (p=reject) -- see the existing _dmarc.nami.works TXT
# record, untouched by this file. Every record below is purely additive: a
# new verification TXT at _amazonses.nami.works and three DKIM CNAMEs at
# <token>._domainkey.nami.works -- none of these names collide with the
# existing SPF/DMARC/google-site-verification records in the same zone.
#
# Why this satisfies DMARC without touching the existing SPF record: DMARC
# passes if EITHER SPF OR DKIM aligns to the visible From: domain (not both).
# Easy DKIM below signs outgoing mail with d=nami.works, which aligns
# regardless of SPF -- so Google's receiving MTA (which hosts the actual
# nami.works mailboxes) will accept mail sent via SES without any change to
# the domain's existing Google-authored SPF record.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_ses_domain_identity" "nami_works" {
  domain = var.domain
}

resource "aws_route53_record" "ses_verification" {
  zone_id = data.aws_route53_zone.nami_works.zone_id
  name    = "_amazonses.${var.domain}"
  type    = "TXT"
  ttl     = 600
  records = [aws_ses_domain_identity.nami_works.verification_token]
}

# Blocks `terraform apply` until AWS confirms the TXT record above has
# propagated and the identity is actually verified -- expect this step to
# take a few minutes on first apply.
resource "aws_ses_domain_identity_verification" "nami_works" {
  domain     = aws_ses_domain_identity.nami_works.id
  depends_on = [aws_route53_record.ses_verification]
}

resource "aws_ses_domain_dkim" "nami_works" {
  domain = aws_ses_domain_identity.nami_works.domain
}

resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = data.aws_route53_zone.nami_works.zone_id
  name    = "${aws_ses_domain_dkim.nami_works.dkim_tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_ses_domain_dkim.nami_works.dkim_tokens[count.index]}.dkim.amazonses.com"]
}
