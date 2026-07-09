FROM node:20-alpine AS builder

WORKDIR /app

# Copy root workspace files for npm ci
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/

# Install all dependencies (root + frontend)
RUN npm ci --workspace=frontend

# Copy frontend source
COPY frontend ./frontend

# Build Vite app
RUN cd frontend && npm run build

# --- Production stage: nginx ---
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Copy nginx config
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
