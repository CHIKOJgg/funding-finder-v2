FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci

COPY backend ./backend

RUN cd backend && npx prisma generate
RUN cd backend && npm run build

FROM node:20-slim

WORKDIR /app

RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -m appuser

RUN apt-get update && apt-get install -y openssl wget && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci --omit=dev && \
    npm cache clean --force

COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/node_modules/.prisma node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma node_modules/@prisma
COPY backend/prisma backend/prisma

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["sh", "-c", "cd backend && npx prisma migrate deploy && cd .. && node backend/dist/index.js"]
