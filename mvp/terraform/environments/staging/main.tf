terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  backend "s3" {
    # Partial config — bucket is supplied at init time so the account ID is
    # never committed. Initialise with:
    #   cp backend.hcl.example backend.hcl   # fill in your account ID
    #   terraform init -backend-config=backend.hcl
    key            = "staging/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "lowleads-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = local.common_tags
  }
}

locals {
  project     = "lowleads"
  environment = "staging"

  common_tags = {
    Project     = local.project
    Environment = local.environment
    ManagedBy   = "terraform"
  }
}

# ─── VPC ──────────────────────────────────────────────────────────────────────

module "vpc" {
  source      = "../../modules/vpc"
  project     = local.project
  environment = local.environment
  vpc_cidr    = "10.0.0.0/16"
  tags        = local.common_tags
}

# ─── S3 ───────────────────────────────────────────────────────────────────────

module "s3" {
  source         = "../../modules/s3"
  project        = local.project
  environment    = local.environment
  aws_account_id = var.aws_account_id
  tags           = local.common_tags
}

# ─── ECS (creates task role — referenced by secrets module) ───────────────────
# Two-pass: first apply without secrets, then apply secrets with task_role_arn

module "ecs" {
  source            = "../../modules/ecs"
  project           = local.project
  environment       = local.environment
  aws_region        = var.aws_region
  aws_account_id    = var.aws_account_id
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  private_subnet_ids = module.vpc.private_subnet_ids
  alb_sg_id         = module.vpc.alb_sg_id
  ecs_sg_id         = module.vpc.ecs_sg_id
  kms_key_arn       = module.secrets.kms_key_arn
  assets_bucket_arn = module.s3.assets_bucket_arn
  logs_bucket_id    = module.s3.logs_bucket_id
  app_url             = "https://staging.lowleads.com"
  acm_certificate_arn = "arn:aws:acm:us-west-2:858758524548:certificate/74c92ec0-a86f-4a45-8a74-cc6de09076e3"
  image_tag           = var.api_image_tag
  desired_count     = 1
  tags              = local.common_tags

  depends_on = [module.secrets]
}

# ─── Secrets & KMS ────────────────────────────────────────────────────────────

module "secrets" {
  source            = "../../modules/secrets"
  project           = local.project
  environment       = local.environment
  aws_account_id    = var.aws_account_id
  # Bootstrap: use a placeholder ARN on first apply; update after ECS role is created
  ecs_task_role_arn = "arn:aws:iam::${var.aws_account_id}:role/${local.project}-${local.environment}-ecs-task"
  tags              = local.common_tags
}

# ─── RDS ──────────────────────────────────────────────────────────────────────

module "rds" {
  source              = "../../modules/rds"
  project             = local.project
  environment         = local.environment
  isolated_subnet_ids = module.vpc.isolated_subnet_ids
  rds_sg_id           = module.vpc.rds_sg_id
  db_username         = var.db_username
  db_password         = var.db_password

  # Free-Plan compatible config. Scale up after upgrading AWS account.
  instance_class              = "db.t3.micro"
  multi_az                    = false
  backup_retention_period     = 1
  enable_enhanced_monitoring  = false
  enable_performance_insights = false
  create_replica              = false

  tags = local.common_tags
}

# ─── ElastiCache ──────────────────────────────────────────────────────────────

module "elasticache" {
  source              = "../../modules/elasticache"
  project             = local.project
  environment         = local.environment
  isolated_subnet_ids = module.vpc.isolated_subnet_ids
  redis_sg_id         = module.vpc.redis_sg_id
  node_type           = "cache.t4g.micro"

  # Free-Plan compatible: single node, no failover, no multi-AZ.
  num_cache_clusters         = 1
  multi_az_enabled           = false
  automatic_failover_enabled = false
  snapshot_retention_limit   = 1

  tags = local.common_tags
}

# ─── CloudFront ───────────────────────────────────────────────────────────────
# Temporarily disabled: new AWS accounts must be verified by AWS Support
# before CloudFront distributions can be created. Re-enable this module
# once support replies to the verification request. The API does not
# depend on CloudFront to function — it only fronts the assets bucket.
#
# module "cloudfront" {
#   source                        = "../../modules/cloudfront"
#   project                       = local.project
#   environment                   = local.environment
#   assets_bucket_regional_domain = module.s3.assets_bucket_id == "" ? "" : "${module.s3.assets_bucket_id}.s3.${var.aws_region}.amazonaws.com"
#   logs_bucket_id                = module.s3.logs_bucket_id
#   # domain_aliases and acm_certificate_arn: add after domain is configured
#   tags                          = local.common_tags
# }
