# Release and library operations

These commands assume the reviewed host bootstrap has created `/opt/songstreamer` and the SSD directories. Replace `VERSION` with the release tag being operated. Commands that run on the Pi use `sudo` so they work even before the operator's Docker group membership is changed.

## Build and transfer a release

Build on the development machine, where Buildx can target ARMv7:

```sh
VERSION=0.1.0
docker buildx build --platform linux/arm/v7 --tag "songstreamer:$VERSION" --load .
docker image inspect "songstreamer:$VERSION" --format '{{.Id}}'
docker save "songstreamer:$VERSION" | gzip > "/tmp/songstreamer-$VERSION.tar.gz"
scp "/tmp/songstreamer-$VERSION.tar.gz" emilianopolanco5@serverpi.local:/tmp/
scp compose.yaml emilianopolanco5@serverpi.local:/tmp/songstreamer-compose.yaml
```

For a first deployment with no existing database, enter the Pi and run:

```sh
ssh emilianopolanco5@serverpi.local
```

```sh
sudo sh -c 'gzip -dc /tmp/songstreamer-0.1.0.tar.gz | docker load'
sudo install -o "$USER" -g "$(id -gn)" -m 0640 /tmp/songstreamer-compose.yaml /opt/songstreamer/compose.yaml
printf 'SONGSTREAMER_IMAGE=songstreamer:0.1.0\n' | sudo tee /opt/songstreamer/.env >/dev/null
cd /opt/songstreamer
sudo docker compose config
sudo docker compose up -d --remove-orphans
sudo docker compose ps
```

For an existing installation, load the new image first, then take the backup before changing `.env` or `compose.yaml`:

```sh
ssh emilianopolanco5@serverpi.local
```

```sh
sudo sh -c 'gzip -dc /tmp/songstreamer-0.1.0.tar.gz | docker load'
cd /opt/songstreamer
sudo docker compose stop api
sudo docker compose run --rm --no-deps \
  -v /srv/keystack-data/songstreamer/backups:/backups \
  api node scripts/library.mjs backup /backups
exit
```

