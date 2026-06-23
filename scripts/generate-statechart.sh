#!/usr/bin/env bash
# SubTrackr - Subscription State Chart Visualization Generator
# Usage: ./scripts/generate-statechart.sh [output_format]
#   output_format: mermaid (default) | svg | png

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${PROJECT_ROOT}/docs/diagrams"
OUTPUT_FORMAT="${1:-mermaid}"

mkdir -p "$OUTPUT_DIR"

# Generate Mermaid state diagram from the TypeScript state machine definition
MERMAID_FILE="${OUTPUT_DIR}/subscription-statechart.mermaid"

cat > "$MERMAID_FILE" << 'MERMAID_EOF'
stateDiagram-v2
  state "Active" as Active {
    state "Active.Trial" as Active_Trial
    state "Active.Paid" as Active_Paid
    state "Active.PastDue" as Active_PastDue
    [*] --> Active_Trial
    Active_Trial --> Active_Paid : trial_to_paid
    Active_Paid --> Active_PastDue : payment_fail
    Active_PastDue --> Active_Paid : payment_recover
  }

  state "Inactive" as Inactive {
    state "Inactive.Cancelled" as Inactive_Cancelled
    state "Inactive.PausedEndOfCycle" as Inactive_PausedEndOfCycle
    state "Inactive.Expired" as Inactive_Expired
  }

  state "Suspended" as Suspended {
    state "Suspended.FraudHold" as Suspended_FraudHold
    state "Suspended.AdminHold" as Suspended_AdminHold
  }

  Active --> Inactive_Cancelled : cancel
  Active --> Inactive_PausedEndOfCycle : pause
  Active --> Inactive_Expired : expire
  Active --> Suspended_FraudHold : suspend_fraud
  Active --> Suspended_AdminHold : suspend_admin

  Active_Paid --> Inactive_Cancelled : cancel
  Active_Paid --> Inactive_PausedEndOfCycle : pause
  Active_Paid --> Inactive_Expired : expire
  Active_Paid --> Suspended_FraudHold : suspend_fraud
  Active_Paid --> Suspended_AdminHold : suspend_admin

  Active_Trial --> Active_Paid : upgrade
  Active_Trial --> Active_Paid : downgrade

  Inactive_PausedEndOfCycle --> Active_Paid : resume
  Inactive_PausedEndOfCycle --> Inactive_Cancelled : cancel
  Inactive_PausedEndOfCycle --> Inactive_Expired : expire

  Suspended_FraudHold --> Active_Paid : unsuspend
  Suspended_AdminHold --> Active_Paid : unsuspend
MERMAID_EOF

echo "Generated Mermaid state chart: $MERMAID_FILE"

if [ "$OUTPUT_FORMAT" = "mermaid" ]; then
  echo "Done. Use a Mermaid renderer to view the diagram."
  exit 0
fi

if ! command -v mmdc &> /dev/null; then
  echo "Warning: mermaid-cli (mmdc) not found. Only .mermaid file was generated."
  echo "Install with: npm install -g @mermaid-js/mermaid-cli"
  exit 0
fi

if [ "$OUTPUT_FORMAT" = "svg" ]; then
  mmdc -i "$MERMAID_FILE" -o "${OUTPUT_DIR}/subscription-statechart.svg"
  echo "Generated: ${OUTPUT_DIR}/subscription-statechart.svg"
elif [ "$OUTPUT_FORMAT" = "png" ]; then
  mmdc -i "$MERMAID_FILE" -o "${OUTPUT_DIR}/subscription-statechart.png" -b transparent
  echo "Generated: ${OUTPUT_DIR}/subscription-statechart.png"
fi
