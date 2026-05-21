# syntax=docker/dockerfile:1.7
#
# Build context: repo root (monorepo). Build with:
#   docker build -f apps/omnify-admin/Dockerfile -t <tag> .
# (deploy-omnify-admin.ps1 does this.)
#
# Pre-merger (when this app shipped as github.com/nami-works/cpg-labs) the
# build context was apps/omnify-admin/ and `COPY packages/` referred to a
# peer-of-omnify-admin workspace dir. Post-merger the build context is the
# repo root and `packages/` are siblings of `apps/` under the monorepo root.

FROM node:20-alpine
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production

# Workspace manifests first -- npm ci needs the full workspace graph (root
# package.json + every workspace's package.json) to resolve symlinks. Copy
# only the manifests so dependency changes don't bust the source-COPY cache
# layers below.
COPY package.json package-lock.json ./
COPY apps/omnify-admin/package.json ./apps/omnify-admin/package.json
COPY packages/shared-auth/package.json ./packages/shared-auth/package.json
COPY packages/shared-db/package.json ./packages/shared-db/package.json
COPY packages/shared-encryption/package.json ./packages/shared-encryption/package.json
COPY packages/shared-google-routes/package.json ./packages/shared-google-routes/package.json
COPY packages/shared-i18n/package.json ./packages/shared-i18n/package.json
COPY packages/shared-ui/package.json ./packages/shared-ui/package.json
COPY packages/shared-webhooks/package.json ./packages/shared-webhooks/package.json
# letterbox is connector-scoped but appears in the root workspace graph,
# so npm ci needs its manifest too.
COPY packages/letterbox/package.json ./packages/letterbox/package.json

# Prisma schema must be present before npm ci (the omnify-admin postinstall
# does NOT run prisma generate today, but `npm run setup` at container start
# does, so we copy the schema now to keep the order independent of
# postinstall behavior changes).
COPY prisma/omnify ./prisma/omnify

# Install all workspaces' deps (including dev -- react-router build, vite,
# polaris-types, etc. are devDependencies of cpg-labs).
RUN npm ci

# Shared TypeScript base config — every workspace package's tsconfig.json
# extends ../../tsconfig.base.json. Vite's TSConfck resolves the extends
# chain at build time, so this file must be present in the image even
# though the app itself doesn't import it directly.
COPY tsconfig.base.json ./

# Source: omnify-admin app + all sibling packages it depends on. Each
# package directory is copied wholesale; the manifest layers above are
# overwritten with identical contents (idempotent).
COPY apps/omnify-admin ./apps/omnify-admin
COPY packages ./packages

# Optional: set BASE_PATH for subpath deployment (e.g. /full). Leave unset
# for root app.
ARG BASE_PATH
ENV BASE_PATH=${BASE_PATH}

# Build via workspace flag -- runs `react-router build` inside
# apps/omnify-admin per the cpg-labs workspace's build script.
RUN npm run build -w cpg-labs

EXPOSE 3000

# docker-start runs `npm run setup && npm run start`, which translates to
# `prisma generate && prisma migrate deploy && node server.mjs`. server.mjs
# uses CWD-relative paths, so we cd into the workspace dir before starting.
WORKDIR /app/apps/omnify-admin
CMD ["npm", "run", "docker-start"]
