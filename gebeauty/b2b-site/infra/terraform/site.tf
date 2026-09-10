# ─────────────────────────────────────────────────────────────────────────────
# b2b.gebeauty.com.br — two self-contained B2B portfolio decks (commercial +
# neutral/partner), served from S3 via CloudFront. Same S3+CloudFront+OAC
# shape as apps/omnify-site and nami/site, but with two differences specific
# to this domain:
#
#   - gebeauty.com.br's DNS lives at registro.br, NOT Route53 -- there is no
#     hosted zone to read/write here (see nami/site/infra/terraform/site.tf
#     for the Route53 version of this pattern). This module requests its own
#     ACM cert and stops short of creating any DNS record: the validation
#     CNAME and the final alias CNAME both have to be pasted into the
#     registro.br panel by hand. See the README for the exact two-step apply.
#   - Access is gated by a CloudFront Function doing PER-CLIENT MAGIC LINKS
#     (?k=<token>) instead of a login screen -- these are unlisted sell-in
#     decks, not secrets, so an unguessable link is enough friction, not a
#     real authz boundary. Tokens live in a CloudFront KeyValueStore, not
#     baked into the function -- add/remove/rotate a client via
#     gebeauty/scripts/_b2b_manage_client_access.py, no `terraform apply`
#     needed. On first valid hit per route, the function 302-redirects to
#     the same URL + `&_co=<company>` so the hit lands in the standard
#     access logs below with the company attached -- that's how Lucas sees
#     who opened which deck, and when. Combined with the clean-URL rewrite
#     in the same function, since a cache behavior only accepts one function
#     per event type. See cloudfront-functions/viewer-request.js.
#
# Architecture:
#                    ┌────────────────────────────────────────┐
#                    │  registro.br DNS (manual, not IaC)      │
#                    │  CNAME  b2b  ->  <dist>.cloudfront.net  │
#                    └────────────┬─────────────────────────────┘
#                                 ▼
#                ┌──────────────────────────────────────┐
#                │ aws_cloudfront_distribution.site     │
#                │   alias: b2b.gebeauty.com.br         │
#                │   cert: aws_acm_certificate.site     │
#                │   Function: per-client magic link     │
#                │     (reads aws_cloudfront_key_value_  │
#                │      store.b2b_clients) + URL rewrite │
#                │   OAC -> S3 (no public bucket)       │
#                │   standard access logs -> log bucket │
#                └────────────┬─────────────────────────┘
#                             ▼
#                 ┌────────────────────────────┐
#                 │ aws_s3_bucket.site         │
#                 │   private, versioned, SSE  │
#                 │   /comercial/index.html    │
#                 │   /parceiros/index.html    │
#                 └────────────────────────────┘
# ─────────────────────────────────────────────────────────────────────────────

# ── ACM cert (us-east-1), DNS-validated at registro.br (manual) ────────────
resource "aws_acm_certificate" "site" {
  domain_name       = var.domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name      = var.domain
    ManagedBy = "terraform"
  }
}

# aws_acm_certificate_validation blocks `apply` until ACM confirms the CNAME
# below resolves -- it does NOT require Route53; any DNS provider works as
# long as the record exists. Apply -target=aws_acm_certificate.site first,
# hand Lucas the validation CNAME (terraform output acm_validation_record),
# wait for him to add it at registro.br, THEN run the full apply (this
# resource is what makes that second apply block on real propagation).
resource "aws_acm_certificate_validation" "site" {
  certificate_arn = aws_acm_certificate.site.arn
}

# ── S3 bucket holding the two decks ──────────────────────────────────────────
resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name

  tags = {
    Name        = var.bucket_name
    Description = "Static B2B portfolio decks for ${var.domain}"
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.site.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ── CloudFront Origin Access Control ─────────────────────────────────────────
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.bucket_name}-oac"
  description                       = "OAC for ${var.bucket_name} S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "site_bucket" {
  statement {
    sid    = "AllowCloudFrontServicePrincipal"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.site]
}

# ── Security headers policy ──────────────────────────────────────────────────
resource "aws_cloudfront_response_headers_policy" "site" {
  name = "${var.bucket_name}-headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }
  }

  # noindex,nofollow -- these are unlisted sell-in decks (handoff §10 acceptance
  # criteria), not meant to be crawled or appear in search/predictive search.
  custom_headers_config {
    items {
      header   = "X-Robots-Tag"
      value    = "noindex, nofollow"
      override = true
    }
  }
}

# ── CloudFront KeyValueStore: per-client credentials ─────────────────────────
# Empty at apply time -- populated/managed entirely via
# gebeauty/scripts/_b2b_manage_client_access.py (wraps `aws
# cloudfront-keyvaluestore put-key/delete-key/list-keys`), NOT Terraform.
# There's no first-class Terraform resource for individual KVS keys (the data
# plane uses an ETag-based API shape most providers don't model as CRUD), and
# Lucas explicitly wants frequent add/remove without a redeploy -- a script
# against the data-plane API is the right fit, not IaC.
resource "aws_cloudfront_key_value_store" "b2b_clients" {
  name    = "${replace(var.bucket_name, "-", "_")}_clients"
  comment = "Per-client magic-link tokens for ${var.domain}. Managed via _b2b_manage_client_access.py, not Terraform."
}

# ── CloudFront Function: per-client magic-link gate + clean-URL rewrite ─────
resource "aws_cloudfront_function" "viewer_request" {
  name                         = "${replace(var.bucket_name, "-", "_")}_viewer_request"
  runtime                      = "cloudfront-js-2.0"
  comment                      = "Per-client magic-link gate + clean-URL rewrite for ${var.domain}"
  publish                      = true
  code                         = file("${path.module}/cloudfront-functions/viewer-request.js")
  key_value_store_associations = [aws_cloudfront_key_value_store.b2b_clients.arn]
}

# ── S3 bucket for CloudFront standard access logs ───────────────────────────
# Separate from the site bucket (aws_s3_bucket.site) -- logs are how Lucas
# sees which client (via the ?_c= tracking param the function adds) opened
# a deck and when. CloudFront's legacy log-delivery mechanism writes via ACL
# grant to the AWS log-delivery canonical user, which needs ACLs enabled on
# this bucket specifically (the public_access_block below keeps it otherwise
# locked down -- this is a grant to an AWS service account, not the public).
resource "aws_s3_bucket" "logs" {
  bucket = "${var.bucket_name}-logs"

  tags = {
    Name        = "${var.bucket_name}-logs"
    Description = "CloudFront standard access logs for ${var.domain}"
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    object_ownership = "ObjectWriter" # required for CloudFront's ACL-based log delivery
  }
}

resource "aws_s3_bucket_acl" "logs" {
  depends_on = [aws_s3_bucket_ownership_controls.logs]
  bucket     = aws_s3_bucket.logs.id
  acl        = "log-delivery-write"
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = false # the log-delivery-write ACL above needs this off
  block_public_policy     = true
  ignore_public_acls      = false
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = 90
    }
  }
}

# ── CloudFront distribution ──────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "comercial/index.html"
  comment             = "${var.domain} B2B portfolio decks"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"

  aliases = [var.domain]

  logging_config {
    bucket          = aws_s3_bucket.logs.bucket_domain_name
    prefix          = "cloudfront/"
    include_cookies = false
  }

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-${var.bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-${var.bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6" # AWS-managed CachingOptimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.viewer_request.arn
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/comercial/index.html"
    error_caching_min_ttl = 60
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/comercial/index.html"
    error_caching_min_ttl = 60
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = {
    Name      = var.bucket_name
    ManagedBy = "terraform"
  }
}
