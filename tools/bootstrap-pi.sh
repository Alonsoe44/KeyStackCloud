#!/usr/bin/env bash
set -Eeuo pipefail

# Prepare the existing Raspberry Pi 2 host for SongStreamer.
#
# Run this file as the normal Pi operator account.  Privileged commands are
# sent through sudo so the normal interactive sudo prompt remains available;
# this script never reads, stores, or forwards a sudo password.  It does not
# install a SongStreamer systemd unit, copy a release, configure Compose, or
# authenticate Tailscale.

# Interactive SSH sessions on the Pi may omit the administrative system
# directories.  Put the trusted system locations first so discovery of
# usermod/systemctl and the other host tools does not depend on shell startup
# files; the existing user PATH remains available after them.
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}"
export PATH

readonly SSD_ROOT="/srv/keystack-data"
readonly SONGSTREAMER_ROOT="$SSD_ROOT/songstreamer"
readonly AUDIO_ROOT="$SONGSTREAMER_ROOT/audio"
readonly DATA_ROOT="$SONGSTREAMER_ROOT/data"
readonly BACKUP_ROOT="$SONGSTREAMER_ROOT/backups"
readonly SERVICE_ROOT="/opt/songstreamer"
readonly SSD_MARKER="$DATA_ROOT/.songstreamer-ssd"

# The Compose file runs the application as this numeric identity by default.
# Override both values only when the deployment Compose configuration is
# changed to use the same alternate identity.
readonly RUNTIME_UID="${SONGSTREAMER_UID:-1000}"
readonly RUNTIME_GID="${SONGSTREAMER_GID:-1000}"

readonly TAILSCALE_KEY_URL="https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg"
readonly TAILSCALE_LIST_URL="https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list"
readonly TAILSCALE_KEY_PATH="/usr/share/keyrings/tailscale-archive-keyring.gpg"
readonly TAILSCALE_LIST_PATH="/etc/apt/sources.list.d/tailscale.list"

die() {
  printf 'bootstrap-pi: %s\n' "$*" >&2
  exit 1
}

grant_docker_access=0
for argument in "$@"; do
  case "$argument" in
    --grant-docker-access)
      grant_docker_access=1
      ;;
    --help|-h)
      cat <<'USAGE'
Usage: bootstrap-pi.sh [--grant-docker-access]

Prepare the SongStreamer Pi host. Run as the normal operator account so sudo
can prompt interactively. Docker group access is opt-in because it grants
root-equivalent control over the host.
USAGE
      exit 0
      ;;
    *)
      die "unknown option: $argument"
      ;;
  esac
done

if [[ "${EUID}" -eq 0 ]]; then
  as_root() { "$@"; }
else
  command -v sudo >/dev/null 2>&1 || die "sudo is required; run this on the Pi's normal operator account"
  as_root() { sudo "$@"; }
fi

operator_user="${SONGSTREAMER_USER:-${SUDO_USER:-${USER:-}}}"
[[ -n "$operator_user" && "$operator_user" != root ]] || \
  die "set SONGSTREAMER_USER to the unprivileged Pi account when running as root"
id "$operator_user" >/dev/null 2>&1 || die "user does not exist: $operator_user"
operator_group="$(id -gn "$operator_user")"
operator_uid="$(id -u "$operator_user")"
operator_gid="$(id -g "$operator_user")"

[[ "$RUNTIME_UID" =~ ^[0-9]+$ && "$RUNTIME_GID" =~ ^[0-9]+$ ]] || \
  die "SONGSTREAMER_UID and SONGSTREAMER_GID must be numeric"
(( RUNTIME_UID >= 1 && RUNTIME_UID <= 65533 )) || die "SONGSTREAMER_UID is outside the valid range"
(( RUNTIME_GID >= 1 && RUNTIME_GID <= 65533 )) || die "SONGSTREAMER_GID is outside the valid range"

for command_name in apt-get dpkg findmnt id install mktemp systemctl uname; do
  command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
done
if (( grant_docker_access )); then
  command -v usermod >/dev/null 2>&1 || die "required command is missing for --grant-docker-access: usermod"
fi

# Perform all host checks before sudo, apt, or filesystem mutations.  A
# missing SSD must never cause the service directories to land on the SD card.
[[ "$(uname -m)" == armv7l ]] || \
  die "this bootstrap targets ARMv7 (armv7l); observed $(uname -m)"
[[ "$(dpkg --print-architecture)" == armhf ]] || \
  die "this bootstrap targets the 32-bit ARMv7 armhf userspace"

# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == raspbian ]] || die "this bootstrap targets Raspbian; observed ID=${ID:-<unset>}"
[[ "${VERSION_ID:-}" == 13 && "${VERSION_CODENAME:-}" == trixie ]] || \
  die "this bootstrap targets Raspbian 13 trixie; observed version=${VERSION_ID:-<unset>} codename=${VERSION_CODENAME:-<unset>}"

mount_target="$(findmnt -T "$SSD_ROOT" -n -o TARGET 2>/dev/null || true)"
mount_type="$(findmnt -T "$SSD_ROOT" -n -o FSTYPE 2>/dev/null || true)"
[[ "$mount_target" == "$SSD_ROOT" && "$mount_type" == ext4 ]] || {
  printf 'bootstrap-pi: refusing to prepare SongStreamer: %s is not the expected ext4 mount\n' "$SSD_ROOT" >&2
  printf 'bootstrap-pi: observed target=%s fstype=%s\n' "${mount_target:-<none>}" "${mount_type:-<none>}" >&2
  exit 78
}

