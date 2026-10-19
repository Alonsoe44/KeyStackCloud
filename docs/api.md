# HTTP API

The API is intentionally public and has no login or application account layer. CORS is controlled by `CORS_ORIGIN` and defaults to `*`; when a specific origin is configured, the response includes `Vary: Origin`. The service never includes `filePath` in JSON responses.

## Common errors

Errors use this shape:

```json
{"error":{"code":"SONG_NOT_FOUND","message":"Song not found"}}
```

Known errors use a 4xx status. An unexpected server failure uses `500 INTERNAL_ERROR`; its response does not include filesystem or database details.

## `GET /health`

Returns `200` when the database can execute a trivial query:

```json
{"status":"ok"}
```

Returns `503` with `{"status":"error"}` if the health query fails. The route does not reveal host paths or resource counts.

## `GET /songs`

Returns songs in deterministic title, artist, and ID order:

```json
{
  "songs": [
    {
      "id": "song-1",
      "title": "First Song",
      "artist": "The Artist",
      "album": "The Album",
      "duration": 243.52,
      "hasLyrics": false,
      "audioSha256": null
    }
  ]
}
```

`album` is either a string or `null`; `duration` is seconds. `audioSha256` is the SHA-256 of the exact published AAC-LC M4A, or `null` for a legacy recording. `hasLyrics` is true only when complete lyrics are saved for that exact recording. The response contains no relative audio path.

## `GET /songs/:id`

Returns one metadata object with the same fields as an item in `/songs`. An unknown ID returns `404 SONG_NOT_FOUND`.

## `GET /songs/:id/audio`

Returns the stored M4A representation with:

```text
Content-Type: audio/mp4
Accept-Ranges: bytes
Content-Length: <selected representation length>
ETag: "<size>-<mtime token>"
Last-Modified: <HTTP date>
Cache-Control: public, max-age=0, must-revalidate
```

The ETag is derived from the file size and filesystem modification time. Publish replacements under a new relative path/ID and avoid mutating a file while it is being served; this keeps the validator stable for the normal manual-library workflow.

`Range` is supported for a single `bytes` range on `GET`:

| Request | Response |
| --- | --- |
| no `Range` | `200`, complete file |
| `bytes=100-199` | `206`, inclusive range |
| `bytes=100-` | `206`, through the end |
| `bytes=-500` | `206`, last 500 bytes or the complete file when shorter |
| a valid range outside the file | `416`, `Content-Range: bytes */<size>` |
| multiple, malformed, or unknown-unit range | Range is ignored and the complete file is returned with `200` |

`HEAD` ignores `Range` and describes the complete selected representation with `200` and no body. `If-Range` controls whether a GET range is honored; a matching validator or sufficiently recent HTTP date permits the range, and a stale validator produces the complete `200` response. `If-None-Match` and `If-Modified-Since` can produce `304` with no body. The API exposes `Accept-Ranges`, `Content-Length`, `Content-Range`, `Content-Type`, `ETag`, and `Last-Modified` through CORS.

An unknown song or a missing, empty, non-regular, or unsafe audio file returns `404`. Relative paths are checked after resolving symlinks and must remain inside the configured audio root. The response is streamed with backpressure and aborted when the request/client closes; the complete file is never buffered in memory.

## `HEAD /songs/:id/audio`

The route returns the same representation headers as GET and no payload. It is useful for availability checks and browser media probing. `HEAD` always reports the full file length, regardless of a supplied `Range` header.

## `OPTIONS /*`

Returns `204` with the allowed methods `GET, HEAD, POST, PUT, OPTIONS` and request headers needed by browser media, import, and lyrics clients, including `Range`, `Content-Type`, `If-Range`, and conditional headers.

## Timed lyrics

Lyrics are public and do not require authentication. The editor saves only a complete document; the server never stores an in-progress draft. Both versioned paths below are supported, with `/songs/...` retained for local kiosk compatibility:

```text
GET /api/v1/songs/:id/lyrics
PUT /api/v1/songs/:id/lyrics
```

The document is versioned with `schemaVersion: 1` and is tied to the exact recording by `songId` and `audioSha256`. It contains a language, `reviewStatus: "complete"`, ordered lines, ordered words, and non-negative integer millisecond timestamps. A line has `startMs`, `endMs`, and words with `startMs` plus an optional `endMs`.

