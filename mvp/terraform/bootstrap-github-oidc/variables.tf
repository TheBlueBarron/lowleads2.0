variable "aws_region" {
  description = "AWS region — IAM is global but provider needs one"
  type        = string
  default     = "us-west-2"
}

variable "aws_profile" {
  description = "Named AWS CLI profile for local authentication"
  type        = string
  default     = "lowleads-dev"
}

variable "aws_account_id" {
  description = "AWS account ID — used to build resource ARNs in role policies"
  type        = string
}

variable "project_name" {
  description = "Project identifier used in resource tags"
  type        = string
  default     = "lowleads"
}

variable "github_owner" {
  description = "GitHub org/user that owns the repo (used in OIDC trust condition sub claim)"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (used in OIDC trust condition sub claim)"
  type        = string
  default     = "lowleads"
}
