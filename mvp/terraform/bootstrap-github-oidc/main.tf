terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

locals {
  github_oidc_url = "https://token.actions.githubusercontent.com"
  github_oidc_aud = "sts.amazonaws.com"
  repo_sub        = "repo:${var.github_owner}/${var.github_repo}"
}

# ─── OIDC provider (one per AWS account) ──────────────────────────────────────
# Thumbprint is fetched dynamically from GitHub's TLS cert chain.

data "tls_certificate" "github" {
  url = local.github_oidc_url
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = local.github_oidc_url
  client_id_list  = [local.github_oidc_aud]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]

  tags = {
    Project   = var.project_name
    ManagedBy = "terraform-bootstrap-oidc"
  }
}

# ─── Role 1: ECR push/pull (used by docker-build job on all branches) ─────────

data "aws_iam_policy_document" "ecr_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = [local.github_oidc_aud]
    }

    # Allow any branch + PR for ECR — the role only has scoped ECR perms.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.repo_sub}:*"]
    }
  }
}

resource "aws_iam_role" "ecr" {
  name               = "github-actions-ecr"
  assume_role_policy = data.aws_iam_policy_document.ecr_trust.json
  max_session_duration = 3600

  tags = {
    Project   = var.project_name
    ManagedBy = "terraform-bootstrap-oidc"
  }
}

data "aws_iam_policy_document" "ecr_perms" {
  # Auth token is account-wide (not resource-scoped in IAM)
  statement {
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Push/pull scoped to the lowleads ECR namespace
  statement {
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
      "ecr:DescribeRepositories",
      "ecr:DescribeImages",
      "ecr:ListImages",
    ]
    resources = [
      "arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/lowleads/*",
    ]
  }
}

resource "aws_iam_role_policy" "ecr" {
  name   = "ecr-push-pull"
  role   = aws_iam_role.ecr.id
  policy = data.aws_iam_policy_document.ecr_perms.json
}

# ─── Role 2: ECS deploy staging ───────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_staging_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = [local.github_oidc_aud]
    }

    # Only the staging GitHub Environment can assume this role.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.repo_sub}:environment:staging"]
    }
  }
}

resource "aws_iam_role" "ecs_staging" {
  name                 = "github-actions-ecs-deploy"
  assume_role_policy   = data.aws_iam_policy_document.ecs_staging_trust.json
  max_session_duration = 3600

  tags = {
    Project   = var.project_name
    ManagedBy = "terraform-bootstrap-oidc"
  }
}

data "aws_iam_policy_document" "ecs_staging_perms" {
  statement {
    effect = "Allow"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
      "ecs:ListTasks",
      "ecs:DescribeTasks",
    ]
    resources = ["*"]
  }

  # PassRole for the ECS task + execution roles (so a new task def can reference them)
  statement {
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${var.aws_account_id}:role/lowleads-staging-ecs-task",
      "arn:aws:iam::${var.aws_account_id}:role/lowleads-staging-ecs-task-execution",
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ecs_staging" {
  name   = "ecs-deploy-staging"
  role   = aws_iam_role.ecs_staging.id
  policy = data.aws_iam_policy_document.ecs_staging_perms.json
}

# ─── Role 3: ECS deploy production ────────────────────────────────────────────

data "aws_iam_policy_document" "ecs_prod_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = [local.github_oidc_aud]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${local.repo_sub}:environment:production"]
    }
  }
}

resource "aws_iam_role" "ecs_prod" {
  name                 = "github-actions-ecs-deploy-prod"
  assume_role_policy   = data.aws_iam_policy_document.ecs_prod_trust.json
  max_session_duration = 3600

  tags = {
    Project   = var.project_name
    ManagedBy = "terraform-bootstrap-oidc"
  }
}

data "aws_iam_policy_document" "ecs_prod_perms" {
  statement {
    effect = "Allow"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:DescribeTaskDefinition",
      "ecs:RegisterTaskDefinition",
      "ecs:ListTasks",
      "ecs:DescribeTasks",
    ]
    resources = ["*"]
  }

  statement {
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      "arn:aws:iam::${var.aws_account_id}:role/lowleads-production-ecs-task",
      "arn:aws:iam::${var.aws_account_id}:role/lowleads-production-ecs-task-execution",
    ]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ecs_prod" {
  name   = "ecs-deploy-production"
  role   = aws_iam_role.ecs_prod.id
  policy = data.aws_iam_policy_document.ecs_prod_perms.json
}
