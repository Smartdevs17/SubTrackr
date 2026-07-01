#!/usr/bin/env bash
set -euo pipefail

: "${ZAP_TARGET_URL:?ZAP_TARGET_URL must be set to the sandbox or local test deployment URL}"

REPORT_DIR="${ZAP_REPORT_DIR:-security-reports}"
MAX_ATTEMPTS="${ZAP_MAX_ATTEMPTS:-3}"
BACKOFF_SECONDS="${ZAP_BACKOFF_SECONDS:-300}"
FAIL_LEVEL="${ZAP_FAIL_LEVEL:-Critical}"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"

mkdir -p "$REPORT_DIR"

attempt=1
last_status=0

while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "Running OWASP ZAP baseline scan attempt $attempt/$MAX_ATTEMPTS against $ZAP_TARGET_URL"
  set +e
  docker run --rm --network host \
    -v "$PWD/$REPORT_DIR:/zap/wrk:rw" \
    "$ZAP_IMAGE" zap-baseline.py \
      -t "$ZAP_TARGET_URL" \
      -J zap-baseline.json \
      -r zap-baseline.html \
      -w zap-baseline.md \
      -I \
      -T 10 \
      -m 5 | tee "$REPORT_DIR/zap-baseline.log"
  last_status="${PIPESTATUS[0]}"
  set -e

  if [ "$last_status" -eq 0 ]; then
    break
  fi

  if grep -Eiq "429|rate.?limit|too many requests" "$REPORT_DIR/zap-baseline.log" \
    && [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "ZAP scan appears rate limited; waiting ${BACKOFF_SECONDS}s before retry."
    sleep "$BACKOFF_SECONDS"
    attempt=$((attempt + 1))
    continue
  fi

  break
done

python - "$REPORT_DIR/zap-baseline.json" "$FAIL_LEVEL" <<'PY'
import json
import sys
from pathlib import Path

report = Path(sys.argv[1])
fail_level = sys.argv[2].lower()
if not report.exists():
    print("ZAP JSON report was not generated")
    raise SystemExit(1)

ranks = {"informational": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
threshold = ranks.get(fail_level, 4)
data = json.loads(report.read_text(encoding="utf-8"))
alerts = []
for site in data.get("site", []):
    for alert in site.get("alerts", []):
        risk = str(alert.get("riskdesc", "informational")).split()[0].lower()
        if ranks.get(risk, 0) >= threshold:
            alerts.append((risk, alert.get("name", "ZAP alert")))

if alerts:
    for risk, name in alerts:
        print(f"ZAP {risk} finding: {name}")
    raise SystemExit(1)
PY

exit "$last_status"
