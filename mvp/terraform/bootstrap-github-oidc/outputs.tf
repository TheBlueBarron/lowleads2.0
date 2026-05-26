output "oidc_provider_arn" {
  description = "ARN of the GitHub Actions OIDC provider"
  value       = aws_iam_openid_connect_provider.github.arn
}

output "ecr_role_arn" {
  description = "Role assumed by CI for ECR push/pull (docker-build job)"
  value       = aws_iam_role.ecr.arn
}

output "ecs_staging_role_arn" {
  description = "Role assumed by CI for ECS staging deploy"
  value       = aws_iam_role.ecs_staging.arn
}

output "ecs_production_role_arn" {
  description = "Role assumed by CI for ECS production deploy"
  value       = aws_iam_role.ecs_prod.arn
}
