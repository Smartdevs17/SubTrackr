#!/usr/bin/env bash
# cdn-cache-warm.sh — Pre-warm critical CDN edge caches after deployment.
#
# Sends GET requests to each critical API path from each configured region,
# priming the CDN POPs so the first real user request gets a cache HIT.
#
# Prerequisites:
#   FASTLY_SERVICE_ID   — Fastly service ID
#   FASTLY_API_TOKEN    — Fastly API token
#   API_ORIGIN          — Origin URL (e.g. https://api.subtrackr.app)
#
# Usage:
#   ./scripts/cdn-cache-warm.sh
#   ./scripts/cdn-cache-warm.sh --dry-run

set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then DRY_RUN=true; fi
done

API_ORIGIN="${API_ORIGIN:-https://api.subtrackr.app}"
FASTLY_API_TOKEN="${FASTLY_API_TOKEN:-}"
FASTLY_SERVICE_ID="${FASTLY_SERVICE_ID:-}"

# Critical paths to warm (must match CACHEABLE_ROUTES in cacheHeaders.ts)
WARM_PATHS=(
  "/plans"
  "/pricing"
  "/features"
  "/public/config"
)

# Fastly POP regions to trigger (representative edge nodes)
POPS=(
  "IAD"   # us-east-1  (Northern Virginia)
  "LAX"   # us-west-2  (Los Angeles)
  "LHR"   # eu-west-1  (London)
  "FRA"   # eu-central (Frankfurt)
  "SIN"   # ap-south-east (Singapore)
  "NRT"   # ap-northeast (Tokyo)
)

log() { echo "[cdn-cache-warm] $*"; }
warn() { echo "[cdn-cache-warm] WARN: $*" >&2; }

warm_path() {
  local path="$1"
  local url="${API_ORIGIN}${path}"

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would warm: GET ${url}"
    return
  fi

  log "Warming: GET ${url}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Accept: application/json" \
    -H "X-Cache-Warm: 1" \
    --max-time 10 \
    "${url}" || echo "000")

  if [ "$status" = "200" ] || [ "$status" = "304" ]; then
    log "  ✓ ${path} — HTTP ${status}"
  else
    warn "  ✗ ${path} — HTTP ${status}"
  fi
}

purge_and_warm() {
  local path="$1"

  # Purge surrogate key first to ensure warm request bypasses stale edge cache
  if [ -n "$FASTLY_API_TOKEN" ] && [ -n "$FASTLY_SERVICE_ID" ]; then
    local surrogate_key
    # Derive surrogate key from path (mirrors surrogateKeys.ts naming)
    case "$path" in
      /plans*)   surrogate_key="plan" ;;
      /pricing*) surrogate_key="pricing" ;;
      /features*) surrogate_key="feature" ;;
      /public*)  surrogate_key="config" ;;
      *)         surrogate_key="public" ;;
    esac

    if [ "$DRY_RUN" = true ]; then
      log "[DRY RUN] Would purge surrogate key '${surrogate_key}' for ${path}"
    else
      log "Purging surrogate key '${surrogate_key}' for ${path}..."
      curl -sf -X POST \
        "https://api.fastly.com/service/${FASTLY_SERVICE_ID}/purge" \
        -H "Fastly-Key: ${FASTLY_API_TOKEN}" \
        -H "Surrogate-Key: ${surrogate_key}" \
        -H "Accept: application/json" > /dev/null && log "  ✓ Purged" || warn "  ✗ Purge failed"
    fi
  fi

  warm_path "$path"
}

# ── Main ──────────────────────────────────────────────────────────────────────

log "Starting CDN cache warm-up for ${API_ORIGIN}"
log "Dry run: ${DRY_RUN}"
log "Paths to warm: ${WARM_PATHS[*]}"
log "──────────────────────────────────────"

TOTAL=0
FAILED=0

for path in "${WARM_PATHS[@]}"; do
  purge_and_warm "$path" && TOTAL=$((TOTAL + 1)) || FAILED=$((FAILED + 1))
done

log "──────────────────────────────────────"
log "Cache warm complete. Total: ${TOTAL}, Failed: ${FAILED}"

if [ "$FAILED" -gt 0 ]; then
  warn "${FAILED} path(s) failed to warm. Check logs above."
  exit 1
fi

exit 0
