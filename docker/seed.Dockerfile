# docker/seed.Dockerfile
#
# Issue #1175 — Implement local development environment with Docker
#
# One-shot container that seeds the local PostgreSQL database with
# development data (plans, merchants, demo subscriptions).
#
# Usage:
#   docker compose run --rm seed
#
# The seed script (scripts/seed-local.js) reads DB connection details
# from the environment variables injected by docker-compose.yml.

FROM node:18-alpine

# Install curl + postgresql-client for healthcheck probing and psql fallback
RUN apk add --no-cache curl postgresql-client bash

WORKDIR /usr/src/app

# Copy only what the seed script needs — keeps the image small
COPY package*.json ./
COPY .npmrc ./

# Install production deps only (the seed script uses only built-in modules + pg)
RUN npm install --omit=dev --legacy-peer-deps && npm cache clean --force

COPY scripts/seed-local.js ./scripts/seed-local.js
COPY db/migrations/ ./db/migrations/

CMD ["node", "scripts/seed-local.js"]
