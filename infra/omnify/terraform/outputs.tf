output "alb_dns_name" {
  value       = aws_lb.app.dns_name
  description = "ALB DNS name for GoDaddy CNAME."
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.app.repository_url
  description = "ECR repository URL."
}

output "rds_endpoint" {
  value       = var.create_rds ? aws_db_instance.app[0].endpoint : ""
  description = "RDS endpoint."
}
