# Pi 5 browser AAC-LC playback evidence

Status: **UNVERIFIED**. The collected run is a harness failure, not an AAC playback failure or pass.

On 2026-10-18 an isolated browser harness reached the installed Pi 5 Chromium over SSH, but the fixture page never committed beyond an about:blank document. The browser reported AAC-LC capability, yet it made zero requests to the fixture server. No HTMLAudioElement playback, currentTime advancement, seek, ended event, or decoded-audio assertion was collected.

The user then explicitly stopped further Pi access and prohibited using the Pi for development, backend, or frontend testing. No rerun is authorized by this record.

## Environment evidence

The following values were read from the Pi before access stopped:

| Field | Value |
| --- | --- |
| Host | pekepi.local |
| Hardware | Raspberry Pi 5 Model B Rev 1.1 |
| OS | Debian GNU/Linux 13.7 (trixie) |
| Architecture | arm64 / aarch64 |
| Chromium package | 1:152.0.7977.82-1~deb13u1+rpt2 |
| Chromium binary | Chromium 152.0.7977.82 built on Debian GNU/Linux 13 (trixie) |
| FFmpeg | 7.1.5-0+deb13u1+rpt2 |
| ALSA playback device | BossDAC, Boss DAC HiFi, pcm512x-hifi-0 |
| PipeWire default sink | Dummy Output |

The existing kiosk browser used the profile at ~/.config/keystack-kiosk. The isolated harness used a temporary profile under /tmp, a loopback-only CDP listener, and the normal Chromium sandbox. It did not use the kiosk profile or process.

## What the harness proved

The installed browser returned:

    new Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"') === "probably"

That is a capability hint only. It does not prove that an AAC stream decoded, that playback time advanced, that seeking worked, or that a listener could hear physical output.

The temporary AAC-LC fixtures were validated with FFprobe before the browser assertion:

| Fixture | Container | Codec/profile | Sample rate | Channels | Measured bitrate |
| --- | --- | --- | ---: | ---: | ---: |
| aac-lc-44k1.m4a | mov,mp4,m4a | AAC / LC | 44100 Hz | 2 | 128186 bit/s |
| aac-lc-48k.m4a | mov,mp4,m4a | AAC / LC | 48000 Hz | 2 | 191903 bit/s |

The generated files used fast-start MP4 packaging and the agreed codec identifier mp4a.40.2.

## Harness diagnostics

1. The first CDP attempt reached Chromium but was rejected because Chromium 152 required an explicit remote WebSocket origin allowlist. The harness added the loopback-only origin flag.
2. With the handshake fixed, CDP commands worked and the browser target reported a fixture URL, but the target document remained about:blank.
3. An explicit CDP-created page target showed the same behavior. The page emitted Page.frameStartedNavigating for the fixture URL, then no Network events, no request reached the fixture server, and the DOM stayed empty.
4. A direct capability query on that blank target returned probably as shown above.

The browser-side HTTP request log was empty. Therefore there is no collected 200 or 206 media response, no Content-Range evidence, and no evidence about actual AAC decoding.

## Cleanup

The temporary browser, profile, fixture directory, CDP tunnel, and fixture server were stopped by the harness. A subsequent read-only check by the parent task found no SongStreamer processes or temporary listeners on the Pi; the existing kiosk Chromium process remained in place.

Further Pi SSH access and browser tests are intentionally stopped. The historical browser harness is not part of the deliverable and was removed after the user prohibited further Pi 5 testing.
