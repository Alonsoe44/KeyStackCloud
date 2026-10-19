# Stack and tooling

This inventory records the selected stack, the tools used for local verification, and the remaining host acceptance work.

## Application and persistence

| Component | Choice | Status / purpose |
| --- | --- | --- |
| Language | TypeScript | Confirmed; compile before deployment |
| Runtime | Node.js 22.23.2 on ARMv7 | Production Docker image pinned to the Node 22.23.2 Bookworm slim index digest; migrate before 2027-04-30 |
| HTTP framework | Fastify 5.12.7 | Locked in package-lock.json; no Fastify plugins are required |
| Database | SQLite | Confirmed; metadata on SSD, outside container image |
| SQLite integration | Node built-in node:sqlite | Plan choice; Node >=22.13, no extra native addon or ORM; Node 22 API remains in active development |
| Audio | Unencrypted AAC-LC in .m4a | Confirmed; compatible source rates retained; no live conversion |
| Delivery | Native HTTP audio with byte ranges | Required for ordinary browser playback and seeking |
| Identity | No backend login/accounts | Confirmed; optional future frontend username has no authorization meaning |

## Hosting and operations

| Component | Choice | Status / purpose |
| --- | --- | --- |
| Initial server | Raspberry Pi 2 Model B Rev 1.1, ARMv7 | Inspected; Raspbian 13, about 920 MiB RAM |
| Persistent storage | SSD at /srv/keystack-data | Dedicated songstreamer/audio, songstreamer/data, songstreamer/backups directories and SSD marker are present on Pi 2 |
| Packaging | Docker Engine 26.1.5, one API container | Running on Pi 2; Docker memory and swap controllers are unavailable on the current kernel, so the requested memory cap is not enforced |
| Container definition | Dockerfile; Docker Compose 2.6-compatible service file | API runs with a read-only root, writable SSD data/audio mounts, restart behavior, PID limit, and capability hardening; memory limit awaits host cgroup repair |
| Image build | Docker Buildx | `docker buildx build --platform linux/arm/v7`; the verified local builder loaded the ARMv7 image |
| Public HTTPS | Tailscale Funnel | Tailscale is online on Pi 2; Funnel has not been started; verify real public-path throughput before acceptance |
| Remote administration | SSH with existing keys | Pi 2: emilianopolanco5@serverpi.local; no further Pi 5 access is authorized |
| Releases | Versioned images transferred over SSH, brief restart, rollback | Accepted; Docker image save/load, no registry initially |
| Recovery | Consistent SQLite backup before releases/manual changes | Backup tooling is packaged and the pre-publication backup is copied locally; production restore remains untested |

## Development, preparation, and verification

| Tool | Purpose | Status |
| --- | --- | --- |
| GPT 5.6 Luna, max thinking effort | All coding work | User requirement |
| Package manager and lockfile | npm and package-lock.json | Plan choice for reproducible dependencies |
| TypeScript compiler | Produce deployable JavaScript away from the Pi | Required by chosen language |
| yt-dlp / yt-dlp-ejs | Inspect a single YouTube video and select a native AAC-LC stream | Pinned in the runtime image; remote component fetches are disabled by default |
| FFmpeg / ffprobe | Stream-copy MP4/M4A packaging and measure the downloaded AAC-LC artifact | Pinned/runtime dependencies used by the import worker; no lossy transcoding |
| SQLite CLI | Document manual metadata updates and backups | Proposed operator tool |
| curl or equivalent HTTP checks | Verify headers, full responses, byte ranges, missing files | Used for the Pi 2 health and empty-library smoke checks; song range checks await operator audio |
| Node.js built-in test runner and a streaming load script | HTTP behavior and ten-client resource/streaming verification | Plan choice; no benchmark results yet |
| Browser playback | Native audio client acceptance | Local MacBook Chrome 154 passed generated 44.1/48 kHz AAC-LC fixtures; Pi 5 access/testing prohibited |
| Python 3 local harness | Temporary local API/library fixture orchestration | MacBook-only browser test; not a production dependency |
| macOS afinfo | Inspect generated audio fixture metadata | Local test utility; not a production dependency |
| Disposable FFmpeg container | Generate local test tones | jrottenberg/ffmpeg:6.0-ubuntu used by the local harness when native FFmpeg is absent; not shipped with the API |
| Chrome, Edge, Firefox, Safari; Android/iOS browsers | Broad compatibility targets | Actual browser/version matrix to record; no blanket pass claimed |

The locked package versions are Fastify 5.12.7, TypeScript 7.0.2, and `@types/node` 22.19.20. The Dockerfile pins `node:22.23.2-bookworm-slim` at index digest `sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9`; the ARMv7 child manifest observed during the build was `sha256:4badb5e9a3c5898bef4d9904645b5182e38a987d76a8ba8936a057413e8220c3`. The local ARM64 development machine's Docker Engine 20.10.17, Buildx 0.8.2, and Compose 2.6.1 successfully built and loaded the ARMv7 image under emulation. FFmpeg is an operator-side preparation dependency and is not part of the runtime image.

The production deployment on 2026-10-18 verified Docker Compose `2.26.1-4`, Node `v22.23.2`, `process.arch=arm`, and `uname -m=armv7l` on the Pi 2. The image ID is `sha256:12809ca2887f89236de7d3cb20c12ae38392997ef17558203a3a164406d37962`. Docker's host warnings report no memory-limit or swap-limit support because the running kernel has `cgroup_disable=memory` and exposes only `cpuset cpu io pids`; the 256 MiB Compose setting must remain untrusted until the active boot configuration is confirmed and corrected during a maintenance reboot.
