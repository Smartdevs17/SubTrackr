# ── Networking ────────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "subtrackr" {
  name       = "${var.project_name}-${var.environment}-db-subnet"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "${var.project_name}-${var.environment}-db-subnet"
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-${var.environment}-rds"
  description = "PostgreSQL access for SubTrackr RDS primary and read replicas"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from application security groups"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-${var.environment}-rds-sg"
    Environment = var.environment
    Project     = var.project_name
  }
}

# ── Primary RDS instance ──────────────────────────────────────────────────────

resource "aws_db_instance" "primary" {
  identifier = "${var.project_name}-${var.environment}-primary"

  engine               = "postgres"
  engine_version       = "16.4"
  instance_class       = var.db_instance_class
  allocated_storage    = var.db_allocated_storage_gb
  storage_type         = "gp3"
  storage_encrypted    = true
  db_name              = var.db_name
  username             = var.db_username
  password             = var.db_password
  port                 = 5432

  db_subnet_group_name   = aws_db_subnet_group.subtrackr.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = true

  backup_retention_period   = var.backup_retention_days
  backup_window             = "03:00-04:00"
  maintenance_window        = "sun:04:00-sun:05:00"
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project_name}-${var.environment}-final-snapshot"
  copy_tags_to_snapshot     = true

  performance_insights_enabled = var.performance_insights_enabled

  parameter_group_name = aws_db_parameter_group.postgres16.name

  tags = {
    Name        = "${var.project_name}-${var.environment}-primary"
    Environment = var.environment
    Project     = var.project_name
    Role        = "primary"
  }
}

resource "aws_db_parameter_group" "postgres16" {
  name   = "${var.project_name}-${var.environment}-postgres16"
  family = "postgres16"

  parameter {
    name  = "rds.logical_replication"
    value = "1"
  }

  parameter {
    name  = "max_connections"
    value = "200"
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

# ── Read replicas (2 AZs) ─────────────────────────────────────────────────────

resource "aws_db_instance" "read_replica" {
  count = 2

  identifier          = "${var.project_name}-${var.environment}-replica-${count.index + 1}"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.replica_instance_class
  storage_encrypted   = true

  availability_zone = local.replica_azs[count.index]

  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  performance_insights_enabled = var.performance_insights_enabled
  auto_minor_version_upgrade   = true

  # Replicas inherit backup settings from primary; skip_final_snapshot for replicas
  skip_final_snapshot = true

  tags = {
    Name        = "${var.project_name}-${var.environment}-replica-${count.index + 1}"
    Environment = var.environment
    Project     = var.project_name
    Role        = "read-replica"
    AZ          = local.replica_azs[count.index]
  }
}

# ── CloudWatch alarms for replication lag ───────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "replication_lag_p99" {
  count = 2

  alarm_name          = "${var.project_name}-${var.environment}-replica-${count.index + 1}-lag-p99"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "ReplicaLag"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "p99"
  threshold           = 1
  alarm_description   = "P99 replication lag exceeds 1 second on read replica ${count.index + 1}"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.read_replica[count.index].identifier
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}

resource "aws_cloudwatch_metric_alarm" "replication_lag_failover" {
  count = 2

  alarm_name          = "${var.project_name}-${var.environment}-replica-${count.index + 1}-lag-failover"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ReplicaLag"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 5
  alarm_description   = "Replication lag exceeds 5s — application should route reads to primary"
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.read_replica[count.index].identifier
  }

  tags = {
    Environment = var.environment
    Project     = var.project_name
  }
}
