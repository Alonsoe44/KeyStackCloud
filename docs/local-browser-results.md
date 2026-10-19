# Local browser AAC-LC playback evidence

Status: **PASS**.

This test used the local Mac SongStreamer API against a temporary SQLite library and temporary AAC-LC M4A files. Chrome was driven through a real button click; no frontend product code was used.

## Environment

```json
{
  "apiBase": "http://127.0.0.1:53830",
  "apiPid": 23648,
  "architecture": "arm64",
  "chromeBundleVersion": "(null)",
  "fixtures": [
    {
      "afinfo": "File:           /tmp/songstreamer-local-audio-kny2kdwv/audio/aac-lc-44k1.m4a\nFile type ID:   m4af\nNum Tracks:     1\n----\nData format:     2 ch,  44100 Hz, aac  (0x00000000) 0 bits/channel, 0 bytes/packet, 1024 frames/packet, 0 bytes/frame\n                no channel layout.\naudio bytes: 128501\naudio packets: 346\nestimated duration: 8.000 sec\nbit rate: 127955 bits per second\npacket size upper bound: 411\nmaximum packet size: 411\naudio data file offset: 2190\noptimized\naudio 352800 valid frames + 1024 priming + 480 remainder = 354304\nformat list:\n[ 0] format:\t  2 ch,  44100 Hz, aac  (0x00000000) 0 bits/channel, 0 bytes/packet, 1024 frames/packet, 0 bytes/frame\nChannel layout: Stereo (L R)\n----",
      "afinfoBrief": "/tmp/songstreamer-local-audio-kny2kdwv/audio/aac-lc-44k1.m4a, m4af, Num Tracks:     1\n----\n8.000 sec, format:   2 ch,  44100 Hz, aac  (0x00000000) 0 bits/channel, 0 bytes/packet, 1024 frames/packet, 0 bytes/frame",
      "bitrate": 128000,
      "duration": 8.0,
      "encoder": "Docker FFmpeg image jrottenberg/ffmpeg:6.0-ubuntu",
      "filename": "aac-lc-44k1.m4a",
      "frequency": 440,
      "id": "local-aac-44k1",
      "path": "/tmp/songstreamer-local-audio-kny2kdwv/audio/aac-lc-44k1.m4a",
      "sample_rate": 44100,
      "size": 130691,
      "title": "Local AAC 44.1 kHz"
    },
    {
      "afinfo": "File:           /tmp/songstreamer-local-audio-kny2kdwv/audio/aac-lc-48k.m4a\nFile type ID:   m4af\nNum Tracks:     1\n----\nData format:     2 ch,  48000 Hz, aac  (0x00000000) 0 bits/channel, 0 bytes/packet, 1024 frames/packet, 0 bytes/frame\n                no channel layout.\naudio bytes: 192435\naudio packets: 376\nestimated duration: 8.000 sec\nbit rate: 191923 bits per second\npacket size upper bound: 557\nmaximum packet size: 557\naudio data file offset: 2302\noptimized\naudio 384000 valid frames + 1024 priming + 0 remainder = 385024\nformat list:\n[ 0] format:\t  2 ch,  48000 Hz, aac  (0x00000000) 0 bits/channel, 0 bytes/packet, 1024 frames/packet, 0 bytes/frame\nChannel layout: Stereo (L R)\n----",
      "afinfoBrief": "/tmp/songstreamer-local-audio-kny2kdwv/audio/aac-lc-48k.m4a, m4af, Num Tracks:     1\n----\n8.000 sec, format:   2 ch,  48000 Hz, aac  (0x00000000) 0 bits/channel, 0 bytes/packet, 1024 frames/packet, 0 bytes/frame",
      "bitrate": 192000,
      "duration": 8.0,
      "encoder": "Docker FFmpeg image jrottenberg/ffmpeg:6.0-ubuntu",
      "filename": "aac-lc-48k.m4a",
      "frequency": 660,
      "id": "local-aac-48k",
      "path": "/tmp/songstreamer-local-audio-kny2kdwv/audio/aac-lc-48k.m4a",
      "sample_rate": 48000,
      "size": 194737,
      "title": "Local AAC 48 kHz"
    }
  ],
  "macOS": "26.6.2",
  "pageUrl": "http://127.0.0.1:53834/"
}
```