`PUT` validates line and word ordering, unique IDs, text/word agreement, line containment, audio duration bounds, and the recording hash before replacing the existing row in one SQLite transaction. A hashed recording requires the current `audioSha256`; a stale or omitted hash returns `409` (`AUDIO_VERSION_MISMATCH` or `AUDIO_VERSION_REQUIRED`). Invalid timing returns `400`, and the previous saved document remains available after a rejected request. `GET` returns `404 LYRICS_NOT_FOUND` when no complete document exists for the current recording.

Example request:

```json
{
  "schemaVersion": 1,
  "songId": "song-1",
  "audioSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "language": "en",
  "reviewStatus": "complete",
  "lines": [
    {
      "id": "line-1",
      "text": "First Song",
      "startMs": 0,
      "endMs": 2000,
      "words": [
        {"id": "line-1-word-1", "text": "First", "startMs": 0},
        {"id": "line-1-word-2", "text": "Song", "startMs": 900}
      ]
    }
  ]
}
```

## Native import

The importer has no account or authentication layer. The historical `/import/*` paths and versioned `/api/v1/import/*` aliases have the same behavior, except search, which only exists at its versioned path.

### `GET /api/v1/import/search?q=<text>`

Finds up to 10 Source Videos on YouTube so a listener can pick one to import without leaving the kiosk. The service collapses whitespace in `q`, runs one flat yt-dlp search (`ytsearch10:<q>`), and returns:

```json
{
  "sourceVideos": [
    {
      "id": "QDYfEBY9NM4",
      "url": "https://www.youtube.com/watch?v=QDYfEBY9NM4",
      "title": "Let It Be (Piano)",
      "channel": "Piano Channel",
      "durationSeconds": 243,
      "thumbnailUrl": "https://i.ytimg.com/vi/QDYfEBY9NM4/mqdefault.jpg"
    }
  ]
}
```

Live, upcoming, and post-live entries, entries without a known duration, and non-video results (channels, playlists) are left out, so the list can be shorter than 10 or empty (`200` with `[]`). `url` is the canonical watch URL accepted by `POST /import/inspect`. `channel` may be `null`. Thumbnails are YouTube-hosted; the service does not proxy them.

Errors use the usual `{ "error": { "code", "message" } }` body: `400 INVALID_QUERY` for a missing, repeated, or blank `q`; `504 SEARCH_TIMEOUT` when yt-dlp runs longer than 30 seconds (the process is killed); `502 SEARCH_FAILED` when yt-dlp fails or prints no usable JSON; `503 DEPENDENCY_UNAVAILABLE` when yt-dlp cannot start. There is intentionally no cache, concurrency limit, or query length limit; see [ADR 0006](adr/0006-youtube-search-through-yt-dlp.md).

### `POST /import/inspect`

Request:

```json
{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
```

The service validates and canonicalizes one YouTube video URL, calls yt-dlp with Node JavaScript challenge support, and returns title, artist/uploader, optional album, duration, and public format metadata. A format is compatible only when it is an audio-only unencrypted `mp4a.40.2` stream in an M4A/MP4 container. Opus, Vorbis, HE-AAC, video streams, DRM, playlists, and live/upcoming videos are rejected or marked incompatible. Stream URLs are never returned.

### `POST /import/jobs`

Request:

```json
{
  "url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "title":"All I Do",
  "artist":"Stevie Wonder",
  "album":null,
  "formatId":"140"
}
```

The response is `202` with an import job in `queued` state. The server downloads only the selected native stream, uses `-c:a copy` for an MP4-to-M4A stream copy when needed, and runs ffprobe before publication. It measures duration, codec/profile, sample rate, channels, bitrate, and bytes. The file is staged beneath the configured audio volume, renamed into `imports/` atomically, hashed, and inserted with its catalogue row in one database transaction. No row is visible while the file is incomplete or unverified. Every confirmed import receives a new song ID; the service performs no deduplication.

### `GET /import/jobs/:id` and `GET /import/jobs`

Jobs expose `queued`, `downloading`, `verifying`, `publishing`, `completed`, or `failed` status, progress, user metadata, measured audio fields, and a clear error code/message. Absolute paths and downloader stream URLs are omitted. A server restart marks unfinished jobs failed with `SERVER_RESTARTED`; it does not resume an ambiguous partial download.

### `POST /import/jobs/:id/retry`

Only failed jobs can be retried. The response is `202` with a new job ID, which starts from an empty staging directory and receives a new song ID if it completes.

### `GET /import/health`

Returns `200` when yt-dlp, ffmpeg, and ffprobe can all start, or `503` with each dependency's availability and message when one is missing. The regular `/health` route remains the small catalogue health check used by the container healthcheck.
