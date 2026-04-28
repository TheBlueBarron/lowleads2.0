output "kms_key_id"          { value = aws_kms_key.field_encryption.key_id }
output "kms_key_arn"         { value = aws_kms_key.field_encryption.arn }
output "database_secret_arn" { value = aws_secretsmanager_secret.database.arn }
output "redis_secret_arn"    { value = aws_secretsmanager_secret.redis.arn }
output "jwt_secret_arn"      { value = aws_secretsmanager_secret.jwt.arn }
output "stripe_secret_arn"   { value = aws_secretsmanager_secret.stripe.arn }
output "twilio_secret_arn"   { value = aws_secretsmanager_secret.twilio.arn }
