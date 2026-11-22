# Issue #600: Self-hosted PgBouncer alternative to RDS Proxy.
#
# For environments not on AWS RDS, run PgBouncer as a sidecar/ECS task in
# transaction-pooling mode with SCRAM-SHA-256 auth and prepared-statement
# support. Enable this OR rds_proxy.tf, not both.

variable "pgbouncer_enabled" {
  description = "Provision the PgBouncer sidecar (self-hosted)."
  type        = bool
  default     = false
}

variable "pgbouncer_image" {
  description = "PgBouncer container image. >= 1.21 required for prepared statements in transaction mode."
  type        = string
  default     = "edoburu/pgbouncer:1.23.1"
}

variable "pgbouncer_cpu" {
  type    = number
  default = 256
}

variable "pgbouncer_memory" {
  type    = number
  default = 512
}

# Rendered pgbouncer.ini — transaction pooling, SCRAM auth, statement cache.
locals {
  pgbouncer_env = var.pgbouncer_enabled ? [
    { name = "POOL_MODE", value = "transaction" },
    { name = "AUTH_TYPE", value = "scram-sha-256" },
    # max 50 server-side connections serving 500+ pooled clients.
    { name = "MAX_CLIENT_CONN", value = "500" },
    { name = "DEFAULT_POOL_SIZE", value = "50" },
    { name = "MIN_POOL_SIZE", value = "5" },
    { name = "RESERVE_POOL_SIZE", value = "10" },
    # Prepared-statement support in transaction mode (PgBouncer >= 1.21).
    { name = "MAX_PREPARED_STATEMENTS", value = "256" },
    # Force-close server connections abandoned beyond the leak threshold (30s).
    { name = "SERVER_IDLE_TIMEOUT", value = "30" },
    { name = "QUERY_TIMEOUT", value = "30" },
    { name = "SERVER_TLS_SSLMODE", value = "require" },
  ] : []
}

resource "aws_ecs_task_definition" "pgbouncer" {
  count                    = var.pgbouncer_enabled ? 1 : 0
  family                   = "subtrackr-pgbouncer"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.pgbouncer_cpu
  memory                   = var.pgbouncer_memory

  container_definitions = jsonencode([{
    name      = "pgbouncer"
    image     = var.pgbouncer_image
    essential = true
    portMappings = [{
      containerPort = 6432
      protocol      = "tcp"
    }]
    environment = local.pgbouncer_env
  }])
}

output "pgbouncer_port" {
  description = "Port serverless functions connect to (set as DB_PROXY_PORT)."
  value       = var.pgbouncer_enabled ? 6432 : null
}
