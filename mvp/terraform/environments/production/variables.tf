variable "aws_region"          { type = string; default = "us-west-2" }
variable "aws_account_id"      { type = string }
variable "db_username"         { type = string; default = "lowleads" }
variable "db_password"         { type = string; sensitive = true }
variable "acm_certificate_arn" { type = string; default = "" }
variable "api_image_tag"       { type = string }
