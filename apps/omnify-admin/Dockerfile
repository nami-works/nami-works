FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY packages/ packages/

RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Optional: set BASE_PATH for subpath deployment (e.g. /full). Leave unset for root app.
ARG BASE_PATH
ENV BASE_PATH=${BASE_PATH}

RUN npm run build

CMD ["npm", "run", "docker-start"]
