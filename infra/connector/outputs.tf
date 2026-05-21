output "ecr_repository_url" {
  description = "Pass to `docker push` in scripts/deploy.ps1."
  value       = aws_ecr_repository.gateway.repository_url
}

output "ecs_cluster_name" {
  value = var.ecs_cluster_name
}

output "ecs_service_name" {
  value = aws_ecs_service.gateway.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.gateway.family
}

output "cloudwatch_log_group" {
  value = aws_cloudwatch_log_group.gateway.name
}

output "route53_name_servers" {
  description = "Copy these four values into the registrar's NS records for nami.works. Required before ACM validation completes."
  value       = aws_route53_zone.main.name_servers
}

output "mcp_hostname" {
  value = aws_route53_record.mcp.fqdn
}

output "database_url_ssm_param" {
  description = "The task consumes this as an env var via `secrets`. The value is a Postgres DSN."
  value       = aws_ssm_parameter.database_url.name
}

output "rds_endpoint" {
  description = "For ad-hoc psql or prisma migrate deploy from the operator laptop. Reach via VPN / SSH tunnel / bastion — the instance is private."
  value       = aws_db_instance.nami_works.endpoint
  sensitive   = false
}
