# Backend design interview

This is the historical design record. The current execution constraint in [current-constraints.md](current-constraints.md) supersedes its earlier Pi 5 testing workflow; no further Pi 5 access is authorized.

The later implementation approval adds a public, confirmation-gated YouTube importer. The importer is documented in [api.md](api.md) and [implementation-plan.md](implementation-plan.md); the earlier answers below describe the original manual-library scope and remain historical context.

## Established constraints

- Backend scope only; no frontend implementation.
- Fastify with TypeScript and SQLite.
- Existing audio files on an SSD connected to a Raspberry Pi 2 Model B.
- On-demand playback through the browser's built-in audio functionality.
- Docker deployment with documentation sufficient to reproduce it on another device.
- SQLite holds song metadata; the audio files remain on disk. The original users-table idea was deferred after deciding on public access without backend identity features.
- All coding work uses GPT 5.6 Luna with max thinking effort.

## Answers from round one

- Remote access must be public through a tunnel, with no VPN/client installation for listeners. The provider choice is delegated to the agent. The earlier private Tailscale Serve proposal was rejected; Tailscale Funnel is now the proposed deployment, subject to ten-listener testing.
- One shared library and one type of user. No likes, ownership, or personalized features. No login or application authentication. A username is stored only by the future frontend and conveys no identity or access rights; no backend user feature is requested for this version.
- Original scope: songs and SQLite metadata were maintained manually by an operator using documented procedures. The approved implementation now adds a public confirmation-gated YouTube import job API; automatic scanning remains out of scope.
- Accepted format: AAC-LC inside unencrypted .m4a, preserving compatible source bitrates/sample rates; raw ADTS .aac and ALAC-in-M4A are excluded.
- Target: ten concurrent listeners and 50–100 songs. This is a capacity target, not a hard request limit; acceptance measurements remain unresolved.
- SSH access is authorized at `emilianopolanco5@serverpi.local`.
- Deployment documentation must cover initial setup, subsequent releases, and reproduction on another device.
- Docker retained subject to the accepted measurement criteria below.

## Answers from round two

- Keep Docker if idle infrastructure overhead is below 100 MiB additional memory and the complete service handles ten listeners without sustained swapping or playback stalls. This is an acceptance target, not measured overhead. Build away from the Pi.
- Start with the present Pi and Node 22; plan migration to supported 64-bit hardware/runtime before 2027-04-30.
- Public internet access through a tunnel; no private-network requirement for listeners.
- No login or authentication. Frontend-only username; backend users have no current use case.
- Brief playback interruptions during releases are acceptable. Keep releases simple.
- Audio format was explored in round two and settled in round three below.

## Answers from round three

- Accept audio option 1: AAC-LC in .m4a, preserving compatible source bitrate/sample rate. No live transcoding or fixed-rate re-encoding requirement.
- Aim for broad current-browser compatibility. Raspberry Pi 5 running the default Raspberry Pi OS browser was an earlier client target; its acceptance check is deferred under the current execution constraint.
- Research confirms Chromium is Raspberry Pi OS's default browser unless the user selects Firefox. AAC support depends on the distribution's Chromium codec build, so Chromium's name alone does not prove support.
- Earlier read-only inspection recorded a Pi 5 Model B Rev 1.1, aarch64, Debian 13 trixie, installed Chromium 152.0.7977.82 (`1:152.0.7977.82-1~deb13u1+rpt2`), and FFmpeg. Browser playback remains unverified; the user has since stopped further access.
- Detailed research and release acceptance tests are in [browser-compatibility.md](browser-compatibility.md).
- The final plan must include the full technology/tool inventory; maintained in [stack.md](stack.md), distinguishing confirmed choices from proposed/unresolved tooling.

## Final interview answers

The user accepted all recommendations Q14–Q17:

- Public read endpoints: list songs, retrieve one song's metadata, and stream that song's audio. Metadata: ID, title, artist, optional album, duration, relative audio-file path. No playlists, artwork, search, or public writes initially.
- Brief maintenance interruptions are acceptable for additions, replacements, and removals. Replace a recording with a new ID/file path. Missing song or audio file returns 404.
- Build versioned ARMv7 images on the development machine and transfer over SSH; use Docker Compose, without a registry initially. Retain the previous image for rollback.
- Take a consistent SQLite backup before releases and manual library changes, copy it to the development machine, and retain the latest five. Original audio must be kept separately from the service SSD. Initial backups use documented commands rather than a scheduler.
- The consolidated implementation plan is in [implementation-plan.md](implementation-plan.md); it was approved before implementation. Backend implementation and the initial Pi 2 deployment are complete; public Funnel, content, and capacity acceptance remain pending.

### Public tunnel proposal

