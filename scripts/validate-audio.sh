#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 FILE.m4a" >&2
  exit 2
fi
file=$1
case "$file" in
  *.m4a|*.M4A) ;;
  *) echo "file must end in .m4a" >&2; exit 2 ;;
esac
command -v ffprobe >/dev/null || { echo "ffprobe is required" >&2; exit 2; }

format=$(ffprobe -v error -show_entries format=format_name -of default=nw=1:nk=1 "$file")
[[ "$format" == mov,* ]] || { echo "not an MP4/M4A container: $format" >&2; exit 1; }

audio_count=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$file" | wc -l | tr -d ' ')
[[ "$audio_count" == "1" ]] || { echo "expected exactly one audio stream, found $audio_count" >&2; exit 1; }

codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$file")
profile=$(ffprobe -v error -select_streams a:0 -show_entries stream=profile -of default=nw=1:nk=1 "$file")
codec_tag=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_tag_string -of default=nw=1:nk=1 "$file")
# FFmpeg builds commonly report AAC-LC as the name LC, while some builds
# report the same profile by its numeric value 1.
[[ "$codec" == "aac" && ( "$profile" == "LC" || "$profile" == "1" ) && "$codec_tag" == "mp4a" ]] || {
  echo "expected unencrypted AAC-LC/mp4a, found codec=$codec profile=$profile tag=$codec_tag" >&2
  exit 1
}

ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,profile,sample_rate,channels,duration,bit_rate -of default=nw=1 "$file"
echo "valid AAC-LC M4A: $file"
