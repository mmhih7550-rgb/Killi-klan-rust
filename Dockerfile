# CLAN KILLI — Express + SQLite, no build step.
# Stage 1 only produces node_modules (build tools stay out of the shipped image).
FROM node:22-trixie-slim AS deps

WORKDIR /app

# better-sqlite3 ships prebuilt binaries for node 22; build tools cover the source fallback.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Stage 2 is the runtime image: no compilers, only patched distribution packages.
FROM node:22-trixie-slim

ENV NODE_ENV=production \
    PORT=80 \
    DATA_DIR=/data \
    UPLOAD_DIR=/data/uploads

WORKDIR /app

# Distribution security fixes for the libraries shipped in the final image.
RUN apt-get update \
 && apt-get -y --no-install-recommends upgrade \
 && rm -rf /var/lib/apt/lists/*

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
