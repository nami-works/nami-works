output "ecr_repository_url" {
  value       = aws_ecr_repository.fulfillment.repository_url
  description = "Consumed by scripts/deploy-fulfillment.ps1 for `docker push`."
}

output "task_execution_role_arn" {
  value       = aws_iam_role.task_execution.arn
  description = "ECS task-def `executionRoleArn`."
}

output "task_app_role_arn" {
  value       = aws_iam_role.task_app.arn
  description = "ECS task-def `taskRoleArn`."
}

output "log_group_name" {
  value       = aws_cloudwatch_log_group.fulfillment.name
  description = "CloudWatch log group for ECS task logs."
}
