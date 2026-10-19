# Frontend integration guide

This document specifies a small, framework-agnostic browser client for the SongStreamer API running on serverpi. It covers every endpoint the client uses, the two screens (song list and player), playback with a native audio element, the timeline slider, the −10 / +10 second buttons, and complete timed-lyrics authoring/playback.

It does not add frontend source files or assume that the API serves the frontend.

## Runtime boundary and configuration

The API is a separate origin. Configure its base URL explicitly at runtime or at frontend build time:

- Local development: `http://127.0.0.1:3000`
- serverpi (Pi2) production: `https://serverpi.taild695c4.ts.net` is the provisional Funnel URL. A MacBook check currently receives DNS error 6 for this hostname, so public DNS/access is still pending. This is a deployment issue, not evidence that the API's loopback playback route is broken.

Remove trailing slashes from the configured value and build every API URL from it. Do not assume the frontend is served by the API root; a static host, Vite/webpack dev server, or another web server can host the UI independently.

```js
globalThis.__SONGSTREAMER_API_BASE_URL__ = 'http://127.0.0.1:3000';

const API_BASE = String(globalThis.__SONGSTREAMER_API_BASE_URL__ || '').replace(/\/+$/, '');
```

The client has no login or application authentication. Use ordinary CORS requests without credentials and do not add an `Authorization` header. The API defaults to `Access-Control-Allow-Origin: *`; a deployment may configure one specific origin and then returns `Vary: Origin`.

## Endpoints at a glance

| Endpoint | Used by | Purpose |
| --- | --- | --- |
| `GET /health` | Optional startup/status check | `200 {"status":"ok"}` or `503 {"status":"error"}` |
| `GET /songs` | List screen | All songs, ordered by title, artist, ID |
| `GET /songs/:id` | Player screen | One song's metadata (deep links, refresh, stale-list check) |
| `GET /songs/:id/audio` | Player screen, via `<audio src>` | The M4A stream; the browser issues the Range requests |
| `HEAD /songs/:id/audio` | Optional | Availability probe; never needed for normal playback |
| `GET /api/v1/songs/:id/lyrics` | Player screen | Complete lyrics for the exact recording, or `404 LYRICS_NOT_FOUND` |
| `PUT /api/v1/songs/:id/lyrics` | Lyrics editor | Validate and atomically replace one complete lyrics document |
| `OPTIONS /*` | Browser only | CORS preflight; the client never calls it directly |

The full server contract is in [api.md](api.md).

### Types

```ts
type Song = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number; // seconds, e.g. 306.676009
  hasLyrics: boolean;
  audioSha256: string | null;
};

type SongsResponse = { songs: Song[] };

type ApiError = { error: { code: string; message: string } };
```

The first curated item currently has ID `all-i-do-stevie-wonder`, title `All I Do`, artist `Stevie Wonder`, a null album, and duration `306.676009`.

### URL helpers

Encode the ID as one path segment. The API never returns a filesystem path; the audio URL is derived from the ID.

```js
const songsUrl = () => API_BASE + '/songs';
const songUrl = (id) => API_BASE + '/songs/' + encodeURIComponent(id);
const songAudioUrl = (id) => songUrl(id) + '/audio';
const songLyricsUrl = (id) => API_BASE + '/api/v1/songs/' + encodeURIComponent(id) + '/lyrics';
```

### JSON requests

One helper covers `/health`, `/songs` and `/songs/:id`. It surfaces the structured error code so callers can react to `SONG_NOT_FOUND`.

