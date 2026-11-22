#!/usr/bin/env bash
set -euo pipefail

# Integration test runner: builds the test network, snapshots, runs tests, and tears down.
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
COMPOSE_FILE="$ROOT_DIR/docker-compose.test.yml"

echo "[test-integration] starting docker-compose up"
docker-compose -f "$COMPOSE_FILE" up -d --build

echo "[test-integration] waiting for service healthy"
docker-compose -f "$COMPOSE_FILE" ps

# wait for health
timeout=60
elapsed=0
until docker-compose -f "$COMPOSE_FILE" exec -T stellar-standalone sh -c "curl -sSf http://localhost:8000/ >/dev/null" >/dev/null 2>&1 || [ $elapsed -ge $timeout ]; do
  sleep 1
  elapsed=$((elapsed+1))
done

if [ $elapsed -ge $timeout ]; then
  echo "Service failed to become healthy"
  docker-compose -f "$COMPOSE_FILE" logs
  exit 1
fi

export SOROBAN_RPC_URL=http://localhost:8000
export TEST_TIMEOUT_MS=30000

echo "[test-integration] running tests with SOROBAN_RPC_URL=$SOROBAN_RPC_URL"
# Run workspace tests (assumes tests are configured to use packages/test-harness helpers)
if command -v yarn >/dev/null 2>&1; then
  yarn workspace @subtrackr/test-harness test:integration --runInBand || TEST_EXIT=$?
else
  npm --workspace ./packages/test-harness run test:integration || TEST_EXIT=$?
fi

TEST_EXIT=${TEST_EXIT:-0}

echo "[test-integration] tearing down"
docker-compose -f "$COMPOSE_FILE" down --volumes --remove-orphans

exit $TEST_EXIT
