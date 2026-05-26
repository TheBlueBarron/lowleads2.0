# ─── KMS key for field-level encryption (PII, MFA secrets) ───────────────────

resource "aws_kms_key" "field_encryption" {
  description             = "${var.project} ${var.environment} - field-level encryption (PII, MFA)"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  # ECS task role access is granted via the task role's own IAM policy
  # (see modules/ecs/main.tf: ecs_task_kms). The root principal here
  # delegates to IAM so that policy is honored. Adding the role here
  # directly would fail on first apply because the role doesn't exist yet.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "EnableRootAccess"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      }
    ]
  })

  tags = merge(var.tags, { Name = "${var.project}-${var.environment}-field-encryption" })
}

resource "aws_kms_alias" "field_encryption" {
  name          = "alias/${var.project}-${var.environment}-field-encryption"
  target_key_id = aws_kms_key.field_encryption.key_id
}

# ─── Secrets Manager secrets ──────────────────────────────────────────────────
# Placeholder values — real values are populated manually or by a separate
# secure provisioning process. Never store real secrets in Terraform state.

resource "aws_secretsmanager_secret" "database" {
  name                    = "lowleads/${var.environment}/database"
  description             = "PostgreSQL connection strings"
  kms_key_id              = aws_kms_key.field_encryption.arn
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id = aws_secretsmanager_secret.database.id
  secret_string = jsonencode({
    url         = "PLACEHOLDER — set via AWS Console or Secrets Manager CLI"
    replica_url = "PLACEHOLDER"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "redis" {
  name                    = "lowleads/${var.environment}/redis"
  description             = "Redis connection URL"
  kms_key_id              = aws_kms_key.field_encryption.arn
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id     = aws_secretsmanager_secret.redis.id
  secret_string = jsonencode({ url = "PLACEHOLDER" })
  lifecycle { ignore_changes = [secret_string] }
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "lowleads/${var.environment}/jwt"
  description             = "JWT signing secrets and cookie secret"
  kms_key_id              = aws_kms_key.field_encryption.arn
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id = aws_secretsmanager_secret.jwt.id
  secret_string = jsonencode({
    access_secret        = "PLACEHOLDER"
    refresh_hmac_secret  = "PLACEHOLDER"
    email_secret         = "PLACEHOLDER"
    password_reset_secret = "PLACEHOLDER"
    cookie_secret        = "PLACEHOLDER"
  })
  lifecycle { ignore_changes = [secret_string] }
}

resource "aws_secretsmanager_secret" "kms" {
  name                    = "lowleads/${var.environment}/kms"
  description             = "KMS key ID for field-level encryption"
  kms_key_id              = aws_kms_key.field_encryption.arn
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "kms" {
  secret_id     = aws_secretsmanager_secret.kms.id
  secret_string = jsonencode({ key_id = aws_kms_key.field_encryption.key_id })
  lifecycle { ignore_changes = [secret_string] }
}

resource "aws_secretsmanager_secret" "ses" {
  name                    = "lowleads/${var.environment}/ses"
  description             = "SES sender email address"
  kms_key_id              = aws_kms_key.field_encryption.arn
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "ses" {
  secret_id     = aws_secretsmanager_secret.ses.id
  secret_string = jsonencode({ from_email = "noreply@lowleads.com" })
  lifecycle { ignore_changes = [secret_string] }
}

resource "aws_secretsmanager_secret" "stripe" {
  name                    = "lowleads/${var.environment}/stripe"
  description             = "Stripe API keys (Phase 2)"
  kms_key_id              = aws_kms_key.field_encryption.arn
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "stripe" {
  secret_id = aws_secretsmanager_secret.stripe.id
  secret_string = jsonencode({
    secret_key      = "PLACEHOLDER"
    webhook_secret  = "PLACEHOLDER"
  })
  lifecycle { ignore_changes = [secret_string] }
}

resource "aws_secretsmanager_secret" "twilio" {
  name                    = "lowleads/${var.environment}/twilio"
  description             = "Twilio credentials (Phase 2)"
  kms_key_id              = aws_kms_key.field_encryption.arn
  recovery_window_in_days = 7
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "twilio" {
  secret_id = aws_secretsmanager_secret.twilio.id
  secret_string = jsonencode({
    account_sid = "PLACEHOLDER"
    auth_token  = "PLACEHOLDER"
  })
  lifecycle { ignore_changes = [secret_string] }
}
