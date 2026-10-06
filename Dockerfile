# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile

COPY . .

RUN yarn build

# Serve stage: a small Node server serves the app and stores the shared tournament.
FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY server/server.mjs ./server/server.mjs

# Mount a persistent volume here, or the tournament is lost on every redeploy.
RUN mkdir -p /app/data
VOLUME /app/data

ENV NODE_ENV=production \
    PORT=9010 \
    DATA_DIR=/app/data

EXPOSE 9010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9010/health || exit 1

CMD ["node", "server/server.mjs"]
