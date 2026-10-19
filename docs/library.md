# Curated library records

## All I Do — Stevie Wonder

The fixed metadata record is [library/all-i-do.json](../library/all-i-do.json). The user-provided source is `All I Do [-bnx_Qwy7w4].m4a` in the repository root. Local validation used the cached `jrottenberg/ffmpeg:6.0-ubuntu` image (`sha256:811209dad16ce9700da0f2c3d214b958d5323b9dcd6f0568130c2e58d2cb0693`), and FFmpeg decoded the complete stream successfully.

| Field | Value |
| --- | --- |
| Stable ID | `all-i-do-stevie-wonder` |
| Title | `All I Do` |
| Artist | `Stevie Wonder` |
| Album | `null` |
| Duration | `306.676009` seconds |
| Source size | `4,961,487` bytes |
| Source SHA-256 | `6b26fe8c6a550f522a5d5f7b65bf5680b43144b4f95a46d88c34b9cbcd3743ca` |
| Container | MP4/M4A (`mov,mp4,m4a,3gp,3g2,mj2`) |
| Audio | AAC-LC, FFmpeg profile `1`, `mp4a`, stereo, 44,100 Hz, 128,009 bit/s |
| Fast start | Yes; the top-level `moov` box precedes `mdat` |
| Published filename | `all-i-do-stevie-wonder.m4a` |
| Pi audio path | `/srv/keystack-data/songstreamer/audio/all-i-do-stevie-wonder.m4a` |
| Pi database path | `/srv/keystack-data/songstreamer/data/songstreamer.sqlite` |
| Metadata API | `/songs/all-i-do-stevie-wonder` |
| Audio API | `/songs/all-i-do-stevie-wonder/audio` |

The source already has the MP4 `moov` box before `mdat`, so no remux or re-encode is needed. The API serves it as `audio/mp4`; it does not inspect or transcode audio during requests.

## Repeatable publication command

Run the backup before copying or inserting metadata. The Pi-side backup command opens the existing database directly and does not apply migrations. Copy the resulting file to the ignored local `.local-backups/` directory, then retain the newest five backups as described in [operations.md](operations.md#back-up-and-restore-sqlite).

From the MacBook, transfer the source to a temporary Pi path:

```sh
scp 'All I Do [-bnx_Qwy7w4].m4a' \
  emilianopolanco5@serverpi.local:/tmp/all-i-do-stevie-wonder.m4a
```

In the Pi shell, stop the API, create the consistent backup, publish the complete file atomically within the SSD audio directory, and insert the fixed record:

```sh
set -eu
cd /opt/songstreamer
trap 'docker compose up -d >/dev/null' EXIT
docker compose stop api
docker compose run --rm --no-deps -T \
  -v /srv/keystack-data/songstreamer/backups:/backups \
  api node scripts/library.mjs backup /backups

test ! -e /srv/keystack-data/songstreamer/audio/all-i-do-stevie-wonder.m4a
install -m 0644 /tmp/all-i-do-stevie-wonder.m4a \
  /srv/keystack-data/songstreamer/audio/.incoming-all-i-do-stevie-wonder.m4a
sha256sum /srv/keystack-data/songstreamer/audio/.incoming-all-i-do-stevie-wonder.m4a
mv /srv/keystack-data/songstreamer/audio/.incoming-all-i-do-stevie-wonder.m4a \
  /srv/keystack-data/songstreamer/audio/all-i-do-stevie-wonder.m4a

docker compose run --rm --no-deps api node scripts/library.mjs add \
  --id all-i-do-stevie-wonder \
  --title 'All I Do' \
  --artist 'Stevie Wonder' \
  --duration 306.676009 \
  --file all-i-do-stevie-wonder.m4a
docker compose run --rm --no-deps api node scripts/library.mjs check
docker compose up -d
trap - EXIT
docker compose ps
```

Copy the backup reported in `/srv/keystack-data/songstreamer/backups/` back to the MacBook before deleting old Pi-side backups:

```sh
mkdir -p .local-backups
scp 'emilianopolanco5@serverpi.local:/srv/keystack-data/songstreamer/backups/songstreamer-*.sqlite' .local-backups/
node scripts/retain-backups.mjs .local-backups --keep 5
```

If the ID or published filename already exists, stop and inspect the existing metadata and SHA-256 rather than overwriting it. The command above intentionally fails on a duplicate row or existing final file.