Use [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel), distinct from private Serve, to publish HTTPS to ordinary browsers without listener-side Tailscale. Funnel has non-configurable bandwidth limits, so ten-listener performance must be tested over the actual public Funnel path from outside the tailnet. Passing local-network tests is insufficient. Do not promise its throughput before testing.

### Audio options under discussion

All three use AAC compression, no live conversion, manual database metadata, and byte-range file delivery. Database metadata does not determine a file's actual codec/container or make an incompatible file playable.

1. AAC-LC in .m4a, preserving existing bitrates/sample rates: simplest single-container API; validate files before manual publication, remux compatible AAC where appropriate, and convert only incompatible inputs outside the Pi. Listeners get ordinary playback and seeking where AAC is supported; bandwidth/quality vary by source.
2. Normalize every file outside the Pi to one preset, e.g. AAC-LC in .m4a, 192 kbit/s target, stereo, 48 kHz: same API as option 1, with more predictable bandwidth (about 1.92 Mbit/s payload for ten listeners). Encoding lossy sources again can reduce quality, adds preparation work, and cannot recover missing quality. No runtime conversion on the Pi.
3. AAC-LC in either .m4a or ADTS .aac, preserving existing files: minimal preparation when the library is mixed, but two media types/container cases and less predictable browser compatibility and seeking for ADTS. This gives up some of the requested consistency.

Recommend option 1 for minimum backend scope; option 2 if a uniform preparation preset is worth the extra operator work. Browser/OS support must still be verified for the supported client set. See [MDN containers](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers) and [audio codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs).

## Platform evidence

Read-only SSH inspection on 2026-10-18 confirmed:

- Raspberry Pi 2 Model B Rev 1.1; `armv7l`; 32-bit userspace.
- Raspbian GNU/Linux 13 (trixie), kernel `6.18.50+rpt-rpi-v7`.
- Approximately 920 MiB RAM total, 654 MiB available at first inspection; zero swap used then. These are point-in-time observations, not capacity guarantees.
- SSD: approximately 916 GiB usable ext4 partition mounted at `/srv/keystack-data`, with `noatime`. Its fstab entry uses UUID and `nofail`.
- Docker, containerd, Tailscale, and cloudflared services inactive; relevant commands and Node not found on PATH. Package metadata reports Docker/containerd/Node uninstalled.
- A desktop session is running; the panel alone showed approximately 94 MiB RSS. No desktop changes were made.
- No remote configuration, installation, deployment, or benchmarks performed.

### Compatibility constraints

- [Official Node Docker architecture matrix](https://github.com/nodejs/docker-node/blob/main/versions.json): Node 22 Bookworm/slim includes ARMv7; Node 24/26 images currently do not. A container does not emulate a newer CPU.
- [Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json): Node 22 support ends 2027-04-30. Retaining the present hardware requires an explicit runtime support strategy beyond that date.
- [Docker Raspberry Pi OS installation documentation](https://docs.docker.com/engine/install/raspberry-pi-os/): v28 is the last major Raspberry Pi OS armhf package release; Docker documents Debian armhf as an ARMv7 migration route. Verify the chosen installation route on this Raspbian system before deployment.
- [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel): public HTTPS access for ordinary browsers. Funnel has non-configurable bandwidth limits; test the public path against the target load.

### Docker assessment pending measurements

Linux containers share the host kernel; they do not require a separate guest OS. Docker/containerd and container networking still consume resources. Image size is disk usage and must not be treated as resident RAM usage. No numerical overhead claim has been measured on this Pi.

Accepted direction: one API container; build TypeScript and the ARMv7 image away from the Pi; bind-mount audio read-only and keep persistent SQLite data on the SSD. Run Tailscale as a host service. Compare idle memory and CPU with and without the container engine, then run ten-client public streaming tests before accepting the deployment.

At 256 kbit/s per song, ten listeners require 2.56 Mbit/s of audio payload; at 320 kbit/s, 3.2 Mbit/s, before protocol/tunnel overhead and browser buffering bursts. Remote performance also depends on home upload capacity and direct versus relayed Tailscale connectivity.

## Decision tree

- Access boundary: local network, private remote access, or public internet.
  - Authentication, transport security, browser credential handling, deployment topology.
- User and library ownership: shared collection or separate access per user.
  - Provisioning, permissions, account lifecycle, data model.
- Library maintenance: copying files and importing, API uploads, or automatic scanning.
  - Metadata authority, file identity, replacements, missing files, import failures.
- Playback compatibility: required browsers and existing audio formats.
  - Direct playback policy, conversion outside the Pi, unsupported files, seeking.
- Capacity: library size and simultaneous listeners.
  - Resource limits, pagination, performance acceptance criteria.
- Platform compatibility investigation.
  - Supported OS/runtime/image combination, build strategy, SQLite integration.

Later rounds will cover dependent decisions, API contracts, persistence, recovery, and operational acceptance criteria. Implementation starts after the shared design is confirmed.
