# Backup and Restore Runbook

## Overview

This runbook documents the backup and restore procedures for the SubTrackr
database, including scheduling, testing, and Recovery Time/Point Objectives
(RTO/RPO).

## RTO and RPO

| Metric | Target | Description |
|---|---|---|
| **RPO** (Recovery Point Objective) | 1 hour | Maximum acceptable data loss. Backups run hourly, so at most 1 hour of data may be lost. |
| **RTO** (Recovery Time Objective) | 30 minutes | Maximum acceptable downtime. A restore from the most recent backup completes within 30 minutes for databases up to 10 GB. |

## Backup Schedule

| Schedule | Type | Retention | Storage |
|---|---|---|---|
| Every hour | Full (data + schema) | 24 hours | Local + S3 |
| Daily at 02:00 UTC | Full (data + schema) | 7 days | Local + S3 |
| Weekly (Sunday) | Full (data + schema) | 4 weeks | S3 only |
| Monthly (1st) | Schema-only | 12 months | S3 only |

### Cron configuration

```cron
# Hourly full backup (RPO: 1 hour)
0 * * * * DATABASE_URL=postgres://... BACKUP_DIR=/var/backups/subtrackr \
  BACKUP_S3_BUCKET=my-bucket /app/scripts/db-backup.sh >> /var/log/subtrackr-backup.log 2>&1

# Daily backup with 7-day retention
0 2 * * * DATABASE_URL=postgres://... BACKUP_DIR=/var/backups/subtrackr \
  BACKUP_S3_BUCKET=my-bucket BACKUP_RETENTION=7 /app/scripts/db-backup.sh >> /var/log/subtrackr-backup.log 2>&1
```

## Backup Procedure

### Creating a manual backup

```bash
# Set the database URL
export DATABASE_URL="postgres://user:pass@host:5432/subtrackr"

# Full backup
./scripts/db-backup.sh

# Schema-only backup
./scripts/db-backup.sh --schema-only

# Custom backup directory and compression
BACKUP_DIR=/mnt/backups BACKUP_COMPRESS=9 ./scripts/db-backup.sh
```

### Backup output

Each backup produces two files:
- `subtrackr_YYYYMMDD_HHMMSS.dump.gz` — compressed pg_dump custom format
- `subtrackr_YYYYMMDD_HHMMSS.dump.gz.sha256` — SHA-256 checksum

### Backup verification

Backups are verified by:
1. **Checksum** — SHA-256 hash is computed and stored alongside the backup
2. **Restore test** — The `db-backup-test.sh` script performs a round-trip test
3. **Size check** — The backup file size is logged for anomaly detection

## Restore Procedure

### Restoring from a backup

```bash
# Set the target database URL (use a test/staging database)
export DATABASE_URL="postgres://user:pass@test-host:5432/subtrackr_test"

# Restore from a specific backup file
./scripts/db-restore.sh /var/backups/subtrackr/subtrackr_20261017_020000.dump.gz

# Dry run (show what would be done without making changes)
./scripts/db-restore.sh subtrackr_20261017_020000.dump.gz --dry-run

# Restore to a specific target URL
./scripts/db-restore.sh backup.dump.gz --target-url "postgres://..."
```

### Production restore safety

The restore script includes safety checks:
- **Production detection** — If the target URL contains `prod`, `live`, or `primary`, the script requires `CONFIRM_PROD_RESTORE=yes` to proceed.
- **Dry-run mode** — Use `--dry-run` to preview the restore command without executing it.
- **Checksum verification** — The script verifies the SHA-256 checksum before restoring.

### Restore steps (full production recovery)

1. **Alert the team** — Notify all stakeholders of the incident and expected downtime.
2. **Stop the application** — Prevent writes to the database during recovery.
3. **Identify the backup** — Use the most recent valid backup:
   ```bash
   ls -lt /var/backups/subtrackr/subtrackr_*.dump.gz | head -5
   ```
4. **Verify the backup** — Check the checksum:
   ```bash
   sha256sum -c /var/backups/subtrackr/subtrackr_20261017_020000.dump.gz.sha256
   ```
5. **Restore the backup**:
   ```bash
   CONFIRM_PROD_RESTORE=yes \
   DATABASE_URL="postgres://..." \
   ./scripts/db-restore.sh /var/backups/subtrackr/subtrackr_20261017_020000.dump.gz
   ```
6. **Run migrations** — Ensure the schema is current:
   ```bash
   DATABASE_URL="postgres://..." node scripts/db-migrate-run.js up
   ```
7. **Verify** — Check table counts and run the test suite:
   ```bash
   DATABASE_URL="postgres://..." node scripts/db-migrate-run.js status
   ```
8. **Restart the application** — Bring services back online.
9. **Post-incident review** — Document the root cause and recovery timeline.

## Testing Backups

### Automated round-trip test

```bash
export DATABASE_URL="postgres://user:pass@host:5432/subtrackr"
export DATABASE_URL_TEST="postgres://user:pass@test-host:5432/subtrackr_test"

./scripts/db-backup-test.sh
```

This script:
1. Creates a backup of the source database
2. Restores it to the test database
3. Verifies table counts match
4. Checks migration status on the restored database

### Schedule regular tests

```cron
# Weekly backup test (Sunday at 03:00)
0 3 * * 0 DATABASE_URL=postgres://... DATABASE_URL_TEST=postgres://... \
  /app/scripts/db-backup-test.sh >> /var/log/subtrackr-backup-test.log 2>&1
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | (required) | PostgreSQL connection URL |
| `BACKUP_DIR` | `/tmp/subtrackr-backups` | Local backup directory |
| `BACKUP_S3_BUCKET` | (none) | S3 bucket for offsite backups |
| `BACKUP_S3_PREFIX` | `backups/` | S3 key prefix |
| `BACKUP_RETENTION` | `7` | Local backup retention (days) |
| `BACKUP_COMPRESS` | `6` | gzip compression level (0-9) |
| `DATABASE_URL_TEST` | (required for test) | Test database for restore testing |
| `CONFIRM_PROD_RESTORE` | (none) | Set to `yes` to allow production restores |

## Scripts

| Script | Purpose |
|---|---|
| `scripts/db-backup.sh` | Create a compressed database backup |
| `scripts/db-restore.sh` | Restore from a backup file |
| `scripts/db-backup-test.sh` | Round-trip backup → restore → verify test |
| `scripts/db-migrate-run.js` | Run migrations after restore |
