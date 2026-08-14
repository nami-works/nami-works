# syntax=docker/dockerfile:1.7
#
# Build context: repo root (monorepo). Build with:
#   docker build -f apps/sales-whatsapp/Dockerfile -t <tag> .
# (deploy-beautyback.ps1 does this.)
#
# Unlike omnify-admin, this app has zero packages/* dependencies (own
# isolated Prisma schema, no shared-auth/shared-db/etc.) — the build is
# self-contained to apps/sales-whatsapp + prisma/sales-whatsapp.

FROM node:20-alpine
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

# Workspace manifests first — npm ci needs the full workspace graph to
# resolve symlinks, but this app has no sibling package dependencies.
COPY package.json package-lock.json ./
COPY apps/sales-whatsapp/package.json ./apps/sales-whatsapp/package.json

# Prisma schema must be present before npm ci resolves the workspace's
# `prisma.schema` field (used by `npm run setup`'s `prisma generate`).
COPY prisma/sales-whatsapp ./prisma/sales-whatsapp

RUN npm ci

# Shared TypeScript base config — this workspace's tsconfig.json extends
# ../../tsconfig.base.json; Vite's TSConfck resolves it at build time.
COPY tsconfig.base.json ./

COPY apps/sales-whatsapp ./apps/sales-whatsapp

# BASE_PATH (2026-08-14): apps.gebeauty.com.br is a shared, path-routed
# host — this app owns /beautyback. Must be set at BUILD time (baked into
# the client bundle's basename), not just runtime — same lesson as
# omnify-admin's 2026-04-17 incident (stale baked-in basename → health
# checks 404 → crash loop).
ARG BASE_PATH=/beautyback
ENV BASE_PATH=${BASE_PATH}

RUN npm run build -w @nami/sales-whatsapp

EXPOSE 3000

# docker-start runs `npm run setup && npm run start`, i.e.
# `prisma generate && prisma migrate deploy && node server.mjs`.
WORKDIR /app/apps/sales-whatsapp
ENV PORT=3000
CMD ["npm", "run", "docker-start"]
