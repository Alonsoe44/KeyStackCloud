# Deployment verification results

Status: backend, local ARMv7 image verification, clean Pi 2 deployment, first
curated song publication, and public Funnel health/inspection checks complete;
resource-limit and throughput acceptance remain pending.

The 2026-10-18 sections below record the earlier `0.1.0` installation and its
historical pre-public-Funnel checks. The current `0.2.0` release is recorded in
the final section.

## Local build host

2026-10-18: ARM64 macOS development machine. Docker Desktop 4.10.1 was started; Docker Engine/CLI 20.10.17, Buildx 0.8.2, Compose 2.6.1. Builder reports linux/arm/v7 support. Docker requires access outside the execution sandbox. Node 24.13.1 and npm are installed locally; the production/test target remains pinned Node 22.

## Pi 2 pre-install baseline

Read-only SSH observation at 2026-10-18 14:21:11 UTC (16:21:11 Europe/Madrid):

- Docker, containerd, and Tailscale inactive/uninstalled.
- MemTotal: 942120 KiB; MemAvailable: approximately 666340–666540 KiB during the sample.
- free reports 275780 KiB used, 132264 KiB free, 609084 KiB buffers/cache.
- Swap used: 0 KiB.
- Load averages: 0.00, 0.00, 0.00.
- Desktop session remains running; no host applications were stopped to improve the numbers.

This single pre-install snapshot is contextual evidence only. The agreed less-than-100-MiB engine overhead check still needs comparable engine-stopped/started measurements after installation, with the API and tunnel excluded from the engine-only comparison.

## Local release verification

On 2026-10-18, the pinned image built and loaded successfully with `docker buildx build --platform linux/arm/v7 --load .` using the local Docker Desktop Engine 20.10.17, Buildx 0.8.2, and Compose 2.6.1. The emulated image reports `v22.23.2`; the packaged `scripts/library.mjs` parses under that runtime. `docker compose config` accepts the loopback-only service with separate SSD data and read-only audio mounts.

The application tests pass on the development machine: nine Node test-runner tests cover migrations, metadata, safe paths, full/HEAD/ranged audio, conditional requests, malformed/unsatisfiable ranges, empty/missing files, idempotent startup, and backup/restore. One loopback cancellation test is available with `SONGSTREAMER_NETWORK_TEST=1`; it passed locally. The same compiled suite passed inside the pinned Node 22 ARMv7 image (8 pass, 1 intentionally skipped network test). A temporary local loopback run also exercised three repeated range clients for one second; all clients received bytes and the load script reported no failures. This is a tooling smoke test, not Pi capacity or public Funnel evidence.

A temporary ARMv7 container smoke test verified `/health`, a `206` response with `Content-Range`, the packaged library `add` command, the read-only `/audio` bind mount, and refusal to start when the SSD marker is absent. The container was removed and all temporary mounts were deleted. No Pi host was used for these checks.

Local MacBook Chrome 154 native-audio checks also passed with AAC-LC M4A fixtures at 44.1 kHz/128 kbit/s and 48 kHz/192 kbit/s against the Mac-hosted API: metadata, advancing playback time, pause/resume, forward/backward/near-end seeking, ended events, HTTP 206 range probes, and nonzero decoded Web Audio samples. This establishes decoding/playback behavior in that browser, not physical speaker audibility or passes for other browsers. See [local browser results](local-browser-results.md).

## Pi 2 deployment verification

On 2026-10-18, the verified release was installed on the clean Pi 2 target over SSH after the user completed the interactive host setup. The host reports `armv7l`, Docker Engine `26.1.5+dfsg1`, and Docker Compose `2.26.1-4`. Tailscale is online on the host; Funnel was not started during this deployment. The release remains bound to `127.0.0.1:3000` until the public-path acceptance step.

