# ─────────────────────────────────────────────────────────────────────────────
# Public site (cpg-labs.io) — static Astro build served from S3 via CloudFront.
#
# Phase 2 of the marketing-admin split (see CLAUDE.md "Public Site"). This
# stands up the S3 bucket + CloudFront distribution + bucket policy ALONGSIDE
# the existing ALB-served site. Production is unaffected: no DNS changes here.
# Phase 3 cuts DNS over from the ALB to CloudFront at GoDaddy and removes the
# www.cpg-labs.io listener rule from alb.tf.
#
# Architecture:
#                              ┌──────────────────────────────────┐
#                              │  GoDaddy DNS (ns29/30.domain...) │
#                              │  cpg-labs.io  → forward → www    │
#                              │  www.*        → CNAME → CF (P3)  │
#                              └────────────┬─────────────────────┘
#                                           ▼
#                           ┌────────────────────────────────────┐
#                           │ aws_cloudfront_distribution.site   │
#                           │   aliases: cpg-labs.io, www.*      │
#                           │   cert: 588d00ef-... (existing)    │
#                           │   OAC → S3 (no public bucket)      │
#                           └────────────┬───────────────────────┘
#                                        ▼
#                            ┌────────────────────────────┐
#                            │ aws_s3_bucket.site         │
#                            │   private, versioned, SSE  │
#                            │   contents: site/dist/*    │
#                            └────────────────────────────┘
# ─────────────────────────────────────────────────────────────────────────────

# ── Existing ACM cert (us-east-1) covering cpg-labs.io + www.cpg-labs.io ─────
# The cert was created manually pre-Phase-2 (already InUseBy the ALB). We
# reuse it; no validation roundtrip needed. CloudFront requires certs in
# us-east-1 — the provider in providers.tf already targets us-east-1, so a
# data lookup (rather than a hardcoded ARN) is safe and self-documenting.
data "aws_acm_certificate" "site" {
  domain      = "cpg-labs.io"
  statuses    = ["ISSUED"]
  most_recent = true
}

# ── S3 bucket holding the static build output ────────────────────────────────
resource "aws_s3_bucket" "site" {
  bucket = "cpg-labs-site"

  tags = {
    Name        = "cpg-labs-site"
    Description = "Static Astro build for cpg-labs.io"
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
  name                              = "cpg-labs-site-oac"
  description                       = "OAC for cpg-labs-site S3 bucket"
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
# CSP is permissive on third-party fonts since the site loads admin Inter via
# cdn.shopify.com. If/when the site self-hosts fonts, tighten to 'self'.
resource "aws_cloudfront_response_headers_policy" "site" {
  name = "cpg-labs-site-headers"

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
# Astro builds with `build.format: "file"` produce flat `.html` files
# (`/about.html`, `/pricing.html`, etc.) but the site uses extension-less
# links (`/about`, `/pricing`). Without a rewriter, every clean URL 404s
# from S3. This function appends `.html` to extension-less paths and
# `index.html` to trailing-slash paths.
#
# The wall-closure deploy on 2026-05-03 exposed this latent issue: the
# admin app's `_site.*` routes were masking it by serving the same paths
# from the embedded ECS app. Once those routes were deleted, the bare-S3
# 404 surfaced. Function lives at cloudfront-functions/site-url-rewrite.js.
resource "aws_cloudfront_function" "site_url_rewrite" {
  name    = "cpg-labs-site-url-rewrite"
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
  comment             = "cpg-labs.io public site"
  price_class         = "PriceClass_100" # US/CA/EU only — Brazil traffic is fine via the EU edge
  http_version        = "http2and3"

  aliases = ["cpg-labs.io", "www.cpg-labs.io"]

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-cpg-labs-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-cpg-labs-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # AWS-managed CachingOptimized policy — sensible defaults for static sites.
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id

    # Rewrite clean URLs (/about) → .html (/about.html) at the edge so the
    # S3 origin can resolve them. See aws_cloudfront_function.site_url_rewrite.
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
    Name      = "cpg-labs-site"
    ManagedBy = "terraform"
  }
}

# ── Outputs ──────────────────────────────────────────────────────────────────
output "site_bucket_name" {
  value       = aws_s3_bucket.site.id
  description = "S3 bucket holding the static Astro build."
}

output "site_cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.site.id
  description = "CloudFront distribution ID — used by scripts/deploy-site.ps1 for cache invalidation."
}

output "site_cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.site.domain_name
  description = "CloudFront edge hostname (e.g. dXXXX.cloudfront.net) — used for Phase 2 smoke testing before DNS flip."
}
