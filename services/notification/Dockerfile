FROM node:26-alpine AS builder

RUN corepack enable

WORKDIR /app

# Leverage Docker cache for pnpm install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY services/notification ./services/notification

RUN pnpm install --frozen-lockfile --filter @subtrackr/notification-service

WORKDIR /app/services/notification
RUN pnpm run build

FROM node:26-alpine

RUN corepack enable

WORKDIR /app
COPY --from=builder /app/services/notification/dist ./dist
COPY --from=builder /app/services/notification/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
CMD ["node", "dist/index.js"]