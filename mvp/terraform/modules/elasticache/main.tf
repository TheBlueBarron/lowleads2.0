resource "aws_elasticache_subnet_group" "main" {
  name       = "${var.project}-${var.environment}-redis"
  subnet_ids = var.isolated_subnet_ids

  tags = var.tags
}

resource "aws_elasticache_parameter_group" "redis7" {
  name   = "${var.project}-${var.environment}-redis7"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.project}-${var.environment}-redis"
  description          = "Lowleads ${var.environment} Redis — sessions, rate limits, queues"

  node_type            = var.node_type
  num_cache_clusters   = 2
  automatic_failover_enabled = true
  multi_az_enabled     = true

  engine               = "redis"
  engine_version       = "7.1"
  parameter_group_name = aws_elasticache_parameter_group.redis7.name

  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [var.redis_sg_id]

  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true

  maintenance_window   = "tue:04:00-tue:05:00"
  snapshot_window      = "03:00-04:00"
  snapshot_retention_limit = 7

  apply_immediately = var.environment != "production"

  tags = merge(var.tags, { Name = "${var.project}-${var.environment}-redis" })
}
