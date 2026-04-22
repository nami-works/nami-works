# syntax=docker/dockerfile:1.7

# ---- build stage: install all deps, generate Prisma client, compile TS ----
FROM node:20-alpine AS build
WORKDIR /app
# openssl is required by the Prisma engine binary on alpine.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

# ---- runtime stage: prod deps only, compiled JS, generated Prisma client ----
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
# Prisma's generated client lives in node_modules/.prisma and is referenced by
# @prisma/client at require time. Copy it from the build stage so we don't need
# the prisma CLI (a devDep) in the runtime image.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
