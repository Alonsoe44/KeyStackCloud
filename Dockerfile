ARG NODE_IMAGE=node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9
ARG YTDLP_VERSION=2026.08.19

FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM --platform=$TARGETPLATFORM ${NODE_IMAGE} AS runtime
ARG YTDLP_VERSION
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp==${YTDLP_VERSION}" "yt-dlp-ejs==0.8.0" \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_ROOT=/data \
    AUDIO_ROOT=/audio \
    DB_PATH=/data/songstreamer.sqlite \
    MIGRATIONS_DIR=/app/migrations \
    REQUIRE_SSD_MARKER=true \
    HOME=/tmp \
    XDG_CACHE_HOME=/tmp/yt-dlp-cache \
    YTDLP_CACHE_DIR=/tmp/yt-dlp-cache \
    IMPORT_STAGING_ROOT=/audio/.import-staging \
    YTDLP_PATH=/opt/yt-dlp/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts/library.mjs ./scripts/library.mjs
COPY scripts/retain-backups.mjs ./scripts/retain-backups.mjs
COPY scripts/container-entrypoint.sh /usr/local/bin/container-entrypoint.sh
RUN chmod 0555 /usr/local/bin/container-entrypoint.sh \
    && chown -R node:node /app /opt/yt-dlp
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/container-entrypoint.sh"]
CMD ["node", "dist/src/main.js"]
