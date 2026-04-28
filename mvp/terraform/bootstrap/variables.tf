variable "aws_region" {
  description = "AWS region for bootstrap resources"
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "Named AWS CLI profile for local authentication"
  type        = string
  default     = "lowleads-dev"
}

variable "aws_account_id" {
  description = "AWS account ID — used to ensure globally unique S3 bucket name"
  type        = string
}

variable "project_name" {
  description = "Project identifier used as prefix for all bootstrap resources"
  type        = string
  default     = "lowleads"
}
