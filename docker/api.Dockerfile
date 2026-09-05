# syntax=docker/dockerfile:1.7
#
# DEPARTIFY CRM — single-container image
#
# One image runs the API AND serves the SPA (apps/web/dist/).
# That gives us one deploy, one domain, no CORS, native cookies.
#
# Stages:
#   1. deps    — installs all workspace deps with the lockfile
#   2. builder — builds @departify-crm/db, shared, api, and web
#   3. runner  — minimal runtime image, runs as non-root
#
# Used by Railway (set the Dockerfile path to docker/api.Dockerfile
# in the service settings) and docker compose.
#
# Build locally:
#   docker build -f docker/api.Dockerfile -t departify-crm .
#   docker run --rm -p 4000:4000 \
#     -e DATABASE_URL=... -e SESSION_SECRET=... -e ENCRYPTION_KEY=... \
#     departify-crm

# ─── deps ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json    packages/db/
COPY apps/api/package.json       apps/api/
COPY apps/web/package.json       apps/web/
RUN pnpm install --frozen-lockfile

# ─── builder ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /repo
RUN corepack enable
COPY --from=deps /repo ./
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api    apps/api
COPY apps/web    apps/web
RUN pnpm --filter=@departify-crm/db     build
RUN pnpm --filter=@departify-crm/shared build
RUN pnpm --filter=@departify-crm/api    build
RUN pnpm --filter=@departify-crm/web    build

# ─── runner ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /repo
RUN corepack enable \
 && addgroup -S app && adduser -S app -G app

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    # The SPA talks to the API on the same origin. No build-time
    # base URL needed; the client uses relative /api/v1/... paths.
    PUBLIC_API_BASE_PATH=/api/v1

# API build artifacts
COPY --from=builder --chown=app:app /repo/package.json                  /repo/package.json
COPY --from=builder --chown=app:app /repo/pnpm-workspace.yaml           /repo/pnpm-workspace.yaml
COPY --from=builder --chown=app:app /repo/packages/db/dist              /repo/packages/db/dist
COPY --from=builder --chown=app:app /repo/packages/db/package.json      /repo/packages/db/package.json
COPY --from=builder --chown=app:app /repo/packages/shared/dist           /repo/packages/shared/dist
COPY --from=builder --chown=app:app /repo/packages/shared/package.json  /repo/packages/shared/package.json
COPY --from=builder --chown=app:app /repo/apps/api/dist                 /repo/apps/api/dist
COPY --from=builder --chown=app:app /repo/apps/api/package.json         /repo/apps/api/package.json
COPY --from=builder --chown=app:app /repo/apps/web/dist                 /repo/apps/web/dist
# node_modules from the install layer (workspace symlinks stay valid).
COPY --from=builder --chown=app:app /repo/node_modules                  /repo/node_modules
COPY --from=builder --chown=app:app /repo/packages/db/node_modules      /repo/packages/db/node_modules
COPY --from=builder --chown=app:app /repo/packages/shared/node_modules  /repo/packages/shared/node_modules
COPY --from=builder --chown=app:app /repo/apps/api/node_modules         /repo/apps/api/node_modules
COPY --from=builder --chown=app:app /repo/apps/web/node_modules         /repo/apps/web/node_modules

USER app
WORKDIR /repo/apps/api
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:4000/health || exit 1

CMD ["node", "dist/index.js"]
