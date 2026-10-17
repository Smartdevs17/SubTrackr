#!/usr/bin/env bash
#
# scripts/db-backup.sh — PostgreSQL backup script (issue #1803)
#
# Creates a compressed, timestamped backup of the SubTrackr database using
# pg_dump. Supports full and schema-only backups, and optional upload to
# S3-compatible storage.
#
# Usage:
#   ./scripts/db-backup.sh [--schema-only] [--compress-level 6]
#
# Environment:
#   DATABASE_URL       — required (postgres://...)
#   BACKUP_DIR         — local backup directory (default: /tmp/subtrackr-backups)
#   BACKUP_S3_BUCKET   — optional S3 bucket for offsite backup
#   BACKUP_S3_PREFIX   — S3 key prefix (default: backups/)
#   BACKUP_RETENTION   — local backup retention days (default: 7)
#   BACKUP_COMPRESS    — compression level 0-9 (default: 6)
#
# Exit codes: 0 = success, 1 = backup failed, 2 = configuration error

set -euo pipefail

SCHEMA_ONLY=false
COMPRESS_LEVEL="${BACKUP_COMPRESS:-6}"

for arg in "$@"; do
  case "$arg" in
    --schema-only) SCHEMA_ONLY=true ;;
    --compress-level) shift; COMPRESS_LEVEL="$1" ;;
    --help|-h)
      echo "Usage: $0 [--schema-only] [--compress-level N]"
      echo "Creates a compressed backup of the SubTrackr database."
      exit 0
      ;;
  esac
done

# ─── Validate ────────────────────────────────────────────────────────────────

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup] ERROR: DATABASE_URL is not set."
  exit 2
fi

if ! command -v pg_dump &>/dev/null; then
  echo "[backup] ERROR: pg_dump not found on PATH."
  exit 2
fi

BACKUP_DIR="${BACKUP_DIR:-/tmp/subtrackr-backups}"
BACKUP_RETENTION="${BACKUP_RETENTION:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/subtrackr_${TIMESTAMP}.dump.gz"

mkdir -p "${BACKUP_DIR}"

# ─── Backup ──────────────────────────────────────────────────────────────────

echo "[backup] Starting backup at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[backup] Target: ${BACKUP_FILE}"

DUMP_OPTS="--verbose --no-owner --no-privileges --format=custom"

if [ "${SCHEMA_ONLY}" = "true" ]; then
  DUMP_OPTS="${DUMP_OPTS} --schema-only"
  BACKUP_FILE="${BACKUP_DIR}/subtrackr_schema_${TIMESTAMP}.dump.gz"
  echo "[backup] Mode: schema-only"
else
  echo "[backup] Mode: full (data + schema)"
fi

# ─── Dump ────────────────────────────────────────────────────────────────────

if pg_dump ${DUMP_OPTS} "${DATABASE_URL}" 2>/dev/null | gzip -${COMPRESS_LEVEL} > "${BACKUP_FILE}"; then
  SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  echo "[backup] ✓ Backup complete: ${BACKUP_FILE} (${SIZE})"
else
  echo "[backup] ✗ Backup failed."
  rm -f "${BACKUP_FILE}"
  exit 1
fi

# ─── Compute checksum ────────────────────────────────────────────────────────

CHECKSUM_FILE="${BACKUP_FILE}.sha256"
sha256sum "${BACKUP_FILE}" > "${CHECKSUM_FILE}"
echo "[backup] Checksum: $(cat "${CHECKSUM_FILE}" | cut -d' ' -f1)"

# ─── Upload to S3 (optional) ─────────────────────────────────────────────────

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  if command -v aws &>/dev/null; then
    S3_KEY="${BACKUP_S3_PREFIX:-backups/}$(basename "${BACKUP_FILE}")"
    echo "[backup] Uploading to s3://${BACKUP_S3_BUCKET}/${S3_KEY}"
    if aws s3 cp "${BACKUP_FILE}" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" --quiet; then
      echo "[backup] ✓ S3 upload complete"
    else
      echo "[backup] ⚠ S3 upload failed (local backup still available)"
    fi
  else
    echo "[backup] ⚠ BACKUP_S3_BUCKET set but aws CLI not found — skipping upload"
  fi
fi

# ─── Prune old local backups ─────────────────────────────────────────────────

PRUNED=$(find "${BACKUP_DIR}" -name "subtrackr_*.dump.gz" -mtime +${BACKUP_RETENTION} -delete -print | wc -l)
if [ "${PRUNED}" -gt 0 ]; then
  echo "[backup] Pruned ${PRUNED} backup(s) older than ${BACKUP_RETENTION} days"
fi

echo "[backup] Done at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0
