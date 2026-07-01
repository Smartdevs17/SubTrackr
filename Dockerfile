FROM node:20-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps && npm cache clean --force

FROM node:20-alpine

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
