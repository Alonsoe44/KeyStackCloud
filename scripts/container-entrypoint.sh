#!/bin/sh
set -eu

if [ "${REQUIRE_SSD_MARKER:-false}" = "true" ] || [ "${REQUIRE_SSD_MARKER:-0}" = "1" ]; then
  marker=${SSD_MARKER_PATH:-/data/.songstreamer-ssd}
  if [ ! -r "$marker" ]; then
    echo "SongStreamer refuses to start: required SSD marker is missing at $marker" >&2
    exit 78
  fi
fi

exec "$@"
