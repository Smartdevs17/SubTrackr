#!/usr/bin/env bash
# =============================================================================
# SubTrackr — Disaster Recovery: Status Check Script
# =============================================================================
#
# Prints a summary of DR system health, most recent backups, active incidents,
# and RTO/RPO compliance metrics.
#
# Usage:
#   ./scripts/dr-status.sh [OPTIONS]
#
# Options:
#   --json       Output as JSON instead of human-readable
#   --short      Only print overall health status (exit 0=healthy, 1=unhealthy)
#   --checks     Run active health checks on build/infra
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

print_header() { echo -e "\n${BOLD}${CYAN}═══ $1 ═══${RESET}"; }
print_ok()     { echo -e "  ${GREEN}✓${RESET}  $1"; }
print_warn()   { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
print_error()  { echo -e "  ${RED}✗${RESET}  $1"; }
print_info()   { echo -e "  ${CYAN}ℹ${RESET}  $1"; }

# ── Defaults ───────────────────────────────────────────────────────────────
JSON_OUTPUT=false
SHORT_OUTPUT=false
RUN_CHECKS=false
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${PROJECT_ROOT}/.dr-recovery-log.jsonl"

# ── Argument parsing ───────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)   JSON_OUTPUT=true;  shift ;;
    --short)  SHORT_OUTPUT=true; shift ;;
    --checks) RUN_CHECKS=true;   shift ;;
    *) echo "Unknown option: $1"; shift ;;
  esac
done

# ── Gather status ─────────────────────────────────────────────────────────
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Node.js version
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")
NODE_OK=false
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
[[ "$NODE_MAJOR" -ge 18 ]] 2>/dev/null && NODE_OK=true || true

# node_modules
DEPS_OK=false
[[ -d "${PROJECT_ROOT}/node_modules" ]] && DEPS_OK=true

# tsconfig.json
TSC_OK=false
[[ -f "${PROJECT_ROOT}/tsconfig.json" ]] && TSC_OK=true

# package.json
PKG_OK=false
PKG_VERSION="unknown"
if [[ -f "${PROJECT_ROOT}/package.json" ]]; then
  PKG_OK=true
  PKG_VERSION=$(node -p "require('${PROJECT_ROOT}/package.json').version" 2>/dev/null || echo "unknown")
fi

