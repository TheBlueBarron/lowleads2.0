# Auto-discover the latest available Postgres 16.x version
# (AWS deprecates minor versions over time; hardcoding breaks deploys later).
# Constrained to family "postgres16" — Postgres 17+ changes parameter semantics
# (e.g. log_connections becomes an enum) which would break our parameter group.
data "aws_rds_engine_version" "postgres" {
  engine                 = "postgres"
  parameter_group_family = "postgres16"
  latest                 = true
  default_only           = false
  filter {
    name   = "engine-mode"
    values = ["provisioned"]
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-${var.environment}-rds"
  subnet_ids = var.isolated_subnet_ids

  tags = merge(var.tags, { Name = "${var.project}-${var.environment}-rds-subnet-group" })
}

resource "aws_db_parameter_group" "postgres16" {
  name   = "${var.project}-${var.environment}-postgres16"
  family = data.aws_rds_engine_version.postgres.parameter_group_family

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_duration"
    value = "1"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "30000"
  }

  parameter {
    name  = "statement_timeout"
    value = "30000"
  }

  tags = var.tags
}

resource "aws_db_instance" "primary" {
  identifier = "${var.project}-${var.environment}-postgres"

  engine               = "postgres"
  engine_version       = data.aws_rds_engine_version.postgres.version
  instance_class       = var.instance_class
  allocated_storage    = var.allocated_storage_gb
  max_allocated_storage = var.max_allocated_storage_gb
  storage_type         = "gp3"
  storage_encrypted    = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  parameter_group_name = aws_db_parameter_group.postgres16.name
  db_subnet_group_name = aws_db_subnet_group.main.name

  vpc_security_group_ids = [var.rds_sg_id]

  multi_az               = var.multi_az
  publicly_accessible    = false
  deletion_protection    = var.environment == "production"

  backup_retention_period  = var.backup_retention_period
  backup_window            = "03:00-04:00"
  maintenance_window       = "Mon:04:00-Mon:05:00"

  # Point-in-time recovery enabled (backup_retention_period > 0)
  # RDS automatically handles PITR at any 5-minute window

  monitoring_interval = var.enable_enhanced_monitoring ? 60 : 0
  monitoring_role_arn = var.enable_enhanced_monitoring ? aws_iam_role.rds_enhanced_monitoring[0].arn : null

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  performance_insights_enabled          = var.enable_performance_insights
  performance_insights_retention_period = var.enable_performance_insights ? 7 : null

  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = "${var.project}-${var.environment}-final-snapshot"

  apply_immediately = var.environment != "production"

  tags = merge(var.tags, { Name = "${var.project}-${var.environment}-postgres" })
}

resource "aws_db_instance" "replica" {
  count               = var.create_replica ? 1 : 0
  identifier          = "${var.project}-${var.environment}-postgres-replica"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.replica_instance_class

  storage_encrypted   = true
  publicly_accessible = false
  multi_az            = false

  monitoring_interval = var.enable_enhanced_monitoring ? 60 : 0
  monitoring_role_arn = var.enable_enhanced_monitoring ? aws_iam_role.rds_enhanced_monitoring[0].arn : null

  performance_insights_enabled = var.enable_performance_insights

  skip_final_snapshot = true
  apply_immediately   = true

  tags = merge(var.tags, { Name = "${var.project}-${var.environment}-postgres-replica" })
}

# ─── Enhanced monitoring IAM role ─────────────────────────────────────────────

resource "aws_iam_role" "rds_enhanced_monitoring" {
  count = var.enable_enhanced_monitoring ? 1 : 0
  name  = "${var.project}-${var.environment}-rds-monitoring"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "rds_enhanced_monitoring" {
  count      = var.enable_enhanced_monitoring ? 1 : 0
  role       = aws_iam_role.rds_enhanced_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
