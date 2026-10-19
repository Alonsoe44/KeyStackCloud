# Raspberry Pi host setup

This procedure prepares the existing SongStreamer host: Raspberry Pi 2 Model B Rev 1.1, 32-bit ARMv7, Raspbian 13 (trixie), with the SSD mounted at `/srv/keystack-data`. It installs host prerequisites and creates the persistent directories used by Compose. It does not deploy an image, create the SongStreamer systemd unit, approve a Tailscale account, or reboot the Pi.

The setup must be run as the normal SSH operator account so `sudo` can prompt for its password in the terminal. Never put the password, a Tailscale auth key, or a browser login token in a command or file.

## Preflight

Use the existing SSH account:

```sh
ssh emilianopolanco5@serverpi.local
```

The bootstrap refuses to mutate the host unless all of these checks pass:

- `uname -m` is `armv7l` and `dpkg --print-architecture` is `armhf`.
- `/etc/os-release` identifies Raspbian 13 with codename `trixie`.
- `/srv/keystack-data` is the exact target of an `ext4` mount. This prevents a missing `nofail` SSD mount from redirecting application data to the SD card.
- The operator account has UID and primary GID `1000`, matching the default Compose runtime identity. If another fixed identity is deliberately selected, pass `SONGSTREAMER_UID` and `SONGSTREAMER_GID` together and use the same values in Compose.

These checks happen before `sudo`, `apt`, or directory creation. A failed check leaves the host unchanged by this script.

## Run the bootstrap

From the development checkout, copy the script to the Pi and run it through a TTY so the interactive sudo prompt works:

```sh
scp tools/bootstrap-pi.sh emilianopolanco5@serverpi.local:/tmp/songstreamer-bootstrap-pi.sh
ssh -t emilianopolanco5@serverpi.local 'bash /tmp/songstreamer-bootstrap-pi.sh'
```

The default keeps Docker administrative access behind `sudo`. This means a
later release command sent over SSH must run its Docker operations through
`sudo` in an interactive session. To grant the operator Docker group access
explicitly, add the opt-in flag:

```sh
ssh -t emilianopolanco5@serverpi.local \
  'bash /tmp/songstreamer-bootstrap-pi.sh --grant-docker-access'
```

Membership in the `docker` group is effectively root-equivalent because the
Docker daemon controls the host filesystem and namespace. Use this flag only
when that trade-off is intended; the script never adds the group implicitly.
After opting in, log out and back in before using `docker` without `sudo`.

If the operator account does not use UID/GID `1000`, choose the numeric identity first and make the Compose `user` setting match it:

```sh
ssh -t emilianopolanco5@serverpi.local \
  'SONGSTREAMER_UID=1001 SONGSTREAMER_GID=1001 bash /tmp/songstreamer-bootstrap-pi.sh'
```

Replace those example values with the account's actual `id -u` and `id -g` output. The alternate values must also be set in the deployment environment; they are not a substitute for matching Compose configuration.

The script installs the Raspbian packages `docker.io`, `docker-compose`, `sqlite3`, `ca-certificates`, and `curl`. The Pi inspection found the distro Docker packages at Docker Engine 26.1.5 and Compose 2.26.1; record the versions printed by apt or the verification commands below when setup is performed again.

The script supplies the standard `/usr/local/sbin`, `/usr/sbin`, and `/sbin` directories internally. This handles minimal SSH PATHs where Debian's `usermod` is not otherwise discoverable; it does not edit the operator's shell profile.

For Tailscale, the script installs the signed official Debian trixie repository using these files:

- [Tailscale trixie key](https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg) at `/usr/share/keyrings/tailscale-archive-keyring.gpg`
- [Tailscale trixie source list](https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list) at `/etc/apt/sources.list.d/tailscale.list`

The script enables and starts only the `docker` and `tailscaled` host services. Without `--grant-docker-access`, use `sudo docker` or `sudo docker compose` for Docker administration. With that explicit flag, it adds only the selected operator to Docker's root-equivalent group. It does not add a sudoers entry, weaken file permissions, alter the desktop or kiosk session, stop unrelated services, or reboot the Pi.

## Resulting layout

The bootstrap creates or repairs only these dedicated paths:

```text
/opt/songstreamer/                         release files and Compose project
/srv/keystack-data/songstreamer/
├── audio/                                  AAC-LC .m4a files and same-filesystem import staging
├── data/                                   SQLite database and SSD marker
│   └── .songstreamer-ssd                   required marker for container startup
└── backups/                                consistent SQLite backups
```

The data, audio, and backup directories use the selected numeric runtime identity and mode `0750`; the marker is a regular file with mode `0640`. Keep Compose mounts separate:

```text
SONGSTREAMER_DATA_DIR=/srv/keystack-data/songstreamer/data
SONGSTREAMER_AUDIO_DIR=/srv/keystack-data/songstreamer/audio
```

The API's data and audio mounts are writable by the configured unprivileged UID/GID. The audio mount needs write access for `.import-staging` and atomic publication into `imports/`; the application itself keeps the rest of its container filesystem read-only. Do not mount the parent `songstreamer` directory as `/data`, because that would make the host audio directory available through a writable application mount. The host port published by Compose must remain loopback-only, for example `127.0.0.1:3000:3000`.

The script owns no application unit. The deployment procedure is responsible for copying the release into `/opt/songstreamer`, reviewing its Compose file, and starting the container with the data and audio paths above.

## Verify host setup

Run these read-only checks on the Pi:

```sh
findmnt -T /srv/keystack-data -o TARGET,FSTYPE,SOURCE,OPTIONS
sudo systemctl is-active docker tailscaled
sudo docker version --format '{{.Server.Version}}'
sudo docker compose version || sudo docker-compose version
sqlite3 --version
sudo tailscale version
sudo find /srv/keystack-data/songstreamer -maxdepth 2 -type d -print
sudo stat -c '%u:%g %a %n' \
  /srv/keystack-data/songstreamer/data \
  /srv/keystack-data/songstreamer/audio \
  /srv/keystack-data/songstreamer/backups \
  /srv/keystack-data/songstreamer/data/.songstreamer-ssd
```

The first command must report `/srv/keystack-data` and `ext4`; the service must not be started if it reports `/`, `/srv`, or another filesystem. If the package or source download fails, fix the host's apt/network issue and rerun the script. It is safe to rerun: package installation is idempotent, Tailscale source files are replaced only when their official downloaded contents differ, and the dedicated directories are reconciled in place.

## Authenticate Tailscale and enable Funnel

The bootstrap deliberately stops before account authorization. After the package check succeeds, authenticate the host in a browser:

```sh
sudo tailscale up
sudo tailscale status
```

Follow the URL printed by `tailscale up` with the intended Tailscale account. Do not put an auth key in this repository or in the shell history. Funnel authorization may ask for a separate browser approval in the tailnet policy.

After the API is running and its local health check succeeds, expose only the loopback-published API through the host Tailscale service:

```sh
sudo tailscale funnel --bg http://127.0.0.1:3000
sudo tailscale funnel status
```

The Funnel target is host networking. Do not add Tailscale to the API image or use a Tailscale container. Record the hostname printed by Funnel only after the public URL has been tested from outside the tailnet; the tunnel's bandwidth limits and the home upstream still require a real ten-listener acceptance test.

To stop public access while leaving the Tailscale host connected, use the current Funnel command's `off` form and verify its status:

```sh
sudo tailscale funnel off
sudo tailscale funnel status
```

The exact Funnel CLI is maintained by Tailscale; see the [Funnel command reference](https://tailscale.com/docs/reference/tailscale-cli/funnel) if the installed package presents a different syntax.