Native `ffmpeg` was unavailable on this Mac, so the fixtures were encoded in
the temporary Docker mount with `jrottenberg/ffmpeg:6.0-ubuntu`, resolved to
`jrottenberg/ffmpeg@sha256:c06893d3ea50fc2aceccec63fc21df415124f99164eb16c56ce2e8bb88342a08`.
macOS `afinfo` independently identified both outputs as AAC in an `m4af`
container at the requested sample rates.

## Playback observations

| Fixture | canPlayType | Metadata status | Duration (s) | Time advanced | Pause/resume | Near-end seek landed (s) | Web Audio energy |
| --- | --- | ---: | ---: | --- | --- | ---: | --- |
| `local-aac-44k1` | probably | 200 | 8 | True | True | 7.45 | True (0.155830) |
| `local-aac-48k` | probably | 200 | 8 | True | True | 7.45 | True (0.155892) |

The page performed metadata loading, real play, currentTime advancement, pause/resume, forward seek, backward seek, near-end seek, ended, and an explicit Range request for each API audio route.

A nonzero Web Audio RMS value proves decoded samples reached the browser audio graph. It does not prove physical speaker audibility; that requires a human listener or separate audio-sink instrumentation.

## Structured page result

```json
{
  "report": {
    "apiBase": "http://127.0.0.1:53830",
    "canPlayType": "probably",
    "completed": true,
    "fixtures": [
      {
        "advancedTo": 0.3715,
        "canPlayType": "probably",
        "decodedAudioEnergy": {
          "detected": true,
          "maximumRms": 0.15582957476728138
        },
        "duration": 8,
        "ended": true,
        "events": [
          {
            "currentTime": 0,
            "error": null,
            "name": "waiting",
            "networkState": 2,
            "readyState": 0
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "loadstart",
            "networkState": 2,
            "readyState": 0
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "loadedmetadata",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "loadeddata",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "canplay",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 0.3715,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 0.3715,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "seeking",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "seeked",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "canplay",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "seeking",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "seeked",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "canplay",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "seeking",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "seeked",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "canplay",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 8,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 8,
            "error": null,
            "name": "ended",
            "networkState": 1,
            "readyState": 4
          }
        ],
        "expectedBitrate": 128000,
        "expectedSampleRate": 44100,
        "id": "local-aac-44k1",
        "mediaError": null,
        "metadataDuration": 8,
        "metadataStatus": 200,
        "pauseObserved": true,
        "playbackAdvanced": true,
        "rangeProbe": {
          "acceptRanges": "bytes",
          "bytesRead": 128,
          "contentLength": "128",
          "contentRange": "bytes 0-127/130691",
          "status": 206
        },
        "resumeAdvanced": true,
        "seekBackward": {
          "landed": 1.76,
          "requested": 1.76,
          "resumedAt": 1.9268
        },
        "seekForward": {
          "landed": 4.64,
          "requested": 4.64,
          "resumedAt": 4.8025
        },
        "seekNearEnd": {
          "landed": 7.45,
          "requested": 7.45,
          "resumedAt": 7.6125
        },
        "title": "Local AAC 44.1 kHz"
      },
      {
        "advancedTo": 0.3733,
        "canPlayType": "probably",
        "decodedAudioEnergy": {
          "detected": true,
          "maximumRms": 0.15589209600161094
        },
        "duration": 8,
        "ended": true,
        "events": [
          {
            "currentTime": 0,
            "error": null,
            "name": "waiting",
            "networkState": 2,
            "readyState": 0
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "loadstart",
            "networkState": 2,
            "readyState": 0
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "loadedmetadata",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "loadeddata",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "canplay",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 0,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 0.3733,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 0.3733,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "seeking",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "seeked",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "canplay",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 4.64,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "seeking",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "seeked",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "canplay",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 1.76,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "seeking",
            "networkState": 1,
            "readyState": 1
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "seeked",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "canplay",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 7.45,
            "error": null,
            "name": "playing",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 8,
            "error": null,
            "name": "pause",
            "networkState": 1,
            "readyState": 4
          },
          {
            "currentTime": 8,
            "error": null,
            "name": "ended",
            "networkState": 1,
            "readyState": 4
          }
        ],
        "expectedBitrate": 192000,
        "expectedSampleRate": 48000,
        "id": "local-aac-48k",
        "mediaError": null,
        "metadataDuration": 8,
        "metadataStatus": 200,
        "pauseObserved": true,
        "playbackAdvanced": true,
        "rangeProbe": {
          "acceptRanges": "bytes",
          "bytesRead": 128,
          "contentLength": "128",
          "contentRange": "bytes 0-127/194737",
          "status": 206
        },
        "resumeAdvanced": true,
        "seekBackward": {
          "landed": 1.76,
          "requested": 1.76,
          "resumedAt": 1.9253
        },
        "seekForward": {
          "landed": 4.64,
          "requested": 4.64,
          "resumedAt": 4.8027
        },
        "seekNearEnd": {
          "landed": 7.45,
          "requested": 7.45,
          "resumedAt": 7.6127
        },
        "title": "Local AAC 48 kHz"
      }
    ],
    "mime": "audio/mp4; codecs=\"mp4a.40.2\"",
    "notes": [
      "Web Audio analyser energy proves decoded samples reached the browser audio graph.",
      "Physical speaker audibility requires a human listener or separate audio-sink instrumentation."
    ],
    "platform": "MacIntel",
    "status": "pass",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36"
  },
  "runnerError": null
}
```

