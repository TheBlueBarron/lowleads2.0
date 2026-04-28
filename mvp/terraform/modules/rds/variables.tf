variable "project"             { type = string }
variable "environment"         { type = string }
variable "isolated_subnet_ids" { type = list(string) }
variable "rds_sg_id"           { type = string }
variable "db_name"             { type = string; default = "lowleads" }
variable "db_username"         { type = string }
variable "db_password"         { type = string; sensitive = true }
variable "instance_class"      { type = string; default = "db.t4g.medium" }
variable "replica_instance_class" { type = string; default = "db.t4g.medium" }
variable "allocated_storage_gb"     { type = number; default = 20 }
variable "max_allocated_storage_gb" { type = number; default = 100 }
variable "tags"                { type = map(string); default = {} }
