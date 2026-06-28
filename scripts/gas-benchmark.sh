#!/bin/bash
# scripts/gas-benchmark.sh - Run gas cost profiling and check for regressions

set -euo pipefail

# Root directory of workspace
WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WORKSPACE_DIR"

# Defaults
THRESHOLD="0.10"
GENERATE_BASELINE="false"

# Helper for usage
show_help() {
    echo "Usage: $0 [options]"
    echo "Options:"
    echo "  --generate-baseline   Generate/overwrite baseline gas snapshot"
    echo "  --threshold <val>     Regression threshold as a fraction (default: 0.10)"
    echo "  -h, --help            Show this help message"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --generate-baseline)
            GENERATE_BASELINE="true"
            shift
            ;;
        --threshold)
            THRESHOLD="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

echo "=== Running Soroban Contract Gas Benchmarks ==="
export GAS_REGRESSION_THRESHOLD="$THRESHOLD"
export GENERATE_BASELINE="$GENERATE_BASELINE"
export COMMIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
export COMMIT_TIME="$(git log -1 --format=%ct 2>/dev/null || date +%s)"

# Run Cargo test in contracts workspace and pipe to Python analyzer
cd "$WORKSPACE_DIR/contracts"
cargo test --package subtrackr-proxy --test integration_soroban test_gas_benchmarks -- --nocapture | python3 "$WORKSPACE_DIR/scripts/analyze-gas.py"