# The default Compose identity is deliberately the normal Pi account's usual
# UID/GID.  Refuse a mismatch rather than creating directories the operator
# cannot maintain; an explicit override remains possible for a matching
# Compose configuration on another host.
if [[ "$RUNTIME_UID" != "$operator_uid" || "$RUNTIME_GID" != "$operator_gid" ]]; then
  die "runtime identity ${RUNTIME_UID}:${RUNTIME_GID} does not match $operator_user ${operator_uid}:${operator_gid}; set both SONGSTREAMER_UID and SONGSTREAMER_GID and use the same values in Compose"
fi

if [[ "${EUID}" -ne 0 ]]; then
  sudo -v
fi

export DEBIAN_FRONTEND=noninteractive
as_root apt-get update
as_root apt-get install -y docker.io docker-compose sqlite3 ca-certificates curl

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "$tmp_dir"
}
trap cleanup EXIT

# Install the signed Tailscale repository from its official Debian trixie
# endpoints.  The downloaded files are checked before being installed and are
# replaced only when they differ, so rerunning this script is idempotent.
curl --fail --silent --show-error --location --retry 3 --retry-delay 2 \
  --proto '=https' --tlsv1.2 "$TAILSCALE_KEY_URL" -o "$tmp_dir/tailscale.gpg"
curl --fail --silent --show-error --location --retry 3 --retry-delay 2 \
  --proto '=https' --tlsv1.2 "$TAILSCALE_LIST_URL" -o "$tmp_dir/tailscale.list"
[[ -s "$tmp_dir/tailscale.gpg" ]] || die "Tailscale key download was empty"
grep -Fq 'trixie' "$tmp_dir/tailscale.list" || die "Tailscale source list did not contain trixie"

as_root install -d -o root -g root -m 0755 /usr/share/keyrings
if ! as_root cmp -s "$tmp_dir/tailscale.gpg" "$TAILSCALE_KEY_PATH"; then
  as_root install -o root -g root -m 0644 "$tmp_dir/tailscale.gpg" "$TAILSCALE_KEY_PATH"
fi
if ! as_root cmp -s "$tmp_dir/tailscale.list" "$TAILSCALE_LIST_PATH"; then
  as_root install -o root -g root -m 0644 "$tmp_dir/tailscale.list" "$TAILSCALE_LIST_PATH"
fi

as_root apt-get update
as_root apt-get install -y tailscale

# Only the host services are enabled.  The API remains a normal container and
# its Compose publication must stay bound to 127.0.0.1 for the host Funnel.
as_root systemctl enable --now docker
as_root systemctl enable --now tailscaled

if (( grant_docker_access )); then
  as_root usermod -aG docker "$operator_user"
fi

ensure_directory() {
  local path="$1"
  local owner="$2"
  local group="$3"
  local mode="$4"

  if as_root test -L "$path"; then
    die "refusing to use symlinked directory: $path"
  fi
  if as_root test -e "$path"; then
    as_root test -d "$path" || die "path exists but is not a directory: $path"
  else
    as_root install -d -o "$owner" -g "$group" -m "$mode" "$path"
    return
  fi
  as_root chown "$owner:$group" "$path"
  as_root chmod "$mode" "$path"
}

ensure_directory "$SERVICE_ROOT" "$operator_user" "$operator_group" 0750
ensure_directory "$SONGSTREAMER_ROOT" "$operator_user" "$operator_group" 0750
ensure_directory "$AUDIO_ROOT" "$RUNTIME_UID" "$RUNTIME_GID" 0750
ensure_directory "$DATA_ROOT" "$RUNTIME_UID" "$RUNTIME_GID" 0750
ensure_directory "$BACKUP_ROOT" "$RUNTIME_UID" "$RUNTIME_GID" 0750

if as_root test -L "$SSD_MARKER"; then
  die "refusing to use symlinked SSD marker: $SSD_MARKER"
fi
if as_root test -e "$SSD_MARKER"; then
  as_root test -f "$SSD_MARKER" || die "SSD marker exists but is not a regular file: $SSD_MARKER"
else
  as_root install -o "$RUNTIME_UID" -g "$RUNTIME_GID" -m 0640 /dev/null "$SSD_MARKER"
fi
as_root chown "$RUNTIME_UID:$RUNTIME_GID" "$SSD_MARKER"
as_root chmod 0640 "$SSD_MARKER"

printf '\nSongStreamer host bootstrap complete.\n'
printf '  Docker and tailscaled are enabled and running.\n'
printf '  Host data: %s\n' "$SONGSTREAMER_ROOT"
printf '  Service files: %s\n' "$SERVICE_ROOT"
printf '  Runtime identity: %s:%s\n' "$RUNTIME_UID" "$RUNTIME_GID"
if (( grant_docker_access )); then
  printf '  Docker group access granted to %s; log out and back in before using Docker without sudo.\n' "$operator_user"
else
  printf '  Docker group membership was not changed; use sudo for Docker commands.\n'
fi
printf '\nNext steps are intentionally manual:\n'
printf '  1. Copy the release files into %s.\n' "$SERVICE_ROOT"
printf '  2. Authenticate this host in your browser with: sudo tailscale up\n'
printf '  3. Start Compose after reviewing its loopback-only publication.\n'
printf '  4. Once the API is healthy, configure Funnel explicitly for 127.0.0.1.\n'
printf 'No reboot, app systemd unit, sudoers rule, or auto-login credential was configured.\n'
