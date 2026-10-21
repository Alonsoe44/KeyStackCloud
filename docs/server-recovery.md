# Fresh server setup and recovery

This is the starting point for recreating the SongStreamer backend from this
repository or replacing its Pi server. It consolidates [host setup](host-setup.md),
[release operations](operations.md), and [deployment evidence](deployment-results.md).
Reviewed against the repository on 2026-10-21; no live host inspection or recovery
exercise was performed for this guide.

The application is reproducible from Git. The existing library, host identity,
and public endpoint require separately preserved data and manual configuration.
Cloning the repository alone starts an empty library, not a copy of production.
This repository does not contain the separate KeyStack kiosk frontend, MIDI
configuration, or client Pi deployment. Recover those from their own project.

## What is preserved and what can be lost

| Item | In Git? | Recovery source or action |
| --- | --- | --- |
| Backend, SQL migrations, tests and dependency lockfile | Yes | Clone the desired commit |
| Dockerfile, Compose defaults, example environment | Yes | Build an image; review production overrides |
| Host prerequisite installation and directory permissions | Yes | Run `tools/bootstrap-pi.sh` after provisioning the host and SSD |
| Actual music files, including imported recordings | No | Back up the entire `audio/` tree separately |
| Catalogue, recording hashes, saved lyrics and import jobs | No | Restore a consistent SQLite backup |
| Production `/opt/songstreamer/.env` and local Compose changes | No | Save private configuration copies outside Git |
| OS image, active boot configuration and persistent SSD mount | Not fully | Record and provision them separately |
| SSH access and Tailscale authentication/policy | No | Preserve administrative access; authorize the replacement host |
| Built release images and rollback artifacts | No | Preserve image archives or rebuild from the recorded commit |

The `.gitignore` excludes `.env`, SQLite files, `.m4a` files and
`.local-backups/`. Uploading the code to GitHub does not upload these assets.
If the old server and all separate backups disappear, the current library and
saved lyrics cannot be recovered from this repository. One curated metadata
record in `library/` is not a database or audio backup. Re-downloading a source
video is not guaranteed to reproduce the same recording bytes or hash.

## Recorded production configuration

| Component | Configuration |
| --- | --- |
| Host | Raspberry Pi 2 Model B Rev 1.1; ARMv7 / `armhf`; Raspbian 13 trixie |
| Administration | Recorded SSH account: `emilianopolanco5@serverpi.local` |
| Storage | ext4 SSD mounted exactly at `/srv/keystack-data` |
| Release configuration | `/opt/songstreamer/compose.yaml` and `.env` |
| Persistent data | `/srv/keystack-data/songstreamer/data/songstreamer.sqlite` |
| Persistent recordings | `/srv/keystack-data/songstreamer/audio/`, including `imports/` |
| Backups / retained releases | `songstreamer/backups/` and `songstreamer/releases/` on the SSD |
| Runtime identity | Numeric UID/GID `1000:1000` by default; must match storage ownership |
| API | One Docker container; Node 22.23.2, Fastify, built-in SQLite, yt-dlp and FFmpeg tooling |
| Network | Host loopback `127.0.0.1:3000`; host Tailscale Funnel supplies public HTTPS |
| Recorded public URL | `https://serverpi.taild695c4.ts.net`; verify before relying on it |
| Latest recorded deployment | `songstreamer:0.3.0`, 2026-10-19; see deployment results for image IDs and checksums |

Current Compose mounts both data and audio writable for database writes and
imports. Its root filesystem is read-only, Linux capabilities are dropped, and
it uses a PID limit and `restart: unless-stopped`. Startup requires
`data/.songstreamer-ssd`. This marker is a startup guard, not a replacement for
checking the actual host mount.

The configured 256 MiB memory cap was **not enforced** on the recorded Pi:
the running kernel disabled the memory cgroup. The active boot source was
unresolved, and `/boot/firmware/cmdline.txt` did not match the running command
line. Do not copy or edit a guessed boot file. Identify the actual boot source,
plan any required reboot, and verify Docker memory-controller support on the
new host. Recreating this host defect is not required for application operation.

## 1. Preserve the existing installation

Do this before replacing a working server. Keep a copy outside the Pi and its
SSD, and record the capture date, source commit, image ID, configuration and
checksums together.

1. Stop the API with `sudo docker compose stop api` from `/opt/songstreamer`.
   Keep it stopped through the database and audio capture so imports and lyric
   edits cannot make the copies disagree.
