#!/usr/bin/env bash
# setup.sh
#
# Issue #1175 — Implement local development environment with Docker
#
# Initializes the full SubTrackr local development stack:
#   1. Checks prerequisites (Docker, Docker Compose)
#   2. Creates .env from .env.example if not present
#   3. Pulls base images and builds all services
#   4. Starts the core services in detached mode
#   5. Waits for PostgreSQL and Redis to be healthy
#   6. Runs the DB seeder
#   7. Prints service status and quick-start instructions
#
# Usage:
#   ./scripts/setup.sh           # Full setup with seed
#   ./scripts/setup.sh --no-seed # Skip seeding (useful for clean reset)
#   ./scripts/setup.sh --pull    # Force-pull all base images before building

set -euo pipefail

# ── Source shared utilities ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/utils.sh
source "${SCRIPT_DIR}/utils.sh"

# ── Parse flags ──────────────────────────────────────────────────────────────
NO_SEED=false
FORCE_PULL=false

for arg in "$@"; do
  case "$arg" in
    --no-seed)  NO_SEED=true   ;;
    --pull)     FORCE_PULL=true ;;
    --help|-h)
      echo "Usage: $0 [--no-seed] [--pull]"
      echo ""
      echo "  --no-seed  Skip database seeding"
      echo "  --pull     Force-pull all base images before building"
      exit 0
      ;;
    *)
      print_warning "Unknown flag: $arg (ignored)"
      ;;
  esac
done

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo "==========================================="
echo " SubTrackr Local Environment Setup"
echo "==========================================="
echo ""

# ── Prerequisite checks ──────────────────────────────────────────────────────
print_status "Checking prerequisites…"

check_command docker

# Verify Docker daemon is running
if ! docker info >/dev/null 2>&1; then
  print_error "Docker daemon is not running. Please start Docker and retry."
  exit 1
fi

# Check for Compose plugin (v2) then fall back to standalone compose (v1)
if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
  print_warning "Using legacy docker-compose (v1). Consider upgrading to Docker Compose v2."
else
  print_error "Docker Compose not found. Install Docker Desktop or the Compose plugin."
  exit 1
fi

print_success "Docker $(docker --version | awk '{print $3}' | tr -d ',') — OK"

# ── Environment file ─────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  print_status "Creating .env from .env.example…"
  cp .env.example .env
  print_success ".env created — edit it to customise ports or credentials."
else
  print_status ".env already exists — skipping copy."
fi

# ── Pull base images ─────────────────────────────────────────────────────────
if [ "$FORCE_PULL" = "true" ]; then
  print_status "Pulling latest base images (--pull flag set)…"
  $COMPOSE_CMD pull --ignore-pull-failures || true
else
  print_status "Pulling base images for services that use pre-built images…"
  $COMPOSE_CMD pull postgres redis --ignore-pull-failures || true
fi

# ── Build custom images ──────────────────────────────────────────────────────
print_status "Building local service images (backend, ml-service, stellar-standalone, seed)…"
$COMPOSE_CMD build --parallel backend workers webhook-dispatcher stellar-standalone mobile seed

print_success "All images built successfully."

# ── Start core services ──────────────────────────────────────────────────────
print_status "Starting core services (postgres, redis, backend, workers, webhook-dispatcher, stellar-standalone)…"
$COMPOSE_CMD up -d postgres redis backend workers webhook-dispatcher stellar-standalone

# ── Wait for PostgreSQL ──────────────────────────────────────────────────────
print_status "Waiting for PostgreSQL to be healthy…"
MAX_WAIT=60
ELAPSED=0
INTERVAL=3

until $COMPOSE_CMD exec -T postgres pg_isready -U "${DB_USER:-postgres}" -d "${DB_NAME:-subtrackr}" >/dev/null 2>&1; do
  if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
    print_error "PostgreSQL did not become healthy within ${MAX_WAIT}s. Check logs:"
    print_error "  $COMPOSE_CMD logs postgres"
    exit 1
  fi
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
  print_status "  … waiting (${ELAPSED}s / ${MAX_WAIT}s)"
done
print_success "PostgreSQL is healthy."

# ── Wait for Redis ───────────────────────────────────────────────────────────
print_status "Waiting for Redis to be healthy…"
ELAPSED=0

until $COMPOSE_CMD exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; do
  if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
    print_error "Redis did not respond within ${MAX_WAIT}s. Check logs:"
    print_error "  $COMPOSE_CMD logs redis"
    exit 1
  fi
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
  print_status "  … waiting (${ELAPSED}s / ${MAX_WAIT}s)"
done
print_success "Redis is healthy."

# ── Wait for Backend ─────────────────────────────────────────────────────────
print_status "Waiting for backend API to be ready…"
BACKEND_PORT="${COMPOSE_PORT_BACKEND:-3000}"
ELAPSED=0

until curl -sf "http://localhost:${BACKEND_PORT}/healthz" >/dev/null 2>&1; do
  if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
    print_warning "Backend did not respond to healthcheck within ${MAX_WAIT}s."
    print_warning "It may still be starting — check logs with: $COMPOSE_CMD logs backend"
    break
  fi
  sleep "$INTERVAL"
  ELAPSED=$((ELAPSED + INTERVAL))
  print_status "  … waiting (${ELAPSED}s / ${MAX_WAIT}s)"
done

if curl -sf "http://localhost:${BACKEND_PORT}/healthz" >/dev/null 2>&1; then
  print_success "Backend API is ready at http://localhost:${BACKEND_PORT}"
fi

# ── Run DB seeder ─────────────────────────────────────────────────────────────
if [ "$NO_SEED" = "false" ]; then
  print_status "Seeding the database with development fixtures…"
  $COMPOSE_CMD run --rm seed
  print_success "Database seeded."
else
  print_status "Skipping seed (--no-seed flag set)."
fi

# ── Service status ────────────────────────────────────────────────────────────
echo ""
print_status "Current service status:"
$COMPOSE_CMD ps

# ── Quick-start instructions ──────────────────────────────────────────────────
SOROBAN_PORT="${COMPOSE_PORT_SOROBAN:-8000}"
REDIS_PORT="${COMPOSE_PORT_REDIS:-6379}"
POSTGRES_PORT="${COMPOSE_PORT_POSTGRES:-5432}"
ML_PORT="${COMPOSE_PORT_ML:-8001}"
EXPO_PORT="${COMPOSE_PORT_EXPO:-8081}"

echo ""
echo "==========================================="
echo " ✅  SubTrackr stack is up!"
echo "==========================================="
echo ""
echo "  🔌  Services:"
echo "        Backend API      → http://localhost:${BACKEND_PORT}"
echo "        Soroban node     → http://localhost:${SOROBAN_PORT}"
echo "        ML service       → http://localhost:${ML_PORT}"
echo "        Expo mobile dev  → http://localhost:${EXPO_PORT}"
echo "        PostgreSQL       → localhost:${POSTGRES_PORT}"
echo "        Redis            → localhost:${REDIS_PORT}"
echo ""
echo "  📋  Useful commands:"
echo "        View logs        →  $COMPOSE_CMD logs -f [service]"
echo "        Stop all         →  $COMPOSE_CMD down"
echo "        Re-seed DB       →  $COMPOSE_CMD run --rm seed"
echo "        Start mobile     →  $COMPOSE_CMD up -d mobile"
echo "        Run API tests    →  npm run test:backend"
echo "        Deploy contracts →  ./scripts/deploy-local.sh"
echo ""
