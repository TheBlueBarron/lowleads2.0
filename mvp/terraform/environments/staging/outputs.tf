output "rds_primary_endpoint" {
  description = "RDS Postgres primary endpoint (host:port). Use to build DATABASE_URL."
  value       = module.rds.primary_endpoint
}

output "rds_replica_endpoint" {
  description = "RDS replica endpoint, or primary if no replica was created."
  value       = module.rds.replica_endpoint
}

output "rds_db_name" {
  description = "Default database name created on the RDS instance."
  value       = module.rds.db_name
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary endpoint hostname."
  value       = module.elasticache.primary_endpoint
}

output "kms_key_arn" {
  description = "KMS key ARN for field-level encryption."
  value       = module.secrets.kms_key_arn
}

output "alb_dns_name" {
  description = "Public DNS of the Application Load Balancer."
  value       = module.ecs.alb_dns_name
}
