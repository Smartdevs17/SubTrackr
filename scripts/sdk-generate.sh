#!/usr/bin/env bash
set -euo pipefail

# ── SDK Generator ──────────────────────────────────────────────────────────────
# Regenerates SDK clients from spec/openapi.yaml with a pinned openapi-generator.
#
# Usage:
#   bash scripts/sdk-generate.sh <javascript|python|go>          # write generated files into sdks/<lang>
#   bash scripts/sdk-generate.sh <javascript|python|go> --check  # exit 1 if committed output differs
#
# Generation always happens in a scratch directory. Only the files listed in the
# generator's own manifest (.openapi-generator/FILES) are copied or compared, so
# hand-written files that live beside the generated code are never deleted.
# SDK_GEN_OUT may be set to keep the scratch output (CI uses it for artifacts).

LANGUAGE="${1:?Usage: $0 <javascript|python|go> [--check]}"
MODE="${2:-write}"
case "$MODE" in
  write) ;;
  --check) MODE="check" ;;
  *) echo "Unknown mode: $MODE (expected --check or nothing)" >&2; exit 2 ;;
esac

case "$LANGUAGE" in
  javascript|python|go) ;;
  *) echo "Unsupported language: $LANGUAGE" >&2; exit 2 ;;
esac

# ── Pinned generator ───────────────────────────────────────────────────────────
# Bump both values together, in the same PR as any regenerated output.
GENERATOR_CLI_VERSION="2.13.4"       # @openapitools/openapi-generator-cli (npm)
OPENAPI_GENERATOR_VERSION="7.10.0"   # openapi-generator jar the CLI downloads
export OPENAPI_GENERATOR_VERSION

SPEC="spec/openapi.yaml"
OUTPUT_DIR="sdks/${LANGUAGE}"

if [[ -n "${SDK_GEN_OUT:-}" ]]; then
  GEN_ROOT="${SDK_GEN_OUT}"
else
  GEN_ROOT="$(mktemp -d)"
  trap 'rm -rf "${GEN_ROOT}"' EXIT
fi
GEN_DIR="${GEN_ROOT}/${LANGUAGE}"
rm -rf "${GEN_DIR}"
mkdir -p "${GEN_ROOT}"

# Custom generator patches for SDK-specific idioms
declare -A GENERATOR_OPTS
GENERATOR_OPTS[javascript]="--additional-properties=usePromises=true,useES6=npmProjectName=@subtrackr/sdk"
GENERATOR_OPTS[python]="--additional-properties=packageName=subtrackr,projectName=subtrackr-sdk"
GENERATOR_OPTS[go]="--additional-properties=packageName=subtrackr,isGoSubmodule=true"

npx --yes "@openapitools/openapi-generator-cli@${GENERATOR_CLI_VERSION}" generate \
  -i "${SPEC}" \
  -g "${LANGUAGE}" \
  -o "${GEN_DIR}" \
  ${GENERATOR_OPTS[${LANGUAGE}]:-}

MANIFEST="${GEN_DIR}/.openapi-generator/FILES"
if [[ ! -f "${MANIFEST}" ]]; then
  echo "Generator manifest not found: ${MANIFEST}" >&2
  exit 1
fi

if [[ "${MODE}" == "write" ]]; then
  while IFS= read -r rel; do
    [[ -z "${rel}" ]] && continue
    mkdir -p "$(dirname "${OUTPUT_DIR}/${rel}")"
    cp "${GEN_DIR}/${rel}" "${OUTPUT_DIR}/${rel}"
  done < "${MANIFEST}"
  echo "SDK generated for ${LANGUAGE} at ${OUTPUT_DIR}"
  exit 0
fi

# ── Check mode: fail if committed output differs from a fresh generation ──────
drift=0
count=0
while IFS= read -r rel; do
  [[ -z "${rel}" ]] && continue
  count=$((count + 1))
  if [[ ! -f "${OUTPUT_DIR}/${rel}" ]]; then
    echo "[sdk:check] Missing committed file: ${OUTPUT_DIR}/${rel}" >&2
    drift=1
  elif ! cmp -s "${GEN_DIR}/${rel}" "${OUTPUT_DIR}/${rel}"; then
    echo "[sdk:check] Drift in ${OUTPUT_DIR}/${rel}" >&2
    diff -u "${OUTPUT_DIR}/${rel}" "${GEN_DIR}/${rel}" >&2 || true
    drift=1
  fi
done < "${MANIFEST}"

if [[ "${drift}" -ne 0 ]]; then
  echo "[sdk:check] ${LANGUAGE} SDK is out of date. Run: bash scripts/sdk-generate.sh ${LANGUAGE}" >&2
  exit 1
fi

echo "[sdk:check] ${LANGUAGE} SDK matches spec (${count} generated files)."
