# ─── Assets bucket — logos, documents, served via CloudFront ─────────────────

resource "aws_s3_bucket" "assets" {
  bucket = "${var.project}-${var.environment}-assets-${var.aws_account_id}"
  tags   = merge(var.tags, { Name = "assets", Purpose = "user-uploads" })
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id

  rule {
    id     = "archive-noncurrent"
    status = "Enabled"

    filter {}

    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "GLACIER"
    }

    noncurrent_version_expiration {
      noncurrent_days = 365
    }
  }
}

# ─── Logs bucket — ALB access logs, CloudFront logs ──────────────────────────

resource "aws_s3_bucket" "logs" {
  bucket = "${var.project}-${var.environment}-logs-${var.aws_account_id}"
  tags   = merge(var.tags, { Name = "logs", Purpose = "access-logs" })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-logs"
    status = "Enabled"

    filter {}

    expiration { days = 90 }
  }
}

# ALB access logging requires an explicit bucket policy granting the
# regional ELB service account permission to PutObject.
# us-west-2 ELB account ID: 797873946194
# https://docs.aws.amazon.com/elasticloadbalancing/latest/application/enable-access-logging.html
resource "aws_s3_bucket_policy" "logs_alb_access" {
  bucket = aws_s3_bucket.logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowELBAccessLogs"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::797873946194:root" }
      Action    = "s3:PutObject"
      Resource  = "${aws_s3_bucket.logs.arn}/alb/AWSLogs/${var.aws_account_id}/*"
    }]
  })
}
