# CloudFront distribution — Phase 1: placeholder pointing to S3 assets origin.
# Phase 2: add API origin (ALB) and Next.js app origin.

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${var.project}-${var.environment}-assets-oac"
  description                       = "OAC for ${var.project} ${var.environment} assets S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project} ${var.environment} CDN"
  default_root_object = "index.html"

  origin {
    domain_name              = var.assets_bucket_regional_domain
    origin_id                = "assets-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  # DNS aliases stubbed — wire lowleads.com after Route 53 is configured
  aliases = var.domain_aliases

  default_cache_behavior {
    target_origin_id       = "assets-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.managed_caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.managed_cors_s3.id

    function_association {
      event_type   = "viewer-response"
      function_arn = aws_cloudfront_function.security_headers.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == ""
    acm_certificate_arn            = var.acm_certificate_arn != "" ? var.acm_certificate_arn : null
    ssl_support_method             = var.acm_certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = var.acm_certificate_arn != "" ? "TLSv1.2_2021" : "TLSv1"
  }

  logging_config {
    bucket          = "${var.logs_bucket_id}.s3.amazonaws.com"
    prefix          = "cloudfront"
    include_cookies = false
  }

  tags = var.tags
}

data "aws_cloudfront_cache_policy" "managed_caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "managed_cors_s3" {
  name = "Managed-CORS-S3Origin"
}

# Security headers function (CSP, HSTS, etc.)
resource "aws_cloudfront_function" "security_headers" {
  name    = "${var.project}-${var.environment}-security-headers"
  runtime = "cloudfront-js-2.0"
  comment = "Add security headers to all responses"
  publish = true
  code    = <<-EOF
    function handler(event) {
      var response = event.response;
      var headers = response.headers;
      headers['strict-transport-security'] = { value: 'max-age=31536000; includeSubDomains; preload' };
      headers['x-frame-options'] = { value: 'DENY' };
      headers['x-content-type-options'] = { value: 'nosniff' };
      headers['referrer-policy'] = { value: 'strict-origin-when-cross-origin' };
      headers['permissions-policy'] = { value: 'camera=(), microphone=(), geolocation=()' };
      return response;
    }
  EOF
}
