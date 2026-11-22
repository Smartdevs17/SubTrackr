#!/usr/bin/env bash
# =============================================================================
# SubTrackr — Disaster Recovery: Backup Script
# =============================================================================
#
# Creates a DR backup (project state, build artefacts metadata) and optionally
# runs a health check before backing up.
#
# Usage:
#   ./scripts/dr-backup.sh [OPTIONS]
#
# Options:
#   --region REGION    Target region for backup storage (default: us-east-1)
#   --env ENV          Environment label (default: production)
#   --pre-check        Run health checks before creating backup
#   --dry-run          Show what would be backed up without writing
#   --output-dir DIR   Directory to write backup manifest (default: .dr-backups/)
#
# =============================================================================

set -euo pipefail

# ── Colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

print_header() { echo -e "\n${BOLD}${CYAN}$1${RESET}"; }
print_info()   { echo -e "${CYAN}ℹ  $1${RESET}"; }
print_warn()   { echo -e "${YELLOW}⚠  $1${RESET}"; }
print_ok()     { echo -e "${GREEN}✓  $1${RESET}"; }
print_error()  { echo -e "${RED}✗  $1${RESET}" >&2; }
print_step()   { echo -e "${BOLD}→  $1${RESET}"; }

# ── Defaults ───────────────────────────────────────────────────────────────
REGION="${DR_REGION:-us-east-1}"
ENVIRONMENT="${DR_ENVIRONMENT:-production}"
PRE_CHECK=false
DRY_RUN=false
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${PROJECT_ROOT}/.dr-backups"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
BACKUP_ID="backup-${TIMESTAMP}-${REGION}"

# ── Argument parsing ───────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region)     REGION="$2";      shift 2 ;;
    --env)        ENVIRONMENT="$2"; shift 2 ;;
    --pre-check)  PRE_CHECK=true;   shift ;;
    --dry-run)    DRY_RUN=true;     shift ;;
    --output-dir) OUTPUT_DIR="$2";  shift 2 ;;
    *) print_warn "Unknown option: $1"; shift ;;
  esac
done

# ── Functions ──────────────────────────────────────────────────────────────

run_pre_check() {
  print_step "Running pre-backup health checks..."
  local status
  status="$("${PROJECT_ROOT}/scripts/dr-status.sh" --short 2>/dev/null || echo "unknown")"
  if [[ "$status" == "critical" ]]; then
    print_error "Pre-check failed: DR system is in critical state. Backup may be unreliable."
    return 1
  fi
  print_ok "Pre-check passed (status: ${status})"
}

collect_manifest() {
  local manifest_file="$1"

  # Collect metadata about the project state
  node -e "
const fs = require('fs');
const path = require('path');
const os = require('os');

const projectRoot = '${PROJECT_ROOT}';
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

const manifest = {
  id: '${BACKUP_ID}',
  timestamp: '${TIMESTAMP}',
  region: '${REGION}',
  environment: '${ENVIRONMENT}',
  project: {
    name: pkg.name,
    version: pkg.version,
  },
  git: {
    branch: process.env.GIT_BRANCH || '${BRANCH:-unknown}',
    commit: process.env.GIT_COMMIT || '${COMMIT:-unknown}',
  },
  system: {
    platform: os.platform(),
    nodeVersion: process.version,
    freeMb: Math.round(os.freemem() / 1024 / 1024),
    totalMb: Math.round(os.totalmem() / 1024 / 1024),
  },
  artefacts: [
    'package.json',
    'tsconfig.json',
    'backend/tsconfig.json',
  ].filter(f => fs.existsSync(path.join(projectRoot, f))),
  createdAt: Date.now(),
};

fs.writeFileSync('${manifest_file}', JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
" 2>&1
}

# ── Main ───────────────────────────────────────────────────────────────────

print_header "SubTrackr DR Backup"
print_info "Backup ID:    ${BACKUP_ID}"
print_info "Region:       ${REGION}"
print_info "Environment:  ${ENVIRONMENT}"
print_info "Dry run:      ${DRY_RUN}"

# Optional pre-check
if [[ "$PRE_CHECK" == "true" ]]; then
  run_pre_check
fi

if [[ "$DRY_RUN" == "true" ]]; then
  print_warn "DRY RUN: Would create backup ${BACKUP_ID} in ${REGION}"
  print_info "Backup artefacts would include:"
  print_info "  - package.json (version metadata)"
  print_info "  - tsconfig.json (build config)"
  print_info "  - backend/tsconfig.json"
  print_info "  - .dr-recovery-log.jsonl (recovery history)"
  exit 0
fi

# Create output directory
mkdir -p "${OUTPUT_DIR}"
MANIFEST_FILE="${OUTPUT_DIR}/${BACKUP_ID}.manifest.json"

# Collect and write manifest
print_step "Collecting backup manifest..."

GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')" \
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')" \
  collect_manifest "$MANIFEST_FILE"

# Copy key artefacts
print_step "Archiving artefacts..."
ARTEFACT_DIR="${OUTPUT_DIR}/${BACKUP_ID}"
mkdir -p "${ARTEFACT_DIR}"

for f in "package.json" "tsconfig.json" "backend/tsconfig.json"; do
  if [[ -f "${PROJECT_ROOT}/${f}" ]]; then
    cp "${PROJECT_ROOT}/${f}" "${ARTEFACT_DIR}/"
    print_ok "Archived: ${f}"
  fi
done

# Copy recovery log if present
if [[ -f "${PROJECT_ROOT}/.dr-recovery-log.jsonl" ]]; then
  cp "${PROJECT_ROOT}/.dr-recovery-log.jsonl" "${ARTEFACT_DIR}/"
  print_ok "Archived: .dr-recovery-log.jsonl"
fi

# Create tarball
TARBALL="${OUTPUT_DIR}/${BACKUP_ID}.tar.gz"
tar -czf "$TARBALL" -C "${OUTPUT_DIR}" "${BACKUP_ID}/"
rm -rf "${ARTEFACT_DIR}"

print_ok "Backup archive created: ${TARBALL}"
print_ok "Manifest: ${MANIFEST_FILE}"

# Prune old backups (keep last 10)
BACKUP_COUNT=$(ls "${OUTPUT_DIR}"/*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
if [[ "$BACKUP_COUNT" -gt 10 ]]; then
  print_step "Pruning old backups (keeping 10)..."
  ls -t "${OUTPUT_DIR}"/*.tar.gz | tail -n +11 | xargs rm -f
  print_ok "Old backups pruned"
fi

print_header "Backup Complete"
print_info "Backup ID:   ${BACKUP_ID}"
print_info "Location:    ${TARBALL}"
print_info "Manifest:    ${MANIFEST_FILE}"
echo ""
