variable "project" {
  type = string
}

variable "environment" {
  type = string
}

variable "aws_account_id" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
