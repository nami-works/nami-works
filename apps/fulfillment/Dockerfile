# syntax=docker/dockerfile:1.7
# Build context: repo root. Driver: scripts/deploy-fulfillment.ps1.

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app
# openssl is required by the Prisma engine binary on alpine.
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY apps/fulfillment/package.json ./apps/fulfillment/package.json
# letterbox is doc-only but npm workspaces needs every manifest to resolve.
COPY packages/letterbox/package.json ./packages/letterbox/package.json

COPY prisma/fulfillment ./prisma/fulfillment

RUN npm ci

COPY apps/fulfillment/tsconfig.json ./apps/fulfillment/tsconfig.json
COPY apps/fulfillment/src ./apps/fulfillment/src

RUN npm run prisma:generate -w @nami/fulfillment
RUN npm run build -w @nami/fulfillment

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/fulfillment/package.json ./apps/fulfillment/package.json
COPY packages/letterbox/package.json ./packages/letterbox/package.json
COPY prisma/fulfillment ./prisma/fulfillment

RUN npm ci --omit=dev

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/apps/fulfillment/dist ./apps/fulfillment/dist

USER node
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/fulfillment/dist/server.js"]
