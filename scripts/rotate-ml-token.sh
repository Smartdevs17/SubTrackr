#!/usr/bin/env bash
#
# Rotate the ml-service API token on a schedule (#2099).
#
# Generates a new token and stores it in the Kubernetes secret as the first entry
# of ML_SERVICE_API_TOKENS. The previous current token is kept as the second entry,
# so clients that have not switched yet keep working during the grace period.
# Older tokens are dropped at the next rotation. Then the ml-service deployment is
# restarted so the pods reload the secret.
#
# Usage:
#   scripts/rotate-ml-token.sh [--namespace NS] [--secret NAME] [--deployment NAME]
#
# Environment overrides: ML_NAMESPACE, ML_TOKEN_SECRET, ML_TOKEN_KEY, ML_DEPLOYMENT.
# The token is never printed. Only the rotation timestamp is logged.

set -euo pipefail

NAMESPACE="${ML_NAMESPACE:-default}"
SECRET="${ML_TOKEN_SECRET:-ml-service-api-tokens}"
KEY="${ML_TOKEN_KEY:-ML_SERVICE_API_TOKENS}"
DEPLOYMENT="${ML_DEPLOYMENT:-ml-service}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace)  NAMESPACE="$2"; shift 2 ;;
    --secret)     SECRET="$2"; shift 2 ;;
    --deployment) DEPLOYMENT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

for tool in kubectl openssl; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }
done

NEW_TOKEN="$(openssl rand -hex 32)"

# Current value from the secret. Empty on first run.
CURRENT="$(kubectl -n "$NAMESPACE" get secret "$SECRET" -o "jsonpath={.data.${KEY}}" 2>/dev/null | base64 -d 2>/dev/null || true)"
PREVIOUS="$(printf '%s' "$CURRENT" | cut -d, -f1)"

if [[ -n "$PREVIOUS" ]]; then
  VALUE="${NEW_TOKEN},${PREVIOUS}"
else
  VALUE="${NEW_TOKEN}"
fi

# stringData merges into the secret, so other keys are left alone.
kubectl -n "$NAMESPACE" patch secret "$SECRET" --type merge \
  -p "{\"stringData\":{\"${KEY}\":\"${VALUE}\"}}" >/dev/null

kubectl -n "$NAMESPACE" rollout restart "deployment/${DEPLOYMENT}" >/dev/null
kubectl -n "$NAMESPACE" rollout status "deployment/${DEPLOYMENT}" --timeout=300s >/dev/null

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ml-service token rotated (namespace=${NAMESPACE} secret=${SECRET})"