```js
class ApiRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function getJson(url, signal) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, mode: 'cors', signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Could not reach the server');
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Keep body null; handled below.
  }

  if (!response.ok) {
    const code = body?.error?.code ?? 'HTTP_' + response.status;
    const message = typeof body?.error?.message === 'string' ? body.error.message : 'Request failed';
    throw new ApiRequestError(response.status, code, message);
  }
  if (body === null) throw new ApiRequestError(response.status, 'INVALID_JSON', 'Invalid server response');
  return body;
}

async function loadSongs(signal) {
  const body = await getJson(songsUrl(), signal);
  if (!Array.isArray(body.songs)) throw new ApiRequestError(200, 'INVALID_SHAPE', 'Invalid song list');
  return body.songs;
}

function loadSong(id, signal) {
  return getJson(songUrl(id), signal); // throws ApiRequestError with code SONG_NOT_FOUND on 404
}

async function isHealthy() {
  try {
    const body = await getJson(API_BASE + '/health');
    return body.status === 'ok';
  } catch {
    return false;
  }
}
```

`/health` is optional. If you use it, call it once at startup or when a list request fails, to tell "server down" apart from "song missing". Do not poll it.

### Audio endpoint behavior

`GET /songs/:id/audio` returns `audio/mp4` and supports the browser's native byte-range requests:

- A normal GET returns `200` and the complete M4A; a single byte range returns `206` with `Content-Range`.
- Multiple, malformed, or unknown-unit ranges are ignored and return the complete `200`; a valid unsatisfiable range returns `416`.
- HEAD returns complete-resource headers with `200` and ignores Range.
- Missing songs or unavailable audio return a structured `404`.

Set the audio URL directly as the media element's `src`. Do not fetch the file into a Blob, implement custom range fetching, add Web Audio processing, or transcode in the browser. Seeking with the slider or the ±10 buttons works because the browser turns each seek into a Range request.

## Timed lyrics and karaoke

The public editor has no account or login. The player requests lyrics after it has loaded the song metadata. Render `404 LYRICS_NOT_FOUND` as the Add lyrics action; any other error keeps the retry action visible. `hasLyrics` is only a catalogue hint, so the player still loads the document and checks the exact recording hash.

The authoring flow is an in-memory session with no draft endpoint: find lyrics in a separate search tab, paste and preview the line text, tap line starts, then replay each line and tap its words before explicitly finishing the line end. Offer undo/redo, replay/loop, restart, previous/next, playback-rate control, and small earlier/later corrections. Text changes with matching line/word structure can preserve compatible timestamps; structural changes must confirm and clear timings only for affected lines. A cancel/leave prompt discards the session. Existing saved lyrics remain until a complete replacement succeeds.

The save request must include `schemaVersion: 1`, `songId`, the exact `audioSha256` from `GET /songs/:id` (required for hashed recordings), `language`, `reviewStatus: "complete"`, and ordered lines/words with integer millisecond timestamps. A failed `PUT` leaves the editor session available for retry. Treat `409 AUDIO_VERSION_REQUIRED` or `AUDIO_VERSION_MISMATCH` as a stale recording and reload the song before retrying.

```ts
type LyricsDocument = {
  schemaVersion: 1;
  songId: string;
  audioSha256: string | null;
  language: string;
  reviewStatus: 'complete';
  lines: Array<{
    id: string;
    text: string;
    startMs: number;
    endMs: number;
    words: Array<{ id: string; text: string; startMs: number; endMs?: number }>;
  }>;
};
```

Karaoke playback remains anchored to the same native audio element's direct `currentTime`; an animation-frame loop chooses the current line and progressively fills each word between its start and end (or the next word/line boundary). Keep the previous, current, and next lines visible on the Pi's 800×480 display.

## Screens and navigation

The UI has two screens, matching the wireframe:

```
 List screen                         Player screen
┌──────────────────────────────┐    ┌──────────────────────────────────────┐
│ ┌──────────────────────────┐ │    │ ←                                    │
│ │ O que sera               │ │    │        All I Do                      │
│ │ Willie Colon             │ │ ─► │        Stevie Wonder                 │
│ └──────────────────────────┘ │    │        (previous / current / next)   │
│ ┌──────────────────────────┐ │    │                                      │
│ │ All I Do                 │ │    │ « −10  ▶  +10 »  ──●───────── 1:12/5:06│
│ │ Stevie Wonder            │ │    └──────────────────────────────────────┘
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

Use hash routing so a reload or shared link reopens the same song without server-side routing on the static host:

| Hash | Screen |
| --- | --- |
| `#/` or empty | List screen |
| `#/songs/<encoded id>` | Player screen for that song |

