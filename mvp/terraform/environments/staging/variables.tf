variable "aws_region" {
  type    = string
  default = "us-west-2"
}

variable "aws_profile" {
  type    = string
  default = "lowleads-dev"
}

variable "aws_account_id" {
  type        = string
  description = "AWS account ID"
}

variable "db_username" {
  type    = string
  default = "lowleads"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "api_image_tag" {
  type    = string
  default = "latest"
}
