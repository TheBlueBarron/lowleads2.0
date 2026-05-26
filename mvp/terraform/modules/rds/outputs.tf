output "primary_endpoint" {
  value = aws_db_instance.primary.endpoint
}

output "replica_endpoint" {
  value = length(aws_db_instance.replica) > 0 ? aws_db_instance.replica[0].endpoint : aws_db_instance.primary.endpoint
}

output "primary_address" {
  value = aws_db_instance.primary.address
}

output "db_name" {
  value = aws_db_instance.primary.db_name
}
