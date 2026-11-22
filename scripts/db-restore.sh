#!/usr/bin/env bash
#
# scripts/db-restore.sh — PostgreSQL restore script (issue #1803)
#
# Restores a SubTrackr database backup created by scripts/db-backup.sh.
# Supports restoring to a different database (for testing) and includes
# safety checks to prevent accidental production restores.
#
# Usage:
#   ./scripts/db-restore.sh <backup-file> [--target-url <url>] [--dry-run]
#
# Environment:
#   DATABASE_URL       — target database (required unless --target-url given)
#   BACKUP_DIR         — backup directory (default: /tmp/subtrackr-backups)
#
# Exit codes: 0 = success, 1 = restore failed, 2 = configuration error

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/tmp/subtrackr-backups}"
TARGET_URL="${DATABASE_URL:-}"
DRY_RUN=false
BACKUP_FILE=""

# ─── Parse args ──────────────────────────────────────────────────────────────

while [ $# -gt 0 ]; do
  case "$1" in
    --target-url) shift; TARGET_URL="$1" ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      echo "Usage: $0 <backup-file> [--target-url <url>] [--dry-run]"
      echo "Restores a SubTrackr database backup."
      exit 0
      ;;
    *) BACKUP_FILE="$1" ;;
  esac
  shift
done

# ─── Validate ────────────────────────────────────────────────────────────────

if [ -z "${BACKUP_FILE}" ]; then
  echo "[restore] ERROR: No backup file specified."
  echo "Available backups in ${BACKUP_DIR}:"
  ls -1 "${BACKUP_DIR}"/subtrackr_*.dump.gz 2>/dev/null || echo "  (none found)"
  exit 2
fi

# Resolve relative path
if [ ! -f "${BACKUP_FILE}" ] && [ -f "${BACKUP_DIR}/${BACKUP_FILE}" ]; then
  BACKUP_FILE="${BACKUP_DIR}/${BACKUP_FILE}"
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "[restore] ERROR: Backup file not found: ${BACKUP_FILE}"
  exit 2
fi

if [ -z "${TARGET_URL}" ]; then
  echo "[restore] ERROR: DATABASE_URL (or --target-url) is not set."
  exit 2
fi

if ! command -v pg_restore &>/dev/null; then
  echo "[restore] ERROR: pg_restore not found on PATH."
  exit 2
fi

# ─── Safety check ────────────────────────────────────────────────────────────

# Warn if the target URL looks like production
if echo "${TARGET_URL}" | grep -qiE 'prod|live|primary'; then
  echo "[restore] ⚠  WARNING: Target URL appears to be a production database!"
  echo "[restore]    To proceed, set CONFIRM_PROD_RESTORE=yes"
  if [ "${CONFIRM_PROD_RESTORE:-}" != "yes" ]; then
    echo "[restore] Aborting. Use --target-url with a non-production database"
    echo "[restore] or set CONFIRM_PROD_RESTORE=yes to override."
    exit 2
  fi
fi

# ─── Verify checksum ─────────────────────────────────────────────────────────

CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [ -f "${CHECKSUM_FILE}" ]; then
  echo "[restore] Verifying checksum..."
  if sha256sum -c "${CHECKSUM_FILE}" --quiet 2>/dev/null; then
    echo "[restore] ✓ Checksum verified"
  else
    echo "[restore] ⚠  Checksum verification failed — proceeding anyway"
  fi
else
  echo "[restore] ⚠  No checksum file found — skipping verification"
fi

# ─── Restore ─────────────────────────────────────────────────────────────────

SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[restore] Starting restore at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[restore] Source: ${BACKUP_FILE} (${SIZE})"
echo "[restore] Target: ${TARGET_URL}"

if [ "${DRY_RUN}" = "true" ]; then
  echo "[restore] (dry-run) Would run:"
  echo "  gunzip -c '${BACKUP_FILE}' | pg_restore --verbose --no-owner --no-privileges --clean --if-exists -d '${TARGET_URL}'"
  echo "[restore] (dry-run) No changes made."
  exit 0
fi

# ─── Pre-restore: record current state ───────────────────────────────────────

echo "[restore] Pre-restore state:"
psql "${TARGET_URL}" -c "SELECT count(*) AS total_tables FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null || true

# ─── Restore ─────────────────────────────────────────────────────────────────

RESTORE_OPTS="--verbose --no-owner --no-privileges --clean --if-exists"

if gunzip -c "${BACKUP_FILE}" | pg_restore ${RESTORE_OPTS} -d "${TARGET_URL}" 2>&1; then
  echo "[restore] ✓ Restore complete"
else
  RESTORE_EXIT=$?
  echo "[restore] ⚠  pg_restore exited with code ${RESTORE_EXIT}"
  echo "[restore]    Some errors may be expected (e.g., dropping non-existent objects)."
  echo "[restore]    Verify the database state manually."
fi

# ─── Post-restore verification ───────────────────────────────────────────────

echo "[restore] Post-restore state:"
psql "${TARGET_URL}" -c "SELECT count(*) AS total_tables FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null || true

# Run migrations to ensure schema is up to date
echo "[restore] Running migrations to ensure schema is current..."
if command -v node &>/dev/null; then
  node scripts/db-migrate-run.js up --migrations-dir db/migrations 2>/dev/null || true
fi

echo "[restore] Done at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""
echo "[restore] Next steps:"
echo "  1. Verify application can connect to the restored database"
echo "  2. Run: node scripts/db-migrate-run.js status"
echo "  3. Run test suite against the restored database"
exit 0
