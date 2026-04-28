resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-${var.environment}-rds"
  subnet_ids = var.isolated_subnet_ids

  tags = merge(var.tags, { Name = "${var.project}-${var.environment}-rds-subnet-group" })
}

resource "aws_db_parameter_group" "postgres16" {
  name   = "${var.project}-${var.environment}-postgres16"
  family = "postgres16"

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
  engine_version       = "16.3"
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

  multi_az               = true
  publicly_accessible    = false
  deletion_protection    = var.environment == "production"

  backup_retention_period  = 35
  backup_window            = "03:00-04:00"
  maintenance_window       = "Mon:04:00-Mon:05:00"

  # Point-in-time recovery enabled (backup_retention_period > 0)
  # RDS automatically handles PITR at any 5-minute window

  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_enhanced_monitoring.arn

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = "${var.project}-${var.environment}-final-snapshot"

  apply_immediately = var.environment != "production"

  tags = merge(var.tags, { Name = "${var.project}-${var.environment}-postgres" })
}

resource "aws_db_instance" "replica" {
  identifier          = "${var.project}-${var.environment}-postgres-replica"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.replica_instance_class

  storage_encrypted   = true
  publicly_accessible = false
  multi_az            = false

  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_enhanced_monitoring.arn

  performance_insights_enabled = true

  skip_final_snapshot = true
  apply_immediately   = true

  tags = merge(var.tags, { Name = "${var.project}-${var.environment}-postgres-replica" })
}

# ─── Enhanced monitoring IAM role ─────────────────────────────────────────────

resource "aws_iam_role" "rds_enhanced_monitoring" {
  name = "${var.project}-${var.environment}-rds-monitoring"

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
  role       = aws_iam_role.rds_enhanced_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
