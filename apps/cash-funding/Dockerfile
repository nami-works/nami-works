# syntax=docker/dockerfile:1.7
#
# Build context: repo root (monorepo). Build with:
#   docker build -f apps/cash-funding/Dockerfile -t <tag> .
# Mirrors apps/connector/Dockerfile's pattern (see that file for why each
# COPY exists — same coexisting-custom-Prisma-client trick applies here).

FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY apps/cash-funding/package.json ./apps/cash-funding/package.json
COPY prisma/cash-funding ./prisma/cash-funding

RUN npm ci

COPY apps/cash-funding/tsconfig.json ./apps/cash-funding/tsconfig.json
COPY apps/cash-funding/src ./apps/cash-funding/src
COPY apps/cash-funding/public ./apps/cash-funding/public

RUN npm run prisma:generate -w @nami/cash-funding
RUN npm run build -w @nami/cash-funding

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/cash-funding/package.json ./apps/cash-funding/package.json
COPY prisma/cash-funding ./prisma/cash-funding

RUN npm ci --omit=dev

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client-cash-funding ./node_modules/@prisma/client-cash-funding
COPY --from=build /app/apps/cash-funding/dist ./apps/cash-funding/dist
COPY --from=build /app/apps/cash-funding/public ./apps/cash-funding/public

USER node
EXPOSE 3010
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/cash-funding/dist/server.js"]
