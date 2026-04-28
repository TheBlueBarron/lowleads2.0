output "primary_endpoint"  { value = aws_db_instance.primary.endpoint }
output "replica_endpoint"  { value = aws_db_instance.replica.endpoint }
output "primary_address"   { value = aws_db_instance.primary.address }
output "db_name"           { value = aws_db_instance.primary.db_name }
