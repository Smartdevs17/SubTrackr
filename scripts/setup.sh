#!/usr/bin/env bash
set -e

echo "==========================================="
echo " SubTrackr Local Environment Setup"
echo "==========================================="

if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed."
    exit 1
fi

if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

echo "Pulling latest base images..."
docker compose pull

echo "Building local services..."
docker compose build

echo "✅ Setup complete!"
echo "➡️ Start the stack: docker compose up -d"
echo "➡️ Seed test data: docker compose run --rm seed"