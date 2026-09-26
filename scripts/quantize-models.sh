#!/usr/bin/env bash
# Quantization pipeline: PyTorch → ONNX → INT8
# Runs export and quantization for all three ML models.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ML_SERVICE_DIR="${PROJECT_ROOT}/ml-service"
MODELS_DIR="${ML_SERVICE_DIR}/models"

log() { echo "[quantize-models] $*"; }

# Ensure output directory exists
mkdir -p "$MODELS_DIR"

# Model definitions: model_type, optional checkpoint path
MODELS=(
    "churn:${MODELS_DIR}/churn.pt"
    "pricing:${MODELS_DIR}/pricing.pt"
    "recommendation:${MODELS_DIR}/recommendation.pt"
)

for entry in "${MODELS[@]}"; do
    IFS=':' read -r model_type model_path <<< "$entry"

    log "Processing model: ${model_type}"

    onnx_output="${MODELS_DIR}/${model_type}.onnx"

    if [ -f "$model_path" ]; then
        log "Exporting ${model_type} from checkpoint ${model_path}"
        python "${ML_SERVICE_DIR}/models/export_to_onnx.py" \
            --model-type "$model_type" \
            --model-path "$model_path" \
            --output "$onnx_output" \
            --quantize \
            --calibration-samples 1000 \
            --validate
    else
        log "No checkpoint found at ${model_path}, using random weights"
        python "${ML_SERVICE_DIR}/models/export_to_onnx.py" \
            --model-type "$model_type" \
            --model-path "$model_path" \
            --output "$onnx_output" \
            --quantize \
            --calibration-samples 1000 \
            --validate
    fi

    log "Completed ${model_type}"
done

log "All models quantized successfully"

# Verify all output files exist
for model_type in churn pricing recommendation; do
    for ext in onnx _int8.onnx; do
        file="${MODELS_DIR}/${model_type}${ext}"
        if [ -f "$file" ]; then
            size=$(du -h "$file" | cut -f1)
            log "  ✓ ${file} (${size})"
        else
            log "  ✗ ${file} not found"
        fi
    done
done
