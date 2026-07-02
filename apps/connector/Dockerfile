# syntax=docker/dockerfile:1.7
#
# Build context: repo root (monorepo). Build with:
#   docker build -f apps/connector/Dockerfile -t <tag> .
# (deploy-connector.ps1 does this.)

# ---- build stage: install all deps, generate Prisma client, compile TS ----
FROM node:20-alpine AS build
WORKDIR /app
# openssl is required by the Prisma engine binary on alpine.
RUN apk add --no-cache openssl

# Workspace manifests (needed by npm ci to resolve the workspace graph).
COPY package.json package-lock.json ./
COPY apps/connector/package.json ./apps/connector/package.json
COPY packages/letterbox/package.json ./packages/letterbox/package.json

# Prisma schema must be present before prisma generate; copy now so npm
# postinstall hooks (none today, but cheap insurance) see the schema too.
COPY prisma/connector ./prisma/connector

RUN npm ci

# Connector source and tsconfig.
COPY apps/connector/tsconfig.json ./apps/connector/tsconfig.json
COPY apps/connector/src ./apps/connector/src

RUN npm run prisma:generate -w @nami/connector
RUN npm run build -w @nami/connector

# ---- runtime stage: prod deps only, compiled JS, generated Prisma client ----
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/connector/package.json ./apps/connector/package.json
COPY packages/letterbox/package.json ./packages/letterbox/package.json
COPY prisma/connector ./prisma/connector

RUN npm ci --omit=dev

# Prisma's generated client lives in node_modules/.prisma and is referenced by
# @prisma/client at require time. Copy it from the build stage so we don't need
# the prisma CLI (a devDep) in the runtime image.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
# The connector uses a custom generator output (@prisma/client-connector) so it
# can coexist with the omnify schema's default @prisma/client. That generated
# package is NOT recreated by `npm ci` in this stage, so copy it explicitly or
# the runtime crashes with ERR_MODULE_NOT_FOUND on '@prisma/client-connector'.
COPY --from=build /app/node_modules/@prisma/client-connector ./node_modules/@prisma/client-connector
COPY --from=build /app/apps/connector/dist ./apps/connector/dist

USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/connector/dist/server.js"]
