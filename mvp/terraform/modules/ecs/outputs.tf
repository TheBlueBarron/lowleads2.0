output "cluster_name"       { value = aws_ecs_cluster.main.name }
output "cluster_arn"        { value = aws_ecs_cluster.main.arn }
output "service_name"       { value = aws_ecs_service.api.name }
output "ecr_repository_url" { value = aws_ecr_repository.api.repository_url }
output "alb_dns_name"       { value = aws_lb.main.dns_name }
output "alb_arn"            { value = aws_lb.main.arn }
output "task_role_arn"      { value = aws_iam_role.ecs_task.arn }
output "execution_role_arn" { value = aws_iam_role.ecs_task_execution.arn }
