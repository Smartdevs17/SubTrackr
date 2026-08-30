#!/usr/bin/env bash
# =============================================================================
# SubTrackr — Disaster Recovery: Automated Recovery Script
# =============================================================================
#
# Triggers the appropriate DR runbook based on the specified scenario.
#
# Usage:
#   ./scripts/dr-recover.sh [SCENARIO] [OPTIONS]
#
# Scenarios:
#   build-failure     Recover from a CI/CD build failure
#   db-restore        Restore database from backup
#   service-failover  Fail over a service to its fallback
#   rollback          Roll back a deployment
#   full-dr           Run a complete DR drill (backup → verify → restore)
#
# Options:
#   --build-id ID     Build identifier (for build-failure)
#   --branch BRANCH   Git branch (for build-failure, default: current branch)
#   --commit SHA      Git commit SHA (for build-failure, default: HEAD)
#   --env ENV         Target environment (default: production)
#   --dry-run         Simulate without making changes
#   --verbose         Enable verbose output
#
# Examples:
#   ./scripts/dr-recover.sh build-failure --build-id build-1234 --branch main
#   ./scripts/dr-recover.sh rollback --env staging
#   ./scripts/dr-recover.sh full-dr
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
SCENARIO="${1:-}"
BUILD_ID="${BUILD_ID:-build-$(date +%s)}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')}"
COMMIT="${COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')}"
ENVIRONMENT="${DR_ENVIRONMENT:-production}"
DRY_RUN=false
VERBOSE=false
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── Argument parsing ───────────────────────────────────────────────────────
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-id)   BUILD_ID="$2";   shift 2 ;;
    --branch)     BRANCH="$2";     shift 2 ;;
    --commit)     COMMIT="$2";     shift 2 ;;
    --env)        ENVIRONMENT="$2"; shift 2 ;;
    --dry-run)    DRY_RUN=true;    shift ;;
    --verbose)    VERBOSE=true;    shift ;;
    *) print_warn "Unknown option: $1"; shift ;;
  esac
done

# ── Validation ─────────────────────────────────────────────────────────────
if [[ -z "$SCENARIO" ]]; then
  print_error "Scenario is required."
  echo ""
  echo "Usage: $0 [SCENARIO] [OPTIONS]"
  echo "Scenarios: build-failure | db-restore | service-failover | rollback | full-dr"
  exit 1
fi

# ── Helper: run Node/TypeScript runbook ───────────────────────────────────
run_ts_runbook() {
  local script="$1"
  shift
  if command -v ts-node &>/dev/null; then
    ts-node "$script" "$@"
  elif command -v npx &>/dev/null; then
    npx ts-node "$script" "$@"
  else
    node "$script" "$@"
  fi
}

# ── Helper: record outcome ────────────────────────────────────────────────
record_outcome() {
  local outcome="$1"
  local scenario="$2"
  local start="$3"
  local end
  end=$(date +%s)
  local elapsed=$(( end - start ))
  local log_file="${PROJECT_ROOT}/.dr-recovery-log.jsonl"

  echo "{\"ts\":$(date +%s),\"scenario\":\"${scenario}\",\"outcome\":\"${outcome}\",\"durationSec\":${elapsed},\"env\":\"${ENVIRONMENT}\",\"buildId\":\"${BUILD_ID}\",\"branch\":\"${BRANCH}\"}" >> "$log_file"
  print_info "Outcome recorded to ${log_file}"
}

# ── Main ────────────────────────────────────────────────────────────────────
print_header "SubTrackr Disaster Recovery — ${SCENARIO}"
print_info "Environment:  ${ENVIRONMENT}"
print_info "Dry run:      ${DRY_RUN}"
print_info "Project root: ${PROJECT_ROOT}"
START_TS=$(date +%s)

case "$SCENARIO" in

  build-failure)
    print_step "Running Build Failure Recovery Runbook"
    print_info "Build ID:  ${BUILD_ID}"
    print_info "Branch:    ${BRANCH}"
    print_info "Commit:    ${COMMIT}"

    if [[ "$DRY_RUN" == "true" ]]; then
      print_warn "DRY RUN: Would trigger build failure runbook for ${BUILD_ID}"
      exit 0
    fi

    # Run the TypeScript runbook via inline Node script
    node --input-type=module << EOF
import { createBuildFailureRunbook } from '${PROJECT_ROOT}/backend/dr/runbooks/BuildFailureRunbook.js';
import { RunbookEngine } from '${PROJECT_ROOT}/backend/dr/RunbookEngine.js';

const engine = new RunbookEngine({ verbose: ${VERBOSE} });
const runbook = createBuildFailureRunbook({
  buildId: '${BUILD_ID}',
  branch: '${BRANCH}',
  commit: '${COMMIT}',
  failureCategory: 'unknown',
  environment: '${ENVIRONMENT}',
}, '${PROJECT_ROOT}');

