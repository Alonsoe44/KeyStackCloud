# Deployment and releases

Executable deployment and release procedure. The initial Pi 2 deployment is complete; public Funnel, content, capacity, and remaining host acceptance checks are recorded in [deployment-results.md](deployment-results.md).

## Confirmed host

- SSH: `ssh emilianopolanco5@serverpi.local`
- Raspberry Pi 2 Model B Rev 1.1, 32-bit ARMv7, Raspbian 13.
- Existing SSD mount: `/srv/keystack-data` (ext4).

## Initial deployment procedure

1. Verify architecture, OS, free memory, SSD mount, and selected runtime/engine support.
2. Create dedicated service directories and permissions under the SSD mount after the layout is agreed. This was completed by the interactive Pi bootstrap.
3. Configure public HTTPS through the proposed Tailscale Funnel service. Listeners must not need a VPN or Tailscale installation. Test from outside the tailnet because private access does not verify Funnel throughput; this remains pending.
4. Build a versioned ARMv7 image on the development machine and transfer it over SSH. Use Docker Compose; no registry initially. This was completed for `songstreamer:0.1.0`.
5. Initialize the SQLite schema and apply migrations. Keep database state outside the image. This was verified with an empty database on Pi 2.
6. Mount audio read-only. Bind the API's host port to loopback for the HTTPS proxy. This is active in the deployed Compose service.
7. Verify health, restart behavior, browser playback and seeking, and ten concurrent streams over the public tunnel. Health passed; the remaining checks require operator audio and Funnel setup.
8. Record measured engine/API/tunnel memory, total CPU, and playback results; compare against agreed acceptance criteria.

Because the SSD has a `nofail` mount, startup must explicitly require the SSD. A missing SSD must not silently create service data on the SD card.

## Subsequent release procedure to document and verify

1. Build and validate a versioned artifact for the correct CPU away from the Pi.
2. Transfer it over SSH without modifying persistent audio/database state.
3. Take a consistent SQLite backup before migrations; copy it to the development machine and retain the latest five backups. Retain the previous artifact and configuration.
4. Apply migrations and restart. A short playback interruption is accepted; uninterrupted releases are outside the initial scope.
5. Verify health, song listing, full playback, and seeking.
6. Roll back the artifact if verification fails. If the schema is incompatible, restore the matching database backup as part of rollback.

Short downtime is accepted. Images are built on the development machine and transferred over SSH. Backups are copied to the development machine with the latest five retained. Document the exact local destination in implementation.

## Manual library maintenance procedure to document and verify

The final guide must provide exact paths and SQL for the agreed schema: verify the actual audio container/codec on another machine, copy to a staging filename, set permissions, atomically publish the complete file, and insert metadata in a SQLite transaction referencing its stable relative path. It must also cover missing files, replacements, and removals. Do not publish partial files or replace an actively served file in place.

The accepted profile is unencrypted AAC-LC in .m4a, preserving compatible source bitrate/sample rate. Metadata consists of ID, title, artist, optional album, duration, and relative file path. Brief maintenance interruptions are allowed; replacements use a new ID/path, and unavailable songs/files return 404. Take and copy a consistent database backup before each maintenance session; retain five copies on the development machine, and keep original songs separately. Native browser playback remains a deployment acceptance step; Pi 5 testing is deferred under [current execution constraints](current-constraints.md).
