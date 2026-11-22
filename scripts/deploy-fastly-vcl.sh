#!/usr/bin/env bash
# Deploy Fastly recv/fetch snippets and activate the new service version.
set -euo pipefail

SERVICE_ID="${FASTLY_SERVICE_ID:?FASTLY_SERVICE_ID required}"
API_TOKEN="${FASTLY_API_TOKEN:?FASTLY_API_TOKEN required}"
SNIPPETS_DIR="${1:-infra/fastly/snippets}"

if [ ! -d "$SNIPPETS_DIR" ]; then
  echo "Snippets directory not found: $SNIPPETS_DIR"
  exit 1
fi

API="https://api.fastly.com"
AUTH=(-H "Fastly-Key: ${API_TOKEN}" -H "Accept: application/json")

upload_snippet() {
  local version="$1"
  local name="$2"
  local type="$3"
  local file="$4"
  local content
  content=$(cat "$file")

  echo "Uploading snippet ${name} (${type}) to version ${version}..."
  curl -sf -X PUT \
    "${API}/service/${SERVICE_ID}/version/${version}/snippet/${name}" \
    -H "Fastly-Key: ${API_TOKEN}" \
    --data-urlencode "content=${content}" \
    --data-urlencode "type=${type}" \
    --data-urlencode "priority=100" \
    --data-urlencode "dynamic=0"
}

echo "Cloning active service version..."
CLONE_RESPONSE=$(curl -sf -X POST "${API}/service/${SERVICE_ID}/version" "${AUTH[@]}")
VERSION=$(echo "$CLONE_RESPONSE" | python3 -c 'import json,sys; print(json.load(sys.stdin)["number"])')
echo "Created version ${VERSION}"

upload_snippet "$VERSION" "subtrackr_cache_recv" "recv" "${SNIPPETS_DIR}/recv.vcl"
upload_snippet "$VERSION" "subtrackr_cache_fetch" "fetch" "${SNIPPETS_DIR}/fetch.vcl"

echo "Activating version ${VERSION}..."
curl -sf -X PUT "${API}/service/${SERVICE_ID}/version/${VERSION}/activate" "${AUTH[@]}" > /dev/null

echo "Fastly cache snippets deployed and activated (version ${VERSION})"