const result = await engine.execute(runbook, {
  environment: '${ENVIRONMENT}',
  triggeredBy: 'dr-recover-script',
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
EOF
    STATUS=$?
    record_outcome "$([ $STATUS -eq 0 ] && echo success || echo failure)" "$SCENARIO" "$START_TS"
    exit $STATUS
    ;;

  db-restore)
    print_step "Running Database Restore Runbook"

    if [[ "$DRY_RUN" == "true" ]]; then
      print_warn "DRY RUN: Would trigger database restore runbook"
      exit 0
    fi

    node --input-type=module << EOF
import { createDatabaseRestoreRunbook } from '${PROJECT_ROOT}/backend/dr/runbooks/DatabaseRestoreRunbook.js';
import { RunbookEngine } from '${PROJECT_ROOT}/backend/dr/RunbookEngine.js';

const engine = new RunbookEngine({ verbose: ${VERBOSE} });
const runbook = createDatabaseRestoreRunbook({
  databaseId: process.env.DATABASE_ID || 'subtrackr-primary',
  backupId: process.env.BACKUP_ID,
  targetEnvironment: '${ENVIRONMENT}',
  verifyAfterRestore: true,
});

const result = await engine.execute(runbook, {
  environment: '${ENVIRONMENT}',
  triggeredBy: 'dr-recover-script',
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
EOF
    STATUS=$?
    record_outcome "$([ $STATUS -eq 0 ] && echo success || echo failure)" "$SCENARIO" "$START_TS"
    exit $STATUS
    ;;

  service-failover)
    print_step "Running Service Failover Runbook"
    SERVICE_ID="${SERVICE_ID:-api}"
    PRIMARY="${PRIMARY_ENDPOINT:-http://localhost:3000}"
    FALLBACK="${FALLBACK_ENDPOINT:-http://localhost:3001}"

    if [[ "$DRY_RUN" == "true" ]]; then
      print_warn "DRY RUN: Would fail over ${SERVICE_ID} from ${PRIMARY} to ${FALLBACK}"
      exit 0
    fi

    node --input-type=module << EOF
import { createServiceFailoverRunbook } from '${PROJECT_ROOT}/backend/dr/runbooks/ServiceFailoverRunbook.js';
import { RunbookEngine } from '${PROJECT_ROOT}/backend/dr/RunbookEngine.js';

const engine = new RunbookEngine({ verbose: ${VERBOSE} });
const runbook = createServiceFailoverRunbook({
  id: '${SERVICE_ID}',
  name: '${SERVICE_ID}',
  primaryEndpoint: '${PRIMARY}',
  fallbackEndpoint: '${FALLBACK}',
});

const result = await engine.execute(runbook, {
  environment: '${ENVIRONMENT}',
  triggeredBy: 'dr-recover-script',
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
EOF
    STATUS=$?
    record_outcome "$([ $STATUS -eq 0 ] && echo success || echo failure)" "$SCENARIO" "$START_TS"
    exit $STATUS
    ;;

  rollback)
    print_step "Running Deployment Rollback Runbook"
    CURRENT_VERSION="${CURRENT_VERSION:-$(node -p "require('${PROJECT_ROOT}/package.json').version" 2>/dev/null || echo '0.0.0')}"
    PREVIOUS_VERSION="${PREVIOUS_VERSION:-}"

    if [[ -z "$PREVIOUS_VERSION" ]]; then
      print_warn "PREVIOUS_VERSION not set; attempting to determine from git tags"
      PREVIOUS_VERSION="$(git tag --sort=-version:refname | grep '^v' | sed -n '2p' | tr -d 'v' || echo '0.0.0')"
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
      print_warn "DRY RUN: Would roll back ${ENVIRONMENT} from v${CURRENT_VERSION} to v${PREVIOUS_VERSION}"
      exit 0
    fi

    node --input-type=module << EOF
import { createRollbackRunbook } from '${PROJECT_ROOT}/backend/dr/runbooks/RollbackRunbook.js';
import { RunbookEngine } from '${PROJECT_ROOT}/backend/dr/RunbookEngine.js';

const engine = new RunbookEngine({ verbose: ${VERBOSE} });
const runbook = createRollbackRunbook({
  deploymentId: '${BUILD_ID}',
  version: '${CURRENT_VERSION}',
  previousVersion: '${PREVIOUS_VERSION}',
  environment: '${ENVIRONMENT}',
  deployedAt: Date.now(),
}, '${PROJECT_ROOT}');

const result = await engine.execute(runbook, {
  environment: '${ENVIRONMENT}',
  triggeredBy: 'dr-recover-script',
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
EOF
    STATUS=$?
    record_outcome "$([ $STATUS -eq 0 ] && echo success || echo failure)" "$SCENARIO" "$START_TS"
    exit $STATUS
    ;;

  full-dr)
    print_step "Running Full DR Drill (backup → verify → restore)"

    if [[ "$DRY_RUN" == "true" ]]; then
      print_warn "DRY RUN: Would run full DR drill"
      exit 0
    fi

    node "${PROJECT_ROOT}/scripts/dr-test.js"
    STATUS=$?
    record_outcome "$([ $STATUS -eq 0 ] && echo success || echo failure)" "$SCENARIO" "$START_TS"
    exit $STATUS
    ;;

  *)
    print_error "Unknown scenario: '${SCENARIO}'"
    echo "Valid scenarios: build-failure | db-restore | service-failover | rollback | full-dr"
    exit 1
    ;;

esac
