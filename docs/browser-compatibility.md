# Browser compatibility and audio acceptance

## Agreed audio contract

One unencrypted AAC-LC audio stream in an .m4a (MP4) container. Preserve compatible existing bitrate and sample rate; no live conversion on the Pi and no fixed re-encoding preset. Validate the actual codec and container before manually publishing a song. Manually entered SQLite metadata cannot change how a file is encoded.

Serve media with `audio/mp4`; AAC-LC's codec identifier is `mp4a.40.2`. Use ordinary HTTP byte-range playback so browsers can seek without downloading the complete file. Prepare M4A files with their MP4 index at the beginning (often called fast start) outside the Pi to make startup efficient; this packaging operation need not re-encode AAC.

## Current execution constraint

The user explicitly prohibited further Pi 5 access and all Pi 5 development, backend testing, and browser testing. The Pi 5 material below is historical evidence only; do not reconnect to `pekepi.local` or rerun the removed historical harness. Development, backend tests, and browser tests run on the MacBook only.

## Local browser verification

MacBook Chrome 154 passed native audio playback against the Mac-hosted API using AAC-LC M4A fixtures at 44.1 kHz/128 kbit/s and 48 kHz/192 kbit/s. Checks covered metadata, playback time advancement, pause/resume, forward/backward/near-end seeking, ended events, HTTP 206 range probes, and decoded Web Audio sample energy. See [local browser results](local-browser-results.md). This does not establish physical speaker audibility or passes for untested browser versions/platforms.

## Deferred client acceptance

- Raspberry Pi 5 with the default browser was part of the earlier design target, but that check is deferred by the current execution constraint.
- Current Chrome and Edge on supported desktop systems, Firefox on supported desktop systems with AAC decoding available, Safari on macOS/iOS, and Chrome on Android.
- Broad compatibility is a target, not a claim that every Chromium build or old browser supports AAC. Pi 5 is a playback client; the initial backend host remains Pi 2.

## Research evidence (2026-10-18)

- [Raspberry Pi configuration documentation](https://www.raspberrypi.com/documentation/configuration/computers/raspberry-pi.html): Chromium is the default when no alternative is chosen; users can select Firefox instead.
- [Chromium audio/video documentation](https://www.chromium.org/audio-video/): MP4 is supported, while AAC codec support is controlled by the build's proprietary-codec and FFmpeg configuration. An arbitrary Chromium binary cannot be assumed to play AAC.
- [Raspberry Pi software sources documentation](https://www.raspberrypi.com/documentation/computers/software-sources.html): Raspberry Pi distributes downstream patched packages, so validate the shipped build rather than substituting a generic Chromium test build.
- [MDN media containers](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers) and [codec guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs): container and codec both affect browser support, with some AAC decoding depending on platform facilities.
- [FFmpeg MP4 muxer documentation](https://ffmpeg.org/ffmpeg-formats.html#mov_002c-mp4_002c-ismv): faststart moves the index to the beginning for improved playback.

## Historical Pi 5 evidence (do not rerun)

Status: PLAYBACK UNVERIFIED. Pi 5 connected at `emilianopolanco5@pekepi.local`; hardware is Pi 5 Model B Rev 1.1, aarch64, Debian 13 trixie. Installed Chromium is 152.0.7977.82 (`1:152.0.7977.82-1~deb13u1+rpt2`); FFmpeg is 7.1.5-0+deb13u1+rpt2.

A temporary sandboxed headless Chromium smoke test opened about:blank successfully. Two generated AAC-LC M4A fixtures (44.1 and 48 kHz) were validated with FFmpeg, but the loopback browser harness timed out before returning capability/playback assertions. This is a harness failure, not evidence of a codec failure or pass. Temporary files/processes were cleaned up; no persistent Pi changes were made. Actual playback and seeking still require an interactive or repaired harness test, followed by the deployed public-path checks below.

The historical harness report records the inspected Pi 5 package and a capability hint, but it collected no media request or decode assertion. The user has explicitly stopped further access. Any future browser check must be separately authorized and planned; no result is inferred from the capability hint.
