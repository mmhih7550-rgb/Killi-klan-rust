# CLAN KILLI — Express + SQLite, no build step.
# Stage 1 only produces node_modules; build tools never reach the shipped image.
FROM node:22-alpine AS deps

WORKDIR /app

# better-sqlite3 is a native module; on Alpine it must be compiled from source,
# so the toolchain lives only in this build stage.
RUN apk upgrade --no-cache \
 && apk add --no-cache --virtual .build python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --build-from-source

# Stage 2 is the runtime image: no compilers, patched Alpine packages only.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data \
    UPLOAD_DIR=/data/uploads

WORKDIR /app

# Distribution security fixes for the packages shipped in the final image.
RUN apk upgrade --no-cache

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /data/uploads && chown -R node:node /data /app

USER node

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||80)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