Exit back to the development machine, copy that backup, and retain the newest five as shown in [Back up and restore SQLite](#back-up-and-restore-sqlite). Then return to the Pi and install the new configuration:

```sh
ssh emilianopolanco5@serverpi.local
```

```sh
sudo cp -a /opt/songstreamer/compose.yaml /opt/songstreamer/compose.yaml.previous
sudo cp -a /opt/songstreamer/.env /opt/songstreamer/.env.previous
sudo install -o "$USER" -g "$(id -gn)" -m 0640 /tmp/songstreamer-compose.yaml /opt/songstreamer/compose.yaml
printf 'SONGSTREAMER_IMAGE=songstreamer:0.1.0\n' | sudo tee /opt/songstreamer/.env >/dev/null
cd /opt/songstreamer
sudo docker compose config
sudo docker compose up -d --remove-orphans
sudo docker compose ps
```

Keep the previous image tag and configuration until health, listing, and playback checks pass. If the old Docker Compose binary rejects the file, stop and resolve that compatibility issue rather than silently changing the mounts or security settings. To roll back after stopping the new service, restore the saved files and recreate the old service:

```sh
cd /opt/songstreamer
sudo docker compose down
sudo mv -f compose.yaml.previous compose.yaml
sudo mv -f .env.previous .env
sudo docker compose up -d --remove-orphans
```

The application publishes `127.0.0.1:3000` on the Pi. Configure the already-installed Tailscale service and Funnel only after the local checks pass, using the current Tailscale CLI documentation and the intended public HTTPS hostname. Verify from a device outside the tailnet; a local loopback response does not establish public Funnel operation.

## Verify a release

Run these checks from the Pi or a machine that can reach the loopback publication:

```sh
curl --fail http://127.0.0.1:3000/health
curl --fail http://127.0.0.1:3000/import/health
curl --fail http://127.0.0.1:3000/songs
curl --head --fail http://127.0.0.1:3000/songs/SONG_ID/audio
curl --fail --range 0-127 -D - -o /dev/null http://127.0.0.1:3000/songs/SONG_ID/audio
```

The range check should return `206` and a `Content-Range` header. Test the same metadata, playback, seek, and cancellation behavior through the actual public URL. Run the bounded client script from the development machine only after a real song is present:

```sh
node scripts/load-test.mjs 'https://PUBLIC_HOST/songs/SONG_ID/audio' --clients 10 --seconds 30
```

Record Pi CPU, memory, swap, logs, and stalls alongside the result. Ten clients are a target for acceptance testing, not a hard public capacity guarantee.

## Import a song from the kiosk

The kiosk first calls `POST /import/inspect`. This is metadata inspection only. The operator reviews and edits the title, artist, optional album, and the selected native AAC-LC stream. It then calls `POST /import/jobs`; the server does not start a download before that confirmation. The kiosk polls the returned job ID until it reaches `completed` or `failed` and keeps navigation on the Import tab while the job is active.

The importer requires the container's `/audio` mount to be writable. It creates a job directory beneath `/audio/.import-staging`, validates the resulting AAC-LC stream with ffprobe, and atomically renames the verified `.m4a` into `/audio/imports/` before committing its catalogue row. Keep the staging directory and final imports on the same SSD filesystem. A failed job removes its partial staging files; an interrupted job is marked failed on the next server start and can be retried from the kiosk.

The image installs the pinned yt-dlp release, Node JavaScript runtime support, ffmpeg, and ffprobe. Use `GET /import/health` before troubleshooting a URL. The API never transcodes incompatible audio and performs no duplicate or source URL validation beyond the strict single-video URL and native format policy.

## Back up and restore SQLite

Stop the API before a release or metadata maintenance session. The backup command opens the existing SQLite file directly and runs `VACUUM INTO`; it does not apply pending migrations. The backups directory is mounted only for that temporary command:

```sh
cd /opt/songstreamer
sudo docker compose stop api
sudo docker compose run --rm --no-deps \
  -v /srv/keystack-data/songstreamer/backups:/backups \
  api node scripts/library.mjs backup /backups
```

Copy the resulting files to a development-machine directory and retain the newest five there as well:

```sh
mkdir -p "$HOME/songstreamer-backups"
scp 'emilianopolanco5@serverpi.local:/srv/keystack-data/songstreamer/backups/songstreamer-*.sqlite' "$HOME/songstreamer-backups/"
node scripts/retain-backups.mjs "$HOME/songstreamer-backups" --keep 5
```

The command uses SQLite `VACUUM INTO` and a generated destination filename. The API's long-running service never mounts `backups/`.

To restore, first copy the selected development-machine backup to the Pi, then stop the service, preserve the current database, copy the selected file into the data directory, and remove stale WAL sidecars before starting:

```sh
scp "$HOME/songstreamer-backups/songstreamer-YYYYMMDDTHHMMSSZ.sqlite" \
  emilianopolanco5@serverpi.local:/tmp/songstreamer-restore.sqlite
ssh emilianopolanco5@serverpi.local
```

Then run these commands in the Pi shell:

```sh
cd /opt/songstreamer
sudo docker compose stop api
sudo mv /srv/keystack-data/songstreamer/data/songstreamer.sqlite \
  "/srv/keystack-data/songstreamer/data/songstreamer.failed-$(date +%Y%m%d%H%M%S).sqlite"
sudo install -o 1000 -g 1000 -m 0640 \
  /tmp/songstreamer-restore.sqlite \
  /srv/keystack-data/songstreamer/data/songstreamer.sqlite
sudo rm -f /srv/keystack-data/songstreamer/data/songstreamer.sqlite-wal \
  /srv/keystack-data/songstreamer/data/songstreamer.sqlite-shm
sudo docker compose run --rm --no-deps api node scripts/library.mjs check
sudo docker compose up -d
```

Use the backup that matches the image/schema being restored. Verify `/health`, metadata, a complete response, a range response, and browser playback before deleting the preserved failed database.

## Add a song

Validate the complete file away from the Pi:

```sh
scripts/validate-audio.sh recording.m4a
```

Copy it to a temporary name on the same SSD filesystem. Do not copy directly to its published name:

```sh
scp recording.m4a emilianopolanco5@serverpi.local:/srv/keystack-data/songstreamer/audio/.incoming-song-1.m4a
ssh emilianopolanco5@serverpi.local \
  'mv /srv/keystack-data/songstreamer/audio/.incoming-song-1.m4a /srv/keystack-data/songstreamer/audio/song-1.m4a'
```

With the API stopped and a backup made, insert the metadata through the maintenance tool. The tool checks that the file is a non-empty `.m4a` inside the audio root, then inserts it in a transaction:

```sh
cd /opt/songstreamer
sudo docker compose run --rm --no-deps api node scripts/library.mjs add \
  --id song-1 \
  --title 'Example Song' \
  --artist 'Example Artist' \
  --album 'Example Album' \
  --duration 243.52 \
  --file song-1.m4a
sudo docker compose run --rm --no-deps api node scripts/library.mjs check
sudo docker compose up -d
```

The ID and relative path are stable operator-owned values. Use a new ID and path for a replacement rather than changing a file while it may be streamed. Keep originals outside the service audio directory.

## Remove a song and diagnose missing files

Stop the API, back up the database, then remove only the metadata row:

```sh
sudo docker compose stop api
sudo docker compose run --rm --no-deps \
  -v /srv/keystack-data/songstreamer/backups:/backups \
  api node scripts/library.mjs backup /backups
sudo docker compose run --rm --no-deps api node scripts/library.mjs remove --id song-1
sudo docker compose run --rm --no-deps api node scripts/library.mjs check
sudo docker compose up -d
```

Delete the old audio file separately only after confirming no other row references it. `check` reports missing or unsafe paths and returns a failing exit status; the API returns `404` for an unavailable file instead of serving outside the configured root.
