FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install --production=false
COPY src/ ./src/
RUN npm run build
RUN npm prune --production

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1
USER node
CMD ["node", "dist/index.js"]