```js
function parseRoute() {
  const match = location.hash.match(/^#\/songs\/([^/]+)$/);
  return match ? { screen: 'player', id: decodeURIComponent(match[1]) } : { screen: 'list' };
}

window.addEventListener('hashchange', () => renderRoute(parseRoute()));
renderRoute(parseRoute());
```

### List screen

- On entry, call `GET /songs` and show a loading state. Cache the result in memory so returning from the player does not refetch every time (refetching on each visit is also fine; the list is small).
- Render one card per song: **title** on the first line, artist on the second. Album (when not null) and duration (`m:ss`) are optional secondary text. Do not invent album text or artwork.
- Each card is a real link or button. Clicking it navigates to `#/songs/<encodeURIComponent(id)>`.
- Empty array: show "No songs yet." Error: show the safe message and a **Retry** button.
- If the player is currently playing a song, mark that card with a small "playing" indicator.

```js
function renderSongCard(song) {
  const link = document.createElement('a');
  link.className = 'song-card';
  link.href = '#/songs/' + encodeURIComponent(song.id);

  const title = document.createElement('div');
  title.className = 'song-title';
  title.textContent = song.title;

  const artist = document.createElement('div');
  artist.className = 'song-artist';
  artist.textContent = song.artist;

  link.append(title, artist);
  return link;
}
```

### Player screen

On entry with an ID:

1. Show the title and artist immediately if the song is already in the cached list; otherwise show a loading state.
2. Call `GET /songs/:id` to confirm the song still exists (always on a deep link or reload; optional when coming from a fresh list).
3. Set the single audio element's `src` to `songAudioUrl(id)` **only if it is a different song** than the one already loaded. Re-entering the screen for the song that is already playing keeps playback and position.
4. Wait for the user to press Play. Do not auto-play on route change.

On `404 SONG_NOT_FOUND`: show "This song is no longer available", clear the cached list, and offer a link back to the list.

The screen contains:

- A **back arrow** (top left, a button labelled "Back to songs") that sets `location.hash = '#/'`.
- Title and artist.
- A karaoke lyrics region with the previous, current, and next lines. Show an **Add lyrics** action when the exact recording has no saved document, and an **Edit lyrics** action when it does.
- The control bar: **−10**, **Play/Pause**, **+10**, the **timeline slider**, and elapsed / total time.

**Back arrow behavior.** Choose one and apply it consistently:

- *Keep playing (recommended):* the audio element is created once for the whole app, so leaving the player screen does not stop audio. The list marks the playing song, and tapping it returns to the player at the current position.
- *Stop on back:* call `player.pause()` before navigating.

## One native audio element

Create exactly one `HTMLAudioElement` for the whole app, outside any screen's render function, and attach its listeners once:

```js
const player = new Audio();
player.preload = 'metadata';

let loadedSongId = null;

function openSongInPlayer(song) {
  if (loadedSongId === song.id) return; // same song: keep position and play state
  loadedSongId = song.id;
  player.pause();
  player.src = songAudioUrl(song.id);
  player.load();
  resetPlayerUi(song); // title/artist, slider disabled, time 0:00 / API duration
}
```

Keep "which song is loaded" separate from "is it playing". A useful UI state:

```ts
type PlaybackPhase = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

type PlayerState = {
  loadedSongId: string | null;
  phase: PlaybackPhase;
  currentTime: number;
  actualDuration: number | null; // from player.duration once metadata arrives
  sliderPreview: number | null;  // non-null while the user drags the slider
  errorMessage: string | null;
};
```

### Play / Pause

One toggle button. Call `play()` directly inside the click handler (a user gesture) and handle the returned Promise, because browser autoplay policy can reject it with `NotAllowedError`.