2. Run the temporary-container `scripts/library.mjs backup /backups` command in
   [operations](operations.md#back-up-and-restore-sqlite). It uses `VACUUM INTO`
   to produce a standalone consistent database; do not substitute a live copy
   of the database file and omit its WAL.
3. Copy the resulting database backup **and the entire `audio/` directory** to
   separate storage. Preserve nested paths and original bytes; do not rename
   recordings or re-encode them. Copying only SQLite preserves metadata but
   leaves every recording unavailable. Staging files are not resumable jobs.
4. Save `/opt/songstreamer/compose.yaml`, `.env`, the deployed source commit,
   image ID/tag and, when available, the image archive. Keep configuration and
   administrative credentials in private storage outside Git.
5. Record `findmnt -T /srv/keystack-data`, the relevant `/etc/fstab` entry and
   SSD UUID, numeric ownership, OS/architecture, active boot source, and
   Tailscale/Funnel status. Do not put authentication tokens in the inventory.
6. Verify copied checksums and run `sqlite3 BACKUP_FILE 'PRAGMA integrity_check;'`
   against the copied backup; expect `ok`. Confirm the audio copy contains the
   files referenced by the catalogue. Restart the original API after capture.

The packaged backup command retains only five matching Pi-side database
backups. Copy the chosen recovery set elsewhere before further maintenance.
The documented process is manual; this repo does not configure scheduled
off-host database or audio backups. A backup becomes recovery evidence only
after a restore has been tested.

## 2. Provision the replacement host and SSD

For the existing bootstrap, install Raspbian 13 trixie with an ARMv7 `armhf`
userspace. Set up a normal operator account, SSH access and hostname. Confirm
architecture and OS before running the script. A Pi with a 64-bit OS or an x86
server needs reviewed bootstrap checks and image/Compose platform changes;
the current setup is explicitly ARMv7.

Provision storage before bootstrapping. If reusing the original SSD, preserve
its filesystem and contents. For a new SSD, create an ext4 filesystem through
the host's storage administration procedure, obtain its actual UUID, and set
up a persistent mount at `/srv/keystack-data`. Formatting is destructive and
device names vary, so this guide intentionally provides no generic format
command to run against an unidentified disk.

Review `/etc/fstab` and verify the mount with:

```sh
findmnt -T /srv/keystack-data -o TARGET,FSTYPE,SOURCE,OPTIONS
```

Require the exact target `/srv/keystack-data` and type `ext4`, including after
a reboot. A `nofail` mount can let the OS boot without the SSD; it does not
prove the application storage is available.

Follow [host setup](host-setup.md) to copy and run `tools/bootstrap-pi.sh`
interactively. It installs Docker, Compose, SQLite and Tailscale, enables
Docker/tailscaled, creates dedicated directories, reconciles ownership and
creates the SSD marker. It does not provision the disk mount, deploy the
application or authenticate Tailscale. Match any non-default UID/GID in both
bootstrap and the deployment `.env`.

## 3. Build and install the release

Clone `git@github.com:Alonsoe44/KeyStackCloud.git` on the build machine and
select the desired recorded commit. Run `npm ci` and `npm test` with the
documented Node 22 runtime. Follow
[build and transfer](operations.md#build-and-transfer-a-release) to build
`linux/arm/v7` with Buildx, export the versioned image, transfer it over SSH
and load it on the replacement host. Alternatively load a preserved, verified
release archive matching the recovery set.

Install the reviewed Compose file and `.env` under `/opt/songstreamer`. Set
`SONGSTREAMER_IMAGE` explicitly: `.env.example` defaults to `songstreamer:dev`,
and older command examples use `0.1.0`; neither selects the latest release
automatically. Check paths, UID/GID, CORS and the loopback-only port using
`sudo docker compose config`. Keep the service stopped until restoring data.

The Node base image digest, npm lockfile and downloader versions improve
repeatability. Host apt packages, runtime apt packages and external package
availability are not a complete immutable OS snapshot. Keep the exported
image when exact runtime recovery matters.

## 4. Restore the library, or start empty

For recovery, follow the stopped-service SQLite restore procedure in
[operations](operations.md#back-up-and-restore-sqlite), using the matching
backup and release. Preserve any pre-existing database before replacing it;
remove stale WAL/SHM sidecars only while the service is stopped as documented.
Restore recordings into the new `audio/` root with their original relative
paths. Restore owner/group and permissions for the configured runtime user,
and ensure `data/.songstreamer-ssd` exists on the mounted SSD.

Run the packaged library `check` command from the operations guide before
accepting the restore. It checks referenced file paths and non-empty files;
it does not prove byte-for-byte recording integrity. Also compare restored
audio checksums with the captured originals. Preserve recording hashes so
saved lyrics remain associated with the same audio.

For a deliberately empty installation, omit restoring database/audio and
start the service: startup creates the database and applies migrations.
For either path, use `sudo docker compose up -d --remove-orphans` after the
configuration and storage checks. Unfinished import jobs from a restored
database are marked failed on startup and must be retried; they do not resume.

## 5. Restore public access and verify

First verify locally: `/health`, `/import/health`, `/songs`, and a real song's
full/HEAD/range responses. A successful database health check alone does not
prove recordings are present or playable. Use the exact checks in
[verify a release](operations.md#verify-a-release).

Authenticate the replacement host using `sudo tailscale up`, complete the
account/policy approval, then configure host Funnel as described in
[host setup](host-setup.md#authenticate-tailscale-and-enable-funnel):

```sh
sudo tailscale funnel --bg http://127.0.0.1:3000
sudo tailscale funnel status
```

A replacement host is a new identity unless explicitly recovered through the
Tailscale administration process. Do not assume it receives the old public
hostname. Test the actual HTTPS URL from outside the tailnet and update the
separate frontend's backend URL if needed. Test listing, playback, seeking,
saved lyrics and import dependency health through that URL. Verify the restored
library before submitting new imports, which create production data.

Before declaring recovery complete, verify reboot persistence, actual SSD
mounting, missing-SSD startup protection, backup restore, Docker resource-limit
support, and the documented ten-client load test. Schedule disruptive checks
in a maintenance window or on a recovery host. Production restore, reboot,
missing-SSD and sustained public throughput checks remain unverified in the
existing deployment record. Do not use the client Pi for development or tests;
see [current constraints](current-constraints.md).

## Evidence and documentation maintenance

The latest release section of [deployment results](deployment-results.md)
records successful public health, search and audio-range checks for `0.3.0`.
Earlier sections describe historical read-only audio mounts and pending
Funnel setup. Current `compose.yaml` and `Dockerfile` define the intended
runtime; release-specific evidence describes what was observed at deployment,
not necessarily the live host today. Some older stack/deployment summaries
still describe the pre-import installation.

After a recovery, record the source commit, image/configuration checksums,
backup date, new host/endpoint, and actual acceptance results. Preserve an
off-host recovery set containing database, audio and private configuration.
Keep the former server intact until the replacement passes verification;
avoid operating both writable copies as independent production libraries.
