variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "assets_bucket_regional_domain" {
  type = string
}

variable "logs_bucket_id" {
  type = string
}

variable "acm_certificate_arn" {
  type    = string
  default = ""
}

variable "domain_aliases" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
