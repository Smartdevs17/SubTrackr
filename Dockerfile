FROM node:26-alpine AS dependencies

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile && pnpm store path > /dev/null

FROM node:26-alpine

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY backend ./backend
COPY src ./src

USER node

EXPOSE 3000

CMD ["npx", "tsx", "backend/server/start.ts"]