The container is running healthy as `songstreamer-api-1` from `songstreamer:0.1.0`, with image ID `sha256:12809ca2887f89236de7d3cb20c12ae38392997ef17558203a3a164406d37962`. Inside the container, Node reports `v22.23.2`, `process.arch` is `arm`, and `uname -m` is `armv7l`. The application returned `{"status":"ok"}` from `/health` and `{"songs":[]}` from `/songs`. Startup logs contain the expected Node `node:sqlite` experimental warning and Fastify listening messages; no application errors were observed.

The host mounts `/srv/keystack-data/songstreamer/data` at `/data` read-write and `/srv/keystack-data/songstreamer/audio` at `/audio` read-only. The container runs as `1000:1000`, has a read-only root filesystem, `pids_limit=128`, all Linux capabilities dropped, and `no-new-privileges`. The SSD marker and the newly migrated `songstreamer.sqlite` are present in the data directory. No synthetic songs were added.

The requested Compose `mem_limit: 256m` is not enforced on this host. Docker reports `WARNING: No memory limit support` and `WARNING: No swap limit support`; the container inspection has `HostConfig.Memory=0`, and `docker stats` reports `0B / 0B`. `/sys/fs/cgroup/cgroup.controllers` contains `cpuset cpu io pids` but no `memory`, while the running `/proc/cmdline` includes `cgroup_disable=memory`. `/boot/firmware/cmdline.txt` has a different root `PARTUUID` and does not contain that token, so the active boot source must be identified before changing anything. No boot file was edited and no reboot was performed. A privileged maintenance follow-up must restore the memory controller in the active boot configuration, reboot, and verify Docker's memory warnings disappear before treating the 256 MiB limit as a resource gate.

The deployment snapshot showed 942120 KiB total RAM, 621220 KiB available, and 134980 KiB swap used while the desktop and host services remained active. This is a contextual snapshot, not a sustained audio-capacity measurement. The initial empty-library state preceded the curated song publication recorded below; ten-client streaming, backup/restore, reboot persistence, and public Funnel throughput remain untested on the production host.

## First curated song deployment

On 2026-10-18, the user-provided `All I Do [-bnx_Qwy7w4].m4a` was validated locally with the cached FFmpeg 6 image and published through the approved manual maintenance workflow. The measured source is 4,961,487 bytes with SHA-256 `6b26fe8c6a550f522a5d5f7b65bf5680b43144b4f95a46d88c34b9cbcd3743ca`, duration `306.676009` seconds, stereo 44.1 kHz AAC-LC, `mp4a`, profile `1`, and 128,009 bit/s. Its top-level `moov` box already precedes `mdat`, so no remux or re-encode was performed.

The pre-change database backup `songstreamer-2026-10-18T151359645Z.sqlite` was created before the API was stopped and copied to `.local-backups/`; its local SHA-256 is `1ae3eb7ddab9a309df3706eb9aa14117c9f47f0852ccd17697d6a247869e79f2`. The complete file was checksum-verified after transfer and atomically published at `/srv/keystack-data/songstreamer/audio/all-i-do-stevie-wonder.m4a`. The packaged maintenance tool inserted `all-i-do-stevie-wonder`, and `check` passed.

After restart, Pi2 loopback checks returned the expected metadata, a full `200` response with `Content-Length: 4961487`, `HEAD 200` with the full resource length, and `Range: bytes=0-127` as `206` with `Content-Range: bytes 0-127/4961487`. A full HTTP download from the Pi matched the source SHA-256, and the 128-byte range matched the file prefix. The public Funnel hostname `serverpi.taild695c4.ts.net` returned DNS resolution error 6 from the MacBook at this check, so no public-path result is claimed yet.

## Release artifacts

The verified image was tagged `songstreamer:0.1.0` and exported on the MacBook. Image ID: `sha256:12809ca2887f89236de7d3cb20c12ae38392997ef17558203a3a164406d37962`.