```js
playButton.addEventListener('click', async () => {
  if (!loadedSongId) return;
  if (!player.paused) {
    player.pause();
    return;
  }
  if (player.ended) player.currentTime = 0;

  const songAtClick = loadedSongId;
  try {
    await player.play();
  } catch (error) {
    if (songAtClick !== loadedSongId) return; // user switched songs meanwhile
    showPlayerError(error?.name === 'NotAllowedError' ? 'Press Play to start audio' : 'Playback could not start');
  }
});
```

Update the button from media events, not from the click. That way it stays correct when playback ends or the browser pauses it.

```js
player.addEventListener('play', () => setPlayLabel('Pause'));
player.addEventListener('pause', () => setPlayLabel('Play'));
player.addEventListener('ended', () => setPlayLabel('Play'));

function setPlayLabel(label) {
  playButton.setAttribute('aria-label', label);
  playButton.dataset.state = label === 'Pause' ? 'playing' : 'paused'; // CSS swaps ▶ / ❚❚
}
```

### −10 / +10 seconds

Clamp to `0` and to the media element's actual duration, and to the seekable range when one exists.

```js
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function seekBy(seconds) {
  const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : null;
  if (duration === null || !loadedSongId) return;

  let target = clamp((Number.isFinite(player.currentTime) ? player.currentTime : 0) + seconds, 0, duration);

  if (player.seekable.length > 0) {
    const first = player.seekable.start(0);
    const last = player.seekable.end(player.seekable.length - 1);
    target = clamp(target, first, Math.min(last, duration));
  }

  player.currentTime = target;
}

backButton10.addEventListener('click', () => seekBy(-10));
forwardButton10.addEventListener('click', () => seekBy(10));
```

−10 near the start stays at `0:00`; +10 near the end stops at the end, which fires `ended`. Seeking works the same while playing or paused.

### Timeline slider

Use a native range input so it works with mouse, touch and keyboard:

```html
<label for="timeline" class="visually-hidden">Playback position</label>
<input id="timeline" type="range" min="0" max="0" step="0.01" value="0" disabled
       aria-valuetext="0:00">
<span id="elapsed">0:00</span> / <span id="total">0:00</span>
```

Rules:

- Keep it disabled until `loadedmetadata` supplies a finite, positive `player.duration`; then set `max` to it. The API `duration` is fine for the initial total label, but the media element's duration is the source of truth for `max` and seeking.
- While dragging (`input` event), store a preview value and update only the thumb and elapsed label. Do not assign `currentTime` on every `input`.
- On release (`change` event), commit the preview to `player.currentTime` and clear the preview.
- While a preview is active, ignore `timeupdate` for the slider so the media clock does not fight the user's thumb.

```js
let sliderPreview = null;

timeline.addEventListener('input', () => {
  sliderPreview = Number(timeline.value);
  renderTime(sliderPreview);
});

timeline.addEventListener('change', () => {
  if (sliderPreview !== null && Number.isFinite(player.duration)) {
    player.currentTime = clamp(sliderPreview, 0, player.duration);
  }
  sliderPreview = null;
});

for (const type of ['pointercancel', 'lostpointercapture']) {
  timeline.addEventListener(type, () => { sliderPreview = null; });
}

player.addEventListener('loadedmetadata', () => {
  if (!Number.isFinite(player.duration) || player.duration <= 0) return;
  timeline.max = String(player.duration);
  totalLabel.textContent = formatTime(player.duration);
  setSeekControlsEnabled(true); // slider, −10, +10
});

player.addEventListener('timeupdate', () => {
  if (sliderPreview === null) renderTime(player.currentTime);
});

function renderTime(seconds) {
  timeline.value = String(seconds);
  const text = formatTime(seconds);
  elapsedLabel.textContent = text;
  timeline.setAttribute('aria-valuetext', text);
}

function formatTime(value) {
  const total = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
```

