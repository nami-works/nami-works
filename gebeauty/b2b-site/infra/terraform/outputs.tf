output "acm_validation_record" {
  value = {
    for dvo in aws_acm_certificate.site.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
  description = "ACM DNS validation record to add at registro.br BEFORE running the full apply (apply -target=aws_acm_certificate.site first to get this)."
}

output "site_bucket_name" {
  value       = aws_s3_bucket.site.id
  description = "S3 bucket holding the two decks."
}

output "site_cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.site.id
  description = "CloudFront distribution ID -- used by _b2b_deploy_site.py for cache invalidation."
}

output "site_cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.site.domain_name
  description = "CloudFront edge hostname (e.g. dXXXX.cloudfront.net) -- add this as a CNAME at registro.br (b2b -> this value) once the distribution is deployed. Also usable for smoke-testing directly before DNS propagates."
}

output "client_credentials_store_name" {
  value       = aws_cloudfront_key_value_store.b2b_clients.name
  description = "CloudFront KeyValueStore holding per-client Basic Auth credentials. Manage entries with gebeauty/scripts/_b2b_manage_client_access.py, not Terraform."
}

output "access_logs_bucket" {
  value       = aws_s3_bucket.logs.id
  description = "S3 bucket receiving CloudFront standard access logs (cloudfront/ prefix) -- each client hit is tagged with ?_c=<client name> via the tracking redirect in viewer-request.js."
}
