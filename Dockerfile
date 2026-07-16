# syntax=docker/dockerfile:1.7

# ──────────────────────────────────────────────────────────────────────────────
# Build stage: install everything, build both workspaces.
# Uses the official Playwright image so Chromium + system deps for headless
# browser scraping are baked in. Pinned to the same minor as the npm package
# (server/package.json playwright dep).
# ──────────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS build

WORKDIR /app

# Copy lockfile first so install caches independently of source.
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci

# Source.
COPY server/ server/
COPY client/ client/

# Build server (TS → dist/) and client (Vite → dist/).
RUN npm run build --workspaces


# ──────────────────────────────────────────────────────────────────────────────
# Runtime stage: same Playwright base so the browser binary is available.
# Production-only npm install, copy built artifacts, run as a non-root user.
# ──────────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.49.1-jammy AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Bring in the production dependency tree only.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspaces

# Built artifacts.
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
# Migrations + the plain-node runner that applies them (no dev deps needed).
COPY server/migrations ./server/migrations
COPY server/scripts ./server/scripts

# Drop root for runtime. The Playwright image ships a `pwuser`.
USER pwuser

EXPOSE 3000

# Apply pending migrations on startup, then start the API + worker.
# Plain `node` invocations: the runtime image has no tsx and no server/src,
# which is exactly why the previous npm-run/tsx CMD crash-looped here.
CMD ["sh", "-c", "node server/scripts/migrate.mjs up && node server/dist/index.js"]
