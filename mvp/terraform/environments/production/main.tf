terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  backend "s3" {
    bucket         = "lowleads-terraform-state-ACCOUNT_ID"
    key            = "production/terraform.tfstate"
    region         = "us-west-2"
    dynamodb_table = "lowleads-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

locals {
  project     = "lowleads"
  environment = "production"

  common_tags = {
    Project     = local.project
    Environment = local.environment
    ManagedBy   = "terraform"
  }
}

module "vpc" {
  source      = "../../modules/vpc"
  project     = local.project
  environment = local.environment
  vpc_cidr    = "10.1.0.0/16"
  tags        = local.common_tags
}

module "s3" {
  source         = "../../modules/s3"
  project        = local.project
  environment    = local.environment
  aws_account_id = var.aws_account_id
  tags           = local.common_tags
}

module "secrets" {
  source            = "../../modules/secrets"
  project           = local.project
  environment       = local.environment
  aws_account_id    = var.aws_account_id
  ecs_task_role_arn = "arn:aws:iam::${var.aws_account_id}:role/${local.project}-${local.environment}-ecs-task"
  tags              = local.common_tags
}

module "rds" {
  source              = "../../modules/rds"
  project             = local.project
  environment         = local.environment
  isolated_subnet_ids = module.vpc.isolated_subnet_ids
  rds_sg_id           = module.vpc.rds_sg_id
  db_username         = var.db_username
  db_password         = var.db_password
  instance_class      = "db.t4g.large"
  replica_instance_class = "db.t4g.medium"
  allocated_storage_gb  = 50
  max_allocated_storage_gb = 200
  tags                = local.common_tags
}

module "elasticache" {
  source              = "../../modules/elasticache"
  project             = local.project
  environment         = local.environment
  isolated_subnet_ids = module.vpc.isolated_subnet_ids
  redis_sg_id         = module.vpc.redis_sg_id
  node_type           = "cache.t4g.small"
  tags                = local.common_tags
}

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
  app_url           = "https://lowleads.com"
  acm_certificate_arn = var.acm_certificate_arn
  image_tag         = var.api_image_tag
  task_cpu          = 1024
  task_memory       = 2048
  desired_count     = 2
  tags              = local.common_tags

  depends_on = [module.secrets]
}

module "cloudfront" {
  source                       = "../../modules/cloudfront"
  project                      = local.project
  environment                  = local.environment
  assets_bucket_regional_domain = "${module.s3.assets_bucket_id}.s3.${var.aws_region}.amazonaws.com"
  logs_bucket_id               = module.s3.logs_bucket_id
  acm_certificate_arn          = var.acm_certificate_arn
  domain_aliases               = ["lowleads.com", "www.lowleads.com"]
  tags                         = local.common_tags
}
