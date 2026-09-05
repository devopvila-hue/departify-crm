# ---- builder ----
FROM node:22-alpine AS builder
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile=false

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter=@departify-crm/db build
RUN pnpm --filter=@departify-crm/shared build
RUN pnpm --filter=@departify-crm/api build

# ---- runner ----
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
COPY --from=builder /repo /repo
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]