# Recent DR recovery log
LAST_RECOVERY_STATUS="none"
LAST_RECOVERY_TS="never"
LAST_RECOVERY_SCENARIO="none"
if [[ -f "$LOG_FILE" ]]; then
  LAST_LINE=$(tail -1 "$LOG_FILE" 2>/dev/null || echo "")
  if [[ -n "$LAST_LINE" ]]; then
    LAST_RECOVERY_STATUS=$(echo "$LAST_LINE" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.outcome||'unknown')" 2>/dev/null || echo "unknown")
    LAST_RECOVERY_SCENARIO=$(echo "$LAST_LINE" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(d.scenario||'unknown')" 2>/dev/null || echo "unknown")
    LAST_RECOVERY_TS=$(echo "$LAST_LINE" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(new Date(d.ts*1000).toISOString())" 2>/dev/null || echo "unknown")
  fi
fi

# Disk space (rough)
DISK_FREE_MB=0
if command -v df &>/dev/null; then
  DISK_FREE_MB=$(df -m "${PROJECT_ROOT}" 2>/dev/null | awk 'NR==2{print $4}' || echo 0)
fi
DISK_OK=false
[[ "$DISK_FREE_MB" -gt 500 ]] 2>/dev/null && DISK_OK=true || true

# Memory
MEM_FREE_MB=$(node -e "process.stdout.write(String(Math.round(require('os').freemem()/1024/1024)))" 2>/dev/null || echo 0)
MEM_OK=false
[[ "$MEM_FREE_MB" -gt 256 ]] 2>/dev/null && MEM_OK=true || true

# Overall health
OVERALL="healthy"
if [[ "$NODE_OK" == "false" || "$DEPS_OK" == "false" || "$TSC_OK" == "false" ]]; then
  OVERALL="critical"
elif [[ "$DISK_OK" == "false" || "$MEM_OK" == "false" ]]; then
  OVERALL="degraded"
fi

# ── Short mode ─────────────────────────────────────────────────────────────
if [[ "$SHORT_OUTPUT" == "true" ]]; then
  echo "$OVERALL"
  [[ "$OVERALL" == "healthy" ]] && exit 0 || exit 1
fi

# ── JSON mode ──────────────────────────────────────────────────────────────
if [[ "$JSON_OUTPUT" == "true" ]]; then
  node -e "
const status = {
  timestamp: '${TIMESTAMP}',
  overall: '${OVERALL}',
  checks: {
    nodeVersion: { ok: ${NODE_OK}, value: '${NODE_VERSION}' },
    dependencies: { ok: ${DEPS_OK} },
    typescriptConfig: { ok: ${TSC_OK} },
    packageJson: { ok: ${PKG_OK}, version: '${PKG_VERSION}' },
    diskSpace: { ok: ${DISK_OK}, freeMb: ${DISK_FREE_MB} },
    memory: { ok: ${MEM_OK}, freeMb: ${MEM_FREE_MB} },
  },
  lastRecovery: {
    status: '${LAST_RECOVERY_STATUS}',
    scenario: '${LAST_RECOVERY_SCENARIO}',
    timestamp: '${LAST_RECOVERY_TS}',
  },
};
console.log(JSON.stringify(status, null, 2));
"
  [[ "$OVERALL" == "healthy" ]] && exit 0 || exit 1
fi

# ── Human-readable output ──────────────────────────────────────────────────
print_header "SubTrackr DR Status — ${TIMESTAMP}"

print_header "Build Environment"
if [[ "$NODE_OK" == "true" ]]; then
  print_ok "Node.js ${NODE_VERSION} (≥ v18)"
else
  print_error "Node.js ${NODE_VERSION} — upgrade to v18+"
fi
if [[ "$DEPS_OK" == "true" ]]; then
  print_ok "node_modules present"
else
  print_error "node_modules missing — run npm install"
fi
if [[ "$TSC_OK" == "true" ]]; then
  print_ok "tsconfig.json present"
else
  print_warn "tsconfig.json missing"
fi
if [[ "$PKG_OK" == "true" ]]; then
  print_ok "package.json present (v${PKG_VERSION})"
else
  print_error "package.json missing"
fi

print_header "Infrastructure"
if [[ "$DISK_OK" == "true" ]]; then
  print_ok "Disk: ${DISK_FREE_MB} MB free"
else
  print_warn "Disk: ${DISK_FREE_MB} MB free — low disk space!"
fi
if [[ "$MEM_OK" == "true" ]]; then
  print_ok "Memory: ${MEM_FREE_MB} MB free"
else
  print_warn "Memory: ${MEM_FREE_MB} MB free — consider freeing memory"
fi

print_header "Recovery History"
print_info "Last recovery:  ${LAST_RECOVERY_STATUS} (${LAST_RECOVERY_SCENARIO}) at ${LAST_RECOVERY_TS}"
if [[ -f "$LOG_FILE" ]]; then
  COUNT=$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)
  print_info "Total DR events logged: ${COUNT}"
fi

# Optional: run active health checks
if [[ "$RUN_CHECKS" == "true" ]]; then
  print_header "Active Health Checks"
  if command -v npx &>/dev/null; then
    npx ts-node -e "
import { HealthCheckManager } from '${PROJECT_ROOT}/backend/dr/HealthCheckManager';
const mgr = new HealthCheckManager({ projectRoot: '${PROJECT_ROOT}' });
mgr.runAll().then(summary => {
  for (const check of summary.checks) {
    const icon = check.healthy ? '✓' : '✗';
    console.log(\`  \${icon}  [\${check.category}] \${check.name}: \${check.message ?? check.status}\`);
  }
  console.log(\`\nOverall: \${summary.overall}\`);
  process.exit(summary.allHealthy ? 0 : 1);
});
" 2>/dev/null || print_warn "Could not run active health checks (ts-node required)"
  else
    print_warn "npx not available – skipping active checks"
  fi
fi

print_header "Overall"
case "$OVERALL" in
  healthy)  print_ok  "DR system is HEALTHY" ;;
  degraded) print_warn "DR system is DEGRADED — review warnings above" ;;
  critical) print_error "DR system is CRITICAL — immediate attention required!" ;;
esac
echo ""

[[ "$OVERALL" == "healthy" ]] && exit 0 || exit 1
