# Issue #600: Database connection multiplexing for serverless environments.
#
# AWS RDS Proxy provisioning with transaction-level pooling and IAM auth. RDS
# Proxy multiplexes a small set of backend connections across many concurrent
# Lambda invocations, preventing connection exhaustion during traffic spikes.
#
# For self-hosted environments use the PgBouncer sidecar instead (see
# pgbouncer.tf) — only one of the two should be enabled per environment.

variable "db_proxy_enabled" {
  description = "Provision the RDS Proxy (AWS). Disable for self-hosted PgBouncer."
  type        = bool
  default     = true
}

variable "db_instance_arn" {
  description = "ARN of the target RDS PostgreSQL instance."
  type        = string
}

variable "db_secret_arn" {
  description = "Secrets Manager ARN holding the database credentials (SCRAM-256)."
  type        = string
}

variable "vpc_subnet_ids" {
  description = "Subnets the proxy is attached to."
  type        = list(string)
}

variable "vpc_security_group_ids" {
  description = "Security groups controlling access to the proxy."
  type        = list(string)
}

# IAM role the proxy assumes to read the DB secret.
resource "aws_iam_role" "rds_proxy" {
  count = var.db_proxy_enabled ? 1 : 0
  name  = "subtrackr-rds-proxy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "rds.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "rds_proxy_secrets" {
  count = var.db_proxy_enabled ? 1 : 0
  name  = "subtrackr-rds-proxy-secrets"
  role  = aws_iam_role.rds_proxy[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [var.db_secret_arn]
    }]
  })
}

resource "aws_db_proxy" "subtrackr" {
  count                  = var.db_proxy_enabled ? 1 : 0
  name                   = "subtrackr-db-proxy"
  engine_family          = "POSTGRESQL"
  role_arn               = aws_iam_role.rds_proxy[0].arn
  vpc_subnet_ids         = var.vpc_subnet_ids
  vpc_security_group_ids = var.vpc_security_group_ids

  # IAM auth: serverless functions present a signed token, no static password.
  require_tls = true

  auth {
    auth_scheme = "SECRETS"
    secret_arn  = var.db_secret_arn
    iam_auth    = "REQUIRED"
  }

  # Force-close connections idle longer than the leak threshold (30s).
  idle_client_timeout = 30
}

resource "aws_db_proxy_default_target_group" "subtrackr" {
  count         = var.db_proxy_enabled ? 1 : 0
  db_proxy_name = aws_db_proxy.subtrackr[0].name

  connection_pool_config {
    # Transaction pooling: a small pool fans out to 500+ concurrent functions.
    max_connections_percent      = 50 # ~50 backend connections on a 100-cap DB
    max_idle_connections_percent = 25
    connection_borrow_timeout    = 5

    # Pin sessions only for statements that genuinely need session state;
    # everything else is multiplexed at transaction granularity.
    session_pinning_filters = ["EXCLUDE_VARIABLE_SETS"]
  }
}

resource "aws_db_proxy_target" "subtrackr" {
  count                  = var.db_proxy_enabled ? 1 : 0
  db_proxy_name          = aws_db_proxy.subtrackr[0].name
  target_group_name      = aws_db_proxy_default_target_group.subtrackr[0].name
  db_instance_identifier = element(split(":", var.db_instance_arn), length(split(":", var.db_instance_arn)) - 1)
}

output "db_proxy_endpoint" {
  description = "Endpoint serverless functions connect to (set as DB_PROXY_HOST)."
  value       = var.db_proxy_enabled ? aws_db_proxy.subtrackr[0].endpoint : null
}
