# SongStreamer

SongStreamer is a small, public music library API and native AAC-LC YouTube importer for a Raspberry Pi 2 Model B. It stores verified recordings in `.m4a` files and exposes metadata plus native HTTP audio playback. The service has no accounts, deduplication, or artwork API, and never transcodes audio.

The application targets Node.js 22.19 or later in the Node 22 line, Fastify 5.12.7, and Node's built-in `node:sqlite`. The 22.19 development minimum is required by the pinned OpenAPI validation toolchain; the production image is pinned to the Node 22.23.2 Bookworm slim image and built for `linux/arm/v7`. The ARMv7 image is built on another machine and transferred to the Pi; the Pi does not compile the application.

## Local development

Install the locked dependencies, build the TypeScript, and run the tests:

```sh
npm ci
npm test
```

The test suite exercises migrations, metadata responses, exact-recording lyric saves and validation, CORS preflight, safe audio paths, full and ranged responses, HEAD, conditional requests, and missing files. The local development runtime needs Node 22.19 or later because the OpenAPI validator and `node:sqlite` are used by the application and test suite. Node 24 also runs the suite, but emits Node's experimental SQLite warning.

Run the server against a prepared data directory:

```sh
npm run build
mkdir -p .local-data .local-audio
HOST=127.0.0.1 PORT=3000 \
  DATA_ROOT="$PWD/.local-data" \
  AUDIO_ROOT="$PWD/.local-audio" \
  DB_PATH="$PWD/.local-data/songstreamer.sqlite" \
  REQUIRE_SSD_MARKER=false \
  node dist/src/main.js
```

The server creates the SQLite parent directory and applies SQL files from `migrations/` in numeric order. The initial schema is in [migrations/001_initial.sql](migrations/001_initial.sql).

## API

The complete route, status, schema, example, alias, and header contract is in [docs/api.md](docs/api.md) and the machine-readable OpenAPI document at `/docs/openapi.json`.

Run the server locally, then open [http://127.0.0.1:3000/docs/](http://127.0.0.1:3000/docs/) for the interactive Scalar API reference. `/docs` redirects to `/docs/`; the pinned `@scalar/fastify-api-reference` bundle is served from `/docs/js/scalar.js`, with no CDN, Scalar account, paid service, request proxy, agent, or telemetry required. The documentation is public like the API itself and declares no authentication scheme.

The public metadata routes never return the stored filesystem path. Audio is served as `audio/mp4` with byte ranges, `ETag`, `Last-Modified`, and `Accept-Ranges: bytes`.

The import and timed-lyrics flows are public by design. `POST /import/inspect` only inspects one canonical YouTube video and returns editable metadata plus native AAC-LC format choices. `POST /import/jobs` starts a queued job only after the caller submits confirmed title, artist, optional album, and the selected compatible format. Poll `GET /import/jobs/:id`; retry a failed job with `POST /import/jobs/:id/retry`. The same routes are available under `/api/v1/import/`. `GET /import/health` reports whether yt-dlp, ffmpeg, and ffprobe are available. Complete karaoke documents are read and replaced at `GET`/`PUT /api/v1/songs/:id/lyrics`; each document is schema-versioned and tied to the exact `audio_sha256` recording hash, and SQLite replacement is atomic. See [docs/api.md](docs/api.md) for validation and error details.

The framework-agnostic browser GUI contract, native audio state model, responsive layout guidance, and acceptance checklist are in [docs/frontend-integration.md](docs/frontend-integration.md).

## Production layout

Start with the [fresh server setup and recovery guide](docs/server-recovery.md)
to recreate this backend, preserve the database and audio library, and identify
the OS, storage and public-access configuration that Git does not contain.

The host setup uses the existing ext4 SSD mount and creates:

```text
/srv/keystack-data/songstreamer/audio/       # AAC-LC M4A files
/srv/keystack-data/songstreamer/data/        # SQLite database and SSD marker
/srv/keystack-data/songstreamer/backups/     # temporary Pi-side backup copies
/opt/songstreamer/                            # compose file and release metadata
```

The API container mounts `audio/` as a writable SSD volume for the importer and `data/` as the database volume. Imports stage under `audio/.import-staging`, verify the native AAC-LC stream, then atomically rename into `audio/imports/` before inserting the SQLite row. The service runs as the configured unprivileged numeric UID/GID (1000:1000 by default), binds its host port to loopback, drops Linux capabilities, uses a read-only container filesystem apart from the two data mounts, and requires `/data/.songstreamer-ssd` before startup. The backups directory is intentionally not mounted into the long-running API; maintenance commands add it as a temporary bind mount.

Run the reviewed host preparation script interactively on the Pi as the normal operator account:

```sh
bash tools/bootstrap-pi.sh
```

It uses `sudo` for package and filesystem operations and leaves the password prompt in the terminal. It verifies the ARMv7 Raspbian 13 host and the ext4 SSD before changing anything. It installs Docker, Compose, SQLite, and the signed Tailscale repository, but it does not copy a release, authenticate Tailscale, or start the application.

Pass `--grant-docker-access` only when the operator wants the script to add the account to Docker's root-equivalent group; otherwise keep using `sudo docker`.

The release and maintenance commands are in [docs/operations.md](docs/operations.md). The host bootstrap script is deliberately separate from application code so it can be reviewed and run once with the user's interactive privileges.

## Build an ARMv7 image

The Dockerfile pins the immutable Node image index digest and selects the target platform at each `FROM`. With a working Buildx builder:

```sh
VERSION=0.1.0
docker buildx build \
  --platform linux/arm/v7 \
  --tag "songstreamer:$VERSION" \
  --load .
docker run --rm --entrypoint node "songstreamer:$VERSION" --version
```

The old Docker Desktop builder on the development machine may need an updated Buildx/BuildKit if it rejects OCI image indexes. Record the exact builder output before treating a release as ready. A successful local image build is not a Pi deployment; follow the SSH transfer and acceptance checks in [docs/operations.md](docs/operations.md).

## Audio preparation

The accepted profile is one unencrypted AAC-LC audio stream in an MP4/M4A container. Validate a source on the preparation machine before transfer:

```sh
scripts/validate-audio.sh recording.m4a
```

Keep the source bitrate and sample rate when the file already meets the profile. Prepare fast-start MP4 metadata outside the Pi when needed; do not transcode during HTTP requests. Browser compatibility evidence and the deferred, historical Pi 5 check are recorded in [docs/browser-compatibility.md](docs/browser-compatibility.md). Current execution constraints prohibit any further Pi 5 access or browser testing; local backend verification runs on the MacBook.

The first curated record, including measured duration, source hash, and the exact Pi publication command, is in [docs/library.md](docs/library.md). Its fixed metadata is [library/all-i-do.json](library/all-i-do.json).

## Status and limits

This repository contains the runnable backend and release tooling. Pi 2 host installation and local MacBook browser playback are verified; public Funnel setup, Pi 2 playback, ten-listener capacity, and memory-limit repair remain deployment acceptance checks. Pi 5 playback is deferred under the current user constraint and is not part of local backend testing. Current evidence is recorded in [docs/deployment-results.md](docs/deployment-results.md) and [docs/pi5-test-results.md](docs/pi5-test-results.md).
