// Wildcard cert on *.nami.works plus the apex. Future subdomains (api,
// admin, status) reuse the same cert for free. ACM charges nothing for
// public certs; validation is via DNS records we create below.

resource "aws_acm_certificate" "wildcard" {
  domain_name               = "*.${var.domain}"
  subject_alternative_names = [var.domain]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.wildcard.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  allow_overwrite = true
  zone_id         = aws_route53_zone.main.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 300
}

resource "aws_acm_certificate_validation" "wildcard" {
  certificate_arn         = aws_acm_certificate.wildcard.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]

  // Validation blocks until DNS records resolve globally, which requires the
  // registrar delegation to be live. Expect a 5-60 minute wait on first apply.
  timeouts {
    create = "75m"
  }
}
