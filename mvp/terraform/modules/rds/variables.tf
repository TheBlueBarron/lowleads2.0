variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "isolated_subnet_ids" {
  type = list(string)
}

variable "rds_sg_id" {
  type = string
}

variable "db_name" {
  type    = string
  default = "lowleads"
}

variable "db_username" {
  type = string
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "replica_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "allocated_storage_gb" {
  type    = number
  default = 20
}

variable "max_allocated_storage_gb" {
  type    = number
  default = 100
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "backup_retention_period" {
  type    = number
  default = 35
}

variable "enable_enhanced_monitoring" {
  type    = bool
  default = true
}

variable "enable_performance_insights" {
  type    = bool
  default = true
}

variable "create_replica" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