Optionally draw a buffered band behind the thumb from the end of the last `player.buffered` range (update on `progress`). It only shows loading progress; the thumb is the playback position.

## Media event to UI mapping

Register these listeners once, next to where the audio element is created:

| Media event | UI action |
| --- | --- |
| `loadstart` | Show loading, clear the previous error, disable slider and ±10. |
| `loadedmetadata` | Read finite `player.duration`, set slider `max` and total label, enable slider and ±10. |
| `durationchange` | Re-read a finite duration and update `max`/label without discarding a slider preview. |
| `canplay` | Enable Play. |
| `play` / `pause` | Toggle the Play/Pause icon and label; update the list's "playing" indicator. |
| `timeupdate` | Update elapsed label and slider unless the user is dragging. |
| `progress` | Recompute the buffered band (optional). |
| `waiting` / `stalled` | Show a non-fatal "Buffering…" status. |
| `ended` | Show Play; the next Play restarts from `0:00`. |
| `error` | Show "Playback failed" with a **Retry** button that calls `player.load()`; never show raw `MediaError` details. |

## Loading and error behavior

- **List fails** (network error, non-2xx, bad JSON, missing `songs`): show the safe message and Retry. If `/health` also fails, say the server is unreachable.
- **Player: `404 SONG_NOT_FOUND`** from `/songs/:id`: the list was stale. Show a short message, clear the cached list, and link back.
- **Audio error**: keep title and artist visible, show a playback-specific Retry.
- **`play()` rejected**: a recoverable state ("Press Play to start audio"), never an uncaught exception.

Render every server string (title, artist, album, error message) with `textContent` or a framework's normal escaped text. Never concatenate API values into `innerHTML`; in React, never use `dangerouslySetInnerHTML` for them.

Do not add search, playlists, uploads, login, or account state; those are outside this API.

## Layout and accessibility checklist

- The list is a single column of full-width cards with comfortable touch targets. It is the same on desktop and mobile.
- On the player screen, keep the control bar at the bottom: buttons on the left, slider filling the remaining width, times at the end. On narrow screens the slider may wrap to its own line above the buttons, but must never cause horizontal scrolling.
- Real buttons with accessible names: "Back to songs", "Play"/"Pause", "Back 10 seconds", "Forward 10 seconds".
- The slider has a label and an `aria-valuetext` in `m:ss`.
- Announce playback status changes (Buffering, error) in an `aria-live="polite"` region.
- Move focus to the song title (or the back button) when the player screen opens, and back to the song's card when returning to the list.
- Keep visible focus rings and adequate contrast.

## Acceptance checklist

Verify on the MacBook browser test setup. No Pi5 access or testing is authorized.

- [ ] The API base URL is configurable and the frontend does not assume the API serves it.
- [ ] The list screen loads `/songs`, renders title and artist cards safely, and handles loading, empty, error and retry.
- [ ] Clicking a card opens `#/songs/<id>`; reloading that URL reopens the same song via `/songs/:id`.
- [ ] An unknown ID shows the "no longer available" state with a way back.
- [ ] The back arrow returns to the list; the chosen keep-playing or stop behavior works consistently.
- [ ] Exactly one audio element exists; reopening the current song keeps its position.
- [ ] Play/Pause toggles correctly and handles a rejected `play()`.
- [ ] −10 and +10 seek and clamp at `0:00` and the actual duration.
- [ ] The slider is disabled before metadata, uses the actual duration, supports drag and keyboard, and does not jump while dragging.
- [ ] Elapsed and total times update; buffering, ended and error states are visible.
- [ ] Audio requests use the direct audio URL with native Range requests (check DevTools for `206` responses after seeking); no Blob or full-file fetch.
- [ ] Public Funnel checks remain blocked until the serverpi hostname resolves.

This document alone does not claim any browser acceptance result. The backend contract and Pi2 loopback audio checks are recorded in [deployment-results.md](deployment-results.md).
