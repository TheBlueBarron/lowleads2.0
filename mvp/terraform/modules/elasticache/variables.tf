variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "isolated_subnet_ids" {
  type = list(string)
}

variable "redis_sg_id" {
  type = string
}

variable "node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "num_cache_clusters" {
  type    = number
  default = 2
}

variable "multi_az_enabled" {
  type    = bool
  default = true
}

variable "automatic_failover_enabled" {
  type    = bool
  default = true
}

variable "snapshot_retention_limit" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
