variable "aws_region" {
  description = "AWS region for RDS and networking resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "Project name used in resource naming"
  type        = string
  default     = "subtrackr"
}

variable "db_instance_class" {
  description = "RDS instance class for the primary database"
  type        = string
  default     = "db.t3.medium"
}

variable "db_allocated_storage_gb" {
  description = "Allocated storage for the primary RDS instance (GB)"
  type        = number
  default     = 100
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "subtrackr"
}

variable "db_username" {
  description = "Master username for the RDS instance"
  type        = string
  default     = "subtrackr_admin"
}

variable "db_password" {
  description = "Master password for the RDS instance (override via TF_VAR_db_password)"
  type        = string
  sensitive   = true
}

variable "vpc_id" {
  description = "VPC ID where RDS will be provisioned"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for the RDS subnet group (minimum 2 AZs)"
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "Security groups allowed to connect to RDS (app servers, PgBouncer)"
  type        = list(string)
  default     = []
}

variable "replica_instance_class" {
  description = "RDS instance class for read replicas"
  type        = string
  default     = "db.t3.medium"
}

variable "pgbouncer_pool_size" {
  description = "Default PgBouncer pool size per replica"
  type        = number
  default     = 25
}

variable "backup_retention_days" {
  description = "Number of days to retain automated backups"
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Enable deletion protection on the primary instance"
  type        = bool
  default     = true
}

variable "performance_insights_enabled" {
  description = "Enable Performance Insights on RDS instances"
  type        = bool
  default     = true
}
