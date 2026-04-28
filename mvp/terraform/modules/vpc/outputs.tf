output "vpc_id"              { value = aws_vpc.main.id }
output "public_subnet_ids"  { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "isolated_subnet_ids"{ value = aws_subnet.isolated[*].id }
output "alb_sg_id"          { value = aws_security_group.alb.id }
output "ecs_sg_id"          { value = aws_security_group.ecs_tasks.id }
output "rds_sg_id"          { value = aws_security_group.rds.id }
output "redis_sg_id"        { value = aws_security_group.redis.id }
