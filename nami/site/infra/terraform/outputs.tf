output "site_bucket_name" {
  value       = aws_s3_bucket.site.id
  description = "S3 bucket holding the static Astro build."
}

output "site_cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.site.id
  description = "CloudFront distribution ID — used by scripts/deploy-nami-site.ps1 for cache invalidation."
}

output "site_cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.site.domain_name
  description = "CloudFront edge hostname (e.g. dXXXX.cloudfront.net) — usable for smoke testing independent of DNS."
}

output "route53_zone_id" {
  value       = data.aws_route53_zone.nami_works.zone_id
  description = "The existing nami.works hosted zone this module wrote alias records into."
}

output "lead_intake_function_url" {
  value       = aws_lambda_function_url.lead_intake.function_url
  description = "Public endpoint for the Diagnostico lead-capture form's action attribute."
}
