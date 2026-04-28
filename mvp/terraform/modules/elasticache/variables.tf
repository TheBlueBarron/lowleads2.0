variable "project"             { type = string }
variable "environment"         { type = string }
variable "isolated_subnet_ids" { type = list(string) }
variable "redis_sg_id"         { type = string }
variable "node_type"           { type = string; default = "cache.t4g.micro" }
variable "tags"                { type = map(string); default = {} }
