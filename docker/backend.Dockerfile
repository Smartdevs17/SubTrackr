FROM node:24-alpine

RUN corepack enable

# Install build tools for native dependencies
RUN apk add --no-cache python3 make g++ curl bash

WORKDIR /usr/src/app

# Leverage Docker cache for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/ ./scripts/

RUN pnpm install --frozen-lockfile

# Copy the rest of the application code
COPY . .

EXPOSE 3000 8081