The approximately 69 MiB compressed archive was staged on Pi 2 at `/tmp/songstreamer-0.1.0.tar.gz`; its SHA-256 matches the Mac copy: `2b1256ca7842033169974aa565caf425f05017f8ed8cbc76d364f7cefa5b1c72`. It was loaded successfully and started as `songstreamer:0.1.0`. Compose remains installed at `/opt/songstreamer/compose.yaml` with `/opt/songstreamer/.env` selecting that tag. The reviewed interactive setup script remains available as `/tmp/songstreamer-bootstrap-pi.sh` for future host recovery.

SSH keys work, and the privileged host setup was run interactively by the user. Future privileged changes must still be run by the user directly on the Pi; no sudo password is stored in the project. Tailscale authentication and the tailnet Funnel approval are complete. Applying the local Funnel configuration as the SSH user was denied by tailscaled, which requires `sudo tailscale funnel --bg http://127.0.0.1:3000` (or an explicitly configured Tailscale operator). The user must run that privileged command in their terminal. No public endpoint has yet been configured or verified; the local API remains healthy.

## Pending acceptance

- Restore Docker's memory cgroup support after confirming the active boot source and scheduling the required reboot; do not claim the 256 MiB container cap until Docker verifies it.
- Verify backup restore, reboot persistence, and missing-SSD startup with the published library.
- Measure ten concurrent streams through the verified public Funnel path.
- Other supported browser versions/platforms beyond local Chrome and client-Pi acceptance remain user-owned.

## Release 0.2.0 deployment

On 2026-10-19 at approximately 18:08 Europe/Madrid, the current SongStreamer
source was released to the server Pi as the ARMv7 image
`songstreamer:0.2.0`, digest
`sha256:74cccc013227ab696ffd4228ba3cad2bf76f877abf1fca123fef7aeb441a245e`. The
release archive is stored at
`/srv/keystack-data/songstreamer/releases/0.2.0/songstreamer-0.2.0.tar.gz` and
has SHA-256
`4dedb76ee01176682b9c16fa37380439cb6642fbb3616ec8a1fbe61b555d5be7`. The
previous Compose and environment files remain as `compose.previous.yaml` and
`env.previous` in that release directory, and image `songstreamer:0.1.0` was
retained for rollback.

Before the migration, the SQLite database was backed up at
`/srv/keystack-data/songstreamer/backups/songstreamer-2026-10-19T160618831Z.sqlite`.
The same file is retained in `SongStreamer/.local-backups/` with SHA-256
`63f6e8bc3108962c3328f0dea230343b7830c9f943236d7c40354d4754835d16`. The new
Compose files and image are installed under `/opt/songstreamer`; the service
uses owned data directories and Docker group access without a stored sudo
credential.

The copied pre-migration backup passes SQLite `PRAGMA integrity_check` with
`ok` and contains the existing `All I Do` row.

The production container is healthy. The public API at
`https://serverpi.taild695c4.ts.net` returned success from `/health`, and
`/api/v1/import/health` reported yt-dlp, ffmpeg, and ffprobe ready. `GET /songs`
still contains the single existing `All I Do` entry. A public inspection of the
approved example URL returned HTTP 200 with `All I Do`, `Stevie Wonder`,
`Hotter Than July`, `hasCompatible: true`, and recommended native format 140;
it did not download or create a production song. The existing audio endpoint
returned `206 audio/mp4` for `Range: bytes=0-127` with
`Content-Range: bytes 0-127/4961487`.

The host still reports the pre-existing unsupported memory-cgroup warning, so
the Compose memory limit remains unverified. No boot configuration was changed.

The client Pi received the frontend export only: the current `apps/web/out`
was staged and swapped into `~/keystack/out`, preserving its MIDI and local
backend. The previous export is available at
`~/keystack/releases/import-20261019/out.previous` for rollback. The existing
`kiosk.sh` reload was run. Service active/running state was checked as a
deployment acknowledgement; no client UI, playback, hardware, or screenshot
acceptance was performed. The user explicitly authorized deployment-only SSH
access for this release and handles all client acceptance testing.
