#!/bin/sh
set -eu

echo "[entrypoint] initializing soroban standalone placeholder"

# start the placeholder soroban server
/opt/soroban/soroban-server &
SERVER_PID=$!

# simple readiness probe
echo "waiting for HTTP health on :8000"
MAX=30
COUNT=0
until curl -sSf http://localhost:8000/ >/dev/null 2>&1 || [ "$COUNT" -ge "$MAX" ]; do
  sleep 1
  COUNT=$((COUNT+1))
done

if [ "$COUNT" -ge "$MAX" ]; then
  echo "[entrypoint] soroban server failed to start"
  kill "$SERVER_PID" || true
  exit 1
fi

echo "[entrypoint] soroban ready"
wait "$SERVER_PID"