The temporary API process, browser page server, database, and audio files were
cleaned up automatically after the browser report arrived. Physical speaker
audibility was not measured; the Web Audio RMS result proves decoded samples
reached Chrome's audio graph.

## KeyStack Import kiosk E2E

On 2026-10-19, the local KeyStack Import screen was exercised at 800×480
against a local SongStreamer process on `127.0.0.1:4100`. The flow inspected
YouTube video `-bnx_Qwy7w4`, prefilled `All I Do`, `Stevie Wonder`, and
`Hotter Than July`, allowed metadata editing, required confirmation before the
download began, kept the Songs navigation locked while the job was active, and
unlocked it after publication. The completed job was
`81f48d29-639d-4673-b6fd-326bc6b9e2a5`, and its catalogue row was
`import-44610a6b-ff8b-4f32-81f8-f148fd9ec1fd`.

The published file was `4,961,487` bytes with SHA-256
`6b26fe8c6a550f522a5d5f7b65bf5680b43144b4f95a46d88c34b9cbcd3743ca`.
FFprobe measured one audio-only MP4/M4A stream: AAC profile LC, 44,100 Hz,
two channels, 128,009 bit/s, and `306.676009` seconds. The Songs player then
advanced from 0 to about 16 seconds, the +10-second control reached about 30
seconds, and pause worked. A range request returned `206 audio/mp4` with
`Content-Range: bytes 0-31/4961487`.

This was a MacBook-only local acceptance run. No Raspberry Pi client was
accessed or used for testing.

The compact confirmation layout was rechecked at the same 800×480 viewport
after the source summary and Change URL action were combined into one card.
The full metadata form and Confirm and download action remained visible. A
second import of the same YouTube URL created a distinct job
`d2ea53c3-6bd7-4c40-ad30-abf223ff462a` and song
`import-33cf4351-73a2-4026-bafa-77de35c29edc`, confirming that the public kiosk
does not deduplicate imports. Browser Back during the active job stayed on
`/import`; after completion, Songs refreshed its catalogue and showed the new
row.

The ARMv7-compatible container was rebuilt and started with a read-only root
filesystem and a 256 MiB memory limit. `/api/v1/import/health` reported yt-dlp,
ffmpeg, and ffprobe ready. A real local container import completed as job
`b0039a66-4daa-4d4e-be84-6f9ca847987a`; the output measured 4,961,488 bytes and
`306.713` seconds, with the container's M4A metadata differing slightly from
the Mac run. An ffmpeg stream hash of the compressed AAC packets was
`b3ec6aa3146265eb45824ec04a512dd308cf7ec0b5f8146737ef90ece4c609ad`, matching
the source and confirming stream copy without re-encoding. The container
reported approximately 122.7 MiB idle memory and no OOM event. All runs were
performed locally; no real Pi client was accessed.
