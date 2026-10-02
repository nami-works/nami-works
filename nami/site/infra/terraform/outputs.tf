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

output "matchmaking_api_url" {
  value       = aws_lambda_function_url.matchmaking_api.function_url
  description = "Public endpoint for the matchmaking funnel. scripts/deploy-nami-site.ps1 bakes it into the build as PUBLIC_MATCHMAKING_API_BASE."
}

output "matchmaking_table_name" {
  value       = aws_dynamodb_table.matchmaking.name
  description = "DynamoDB table holding every matchmaking submission (one item per visitor who finished the quiz)."
}

output "lead_intake_function_url" {
  value       = aws_lambda_function_url.lead_intake.function_url
  description = "Public endpoint for the Diagnostico lead-capture form's action attribute."
}
