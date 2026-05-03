# syntax=docker/dockerfile:1.7

# ---------- builder ----------
# Installs full deps (incl. dev) and produces dist/.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Build essentials for any native modules (bufferutil, better-sqlite3, etc.).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests first so the npm-install layer survives source-only changes.
COPY package.json package-lock.json ./
RUN npm ci

# Source. .dockerignore filters node_modules, dist, .env, attached_assets, etc.
COPY . .

# Vite -> dist/public, esbuild -> dist/index.cjs.
RUN npm run build

# Drop dev deps so the runtime stage gets a slim node_modules.
RUN npm prune --omit=dev


# ---------- runtime ----------
# Minimal image with only the artifacts and prod deps we need to serve.
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/package.json ./package.json

EXPOSE 5000

# HEALTHCHECK is added in commit A.4 once /health exists.

CMD ["node", "dist/index.cjs"]
