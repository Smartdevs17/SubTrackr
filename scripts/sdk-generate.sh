#!/usr/bin/env bash
set -euo pipefail

# ── SDK Generator ──────────────────────────────────────────────────────────────
# Invokes openapi-generator to regenerate SDK clients from spec/openapi.yaml.
# Usage: bash scripts/sdk-generate.sh <javascript|python|go>

LANGUAGE="${1:?Usage: $0 <javascript|python|go>}"
SPEC="spec/openapi.yaml"
OUTPUT_DIR="sdks/${LANGUAGE}"

# Custom generator patches for SDK-specific idioms
declare -A GENERATOR_OPTS
GENERATOR_OPTS[javascript]="--additional-properties=usePromises=true,useES6=npmProjectName=@subtrackr/sdk"
GENERATOR_OPTS[python]="--additional-properties=packageName=subtrackr,projectName=subtrackr-sdk"
GENERATOR_OPTS[go]="--additional-properties=packageName=subtrackr,isGoSubmodule=true"

# Remove prior generated output to ensure a clean regeneration
rm -rf "${OUTPUT_DIR}"

npx @openapitools/openapi-generator-cli generate \
  -i "${SPEC}" \
  -g "${LANGUAGE}" \
  -o "${OUTPUT_DIR}" \
  --skip-overwrite \
  ${GENERATOR_OPTS[${LANGUAGE}]:-}

echo "SDK generated for ${LANGUAGE} at ${OUTPUT_DIR}"
