# ─────────────────────────────────────────────────────────────────────────────
# Public site (nami.works) — static Astro build served from S3 via CloudFront.
#
# Mirrors infra/omnify/terraform/site.tf's pattern (same S3+CloudFront+OAC
# shape) but simpler on two fronts specific to this domain:
#   - nami.works already lives in Route53 (infra/connector/route53.tf owns the
#     zone resource itself; this module only reads it via a data source and
#     adds its own record — no ownership conflict, Route53 records are
#     independent within a zone).
#   - An ISSUED wildcard ACM cert (*.nami.works + nami.works, us-east-1)
#     already exists and is currently unused (it covered the old
#     mcp.nami.works listener before that record was deleted). Reused here via
#     a data lookup — no new cert request, no DNS validation roundtrip.
#
# Architecture:
#                       ┌────────────────────────────────────┐
#                       │  Route53 zone: nami.works           │
#                       │  (owned by infra/connector)         │
#                       │  A/AAAA alias -> CloudFront (here)  │
#                       └────────────┬─────────────────────────┘
#                                    ▼
#                    ┌────────────────────────────────────┐
#                    │ aws_cloudfront_distribution.site   │
#                    │   alias: nami.works                │
#                    │   cert: *.nami.works (existing)    │
#                    │   OAC -> S3 (no public bucket)     │
#                    └────────────┬───────────────────────┘
#                                 ▼
#                     ┌────────────────────────────┐
#                     │ aws_s3_bucket.site         │
#                     │   private, versioned, SSE  │
#                     │   contents: dist/*         │
#                     └────────────────────────────┘
# ─────────────────────────────────────────────────────────────────────────────

# ── Existing Route53 zone (owned elsewhere, read-only reference here) ───────
data "aws_route53_zone" "nami_works" {
  name         = var.domain
  private_zone = false
}

# ── Existing ACM cert (us-east-1) covering nami.works + *.nami.works ────────
# The cert's primary/subject domain name is the wildcard "*.nami.works" (the
# bare apex is only a SAN) -- the data source matches on primary domain name,
# not SANs, so we must search for the wildcard form here even though the
# distribution's alias below is the bare apex.
data "aws_acm_certificate" "site" {
  domain      = "*.${var.domain}"
  statuses    = ["ISSUED"]
  most_recent = true
}

# ── S3 bucket holding the static build output ────────────────────────────────
resource "aws_s3_bucket" "site" {
  bucket = var.bucket_name

  tags = {
    Name        = var.bucket_name
    Description = "Static Astro build for ${var.domain}"
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
    # Versioning lets us roll back a bad deploy by restoring previous object
    # versions. Bucket lifecycle (below) prunes versions older than 30 days
    # so the bill doesn't drift.
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

# ── CloudFront Origin Access Control (modern OAI replacement) ────────────────
resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.bucket_name}-oac"
  description                       = "OAC for ${var.bucket_name} S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── Bucket policy: allow CloudFront (via OAC) to GetObject ───────────────────
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
      access_control_max_age_sec = 63072000 # 2 years
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
}

# ── CloudFront Function: clean-URL rewriting (viewer-request) ────────────────
# Astro builds with `build.format: "file"` (see nami/site/astro.config.mjs)
# produce flat `.html` files but the site uses extension-less links. Without
# this, every clean URL 404s from S3. Identical logic to the omnify site's
# function — see cloudfront-functions/site-url-rewrite.js for the full comment.
resource "aws_cloudfront_function" "site_url_rewrite" {
  name    = "${var.bucket_name}-url-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite clean URLs to .html / index.html for static-site S3 origin"
  publish = true
  code    = file("${path.module}/cloudfront-functions/site-url-rewrite.js")
}

# ── CloudFront distribution ──────────────────────────────────────────────────
resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${var.domain} public site"
  price_class         = "PriceClass_100" # US/CA/EU only — Brazil traffic is fine via the EU edge
  http_version        = "http2and3"

  aliases = [var.domain]

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

    # AWS-managed CachingOptimized policy — sensible defaults for static sites.
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.site_url_rewrite.arn
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  viewer_certificate {
    acm_certificate_arn      = data.aws_acm_certificate.site.arn
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

# ── Route53 alias records (A + AAAA) pointing the apex at CloudFront ────────
# Route53 supports ALIAS at the apex natively (unlike the GoDaddy CNAME
# workaround the cpg-labs.io site needed) — one A + one AAAA record covers
# both IPv4 and IPv6 clients since the distribution has is_ipv6_enabled=true.
resource "aws_route53_record" "site_a" {
  zone_id = data.aws_route53_zone.nami_works.zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_aaaa" {
  zone_id = data.aws_route53_zone.nami_works.zone_id
  name    = var.domain
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
