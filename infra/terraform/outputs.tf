output "primary_endpoint" {
  description = "RDS primary (writer) endpoint hostname"
  value       = aws_db_instance.primary.address
}

output "primary_port" {
  description = "RDS primary port"
  value       = aws_db_instance.primary.port
}

output "read_replica_endpoints" {
  description = "Read replica endpoint hostnames (one per AZ)"
  value       = [for r in aws_db_instance.read_replica : r.address]
}

output "read_replica_ports" {
  description = "Read replica ports"
  value       = [for r in aws_db_instance.read_replica : r.port]
}

output "read_replica_azs" {
  description = "Availability zones for each read replica"
  value       = [for r in aws_db_instance.read_replica : r.availability_zone]
}

output "db_read_replicas_env" {
  description = "Value for DB_READ_REPLICAS environment variable (PgBouncer endpoints)"
  value = join(",", [
    for i, r in aws_db_instance.read_replica :
    "pgbouncer-replica-${i + 1}.${var.project_name}.internal:${6432 + i}"
  ])
}

output "pgbouncer_pool_size" {
  description = "Recommended PgBouncer pool size per replica"
  value       = var.pgbouncer_pool_size
}

output "security_group_id" {
  description = "Security group ID for RDS instances"
  value       = aws_security_group.rds.id
}
