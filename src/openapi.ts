type OpenApiObject = Record<string, unknown>;

const schemaRef = (name: string): OpenApiObject => ({ $ref: `#/components/schemas/${name}` });

const example = (summary: string, value: unknown): OpenApiObject => ({ summary, value });

const jsonResponse = (
  description: string,
  schema: string,
  examples: Record<string, OpenApiObject> = {},
): OpenApiObject => ({
  description,
  content: {
    'application/json': {
      schema: schemaRef(schema),
      ...(Object.keys(examples).length === 0 ? {} : { examples }),
    },
  },
});

const error = (code: string, message: string): OpenApiObject => ({
  error: { code, message },
});

const errorResponse = (description: string, errors: Record<string, OpenApiObject>): OpenApiObject => ({
  description,
  content: {
    'application/json': {
      schema: schemaRef('ErrorResponse'),
      examples: errors,
    },
  },
});

const pathParameter = (name: string, exampleValue: string): OpenApiObject => ({
  name,
  in: 'path',
  required: true,
  schema: {
    type: 'string',
    minLength: 1,
    maxLength: 200,
  },
  example: exampleValue,
});

const headerParameter = (
  name: string,
  description: string,
  exampleValue: string,
): OpenApiObject => ({
  name,
  in: 'header',
  required: false,
  description,
  schema: { type: 'string' },
  example: exampleValue,
});

const jsonRequestBody = (schema: string, examples: Record<string, OpenApiObject>): OpenApiObject => ({
  required: true,
  content: {
    'application/json': {
      schema: schemaRef(schema),
      examples,
    },
  },
});

const textResponse = (description: string, mediaType: string): OpenApiObject => ({
  description,
  content: {
    [mediaType]: {
      schema: { type: 'string' },
    },
  },
});

const audioResponseHeaders = (contentRange = false): OpenApiObject => ({
  'Accept-Ranges': { $ref: '#/components/headers/AcceptRanges' },
  'Content-Length': { $ref: '#/components/headers/ContentLength' },
  'Content-Type': { $ref: '#/components/headers/ContentTypeAudio' },
  ETag: { $ref: '#/components/headers/ETag' },
  'Last-Modified': { $ref: '#/components/headers/LastModified' },
  'Cache-Control': { $ref: '#/components/headers/CacheControl' },
  'Access-Control-Allow-Origin': { $ref: '#/components/headers/AccessControlAllowOrigin' },
  'Access-Control-Expose-Headers': { $ref: '#/components/headers/AccessControlExposeHeaders' },
  Vary: { $ref: '#/components/headers/VaryOrigin' },
  ...(contentRange ? { 'Content-Range': { $ref: '#/components/headers/ContentRange' } } : {}),
});

const audioParameters = [
  pathParameter('id', 'song-1'),
  headerParameter('Range', 'A single byte range such as bytes=100-199, bytes=100-, or bytes=-500. Multiple, malformed, or unknown-unit ranges are ignored and return the complete representation. GET only.', 'bytes=0-1023'),
  headerParameter('If-Range', 'A matching ETag or sufficiently recent HTTP date allows a GET range; a stale validator returns the complete representation. Ignored for HEAD.', '"1a-65a8b2c1"'),
  headerParameter('If-None-Match', 'A matching ETag returns 304 without a body.', '"1a-65a8b2c1"'),
  headerParameter('If-Modified-Since', 'A date at or after the recording modification time returns 304 when If-None-Match is absent.', 'Wed, 21 Oct 2026 10:00:00 GMT'),
];

const songId = pathParameter('id', 'song-1');
const jobId = pathParameter('id', '7e4c5f6a-9b2d-4c8e-a1f0-123456789abc');

const hash = 'a'.repeat(64);
const songExample = {
  id: 'song-1',
  title: 'First Song',
  artist: 'The Artist',
  album: 'The Album',
  duration: 243.52,
  hasLyrics: true,
  audioSha256: hash,
};

const lyricsPayloadExample = {
  schemaVersion: 1,
  language: 'en',
  lines: [
    {
      text: 'First Song',
      startMs: 0,
      endMs: 2000,
      words: [
        { text: 'First', startMs: 0 },
        { text: 'Song', startMs: 900, endMs: null },
      ],
    },
  ],
};

const hashedLyricsPayloadExample = {
  ...lyricsPayloadExample,
  songId: 'song-1',
  audioSha256: hash,
  reviewStatus: 'complete',
};

const lyricsDocumentExample = {
  schemaVersion: 1,
  songId: 'song-1',
  audioSha256: hash,
  language: 'en',
  reviewStatus: 'complete',
  lines: [
    {
      id: 'line-1',
      text: 'First Song',
      startMs: 0,
      endMs: 2000,
      words: [
        { id: 'line-1-word-1', text: 'First', startMs: 0 },
        { id: 'line-1-word-2', text: 'Song', startMs: 900, endMs: 2000 },
      ],
    },
  ],
  documentVersion: 1,
  createdAt: '2026-10-21T10:00:00.000Z',
  updatedAt: '2026-10-21T10:00:00.000Z',
};

const queuedJobExample = {
  id: '7e4c5f6a-9b2d-4c8e-a1f0-123456789abc',
  title: 'All I Do',
  artist: 'Stevie Wonder',
  album: null,
  formatId: '140',
  status: 'queued',
  progress: 0,
  errorCode: null,
  errorMessage: null,
  songId: null,
  sourceVideoId: null,
  sourceTitle: null,
  sourceArtist: null,
  measuredDuration: null,
  sampleRateHz: null,
  channels: null,
  bitrateBitsPerSecond: null,
  bytes: null,
  createdAt: '2026-10-21T10:00:00.000Z',
  startedAt: null,
  completedAt: null,
  updatedAt: '2026-10-21T10:00:00.000Z',
};

const completedJobExample = {
  ...queuedJobExample,
  status: 'completed',
  progress: 100,
  songId: 'import-2d1a6b4b-8d52-4b6e-b9e5-12f48b23b5f2',
  sourceVideoId: 'dQw4w9WgXcQ',
  sourceTitle: 'All I Do',
  sourceArtist: 'Stevie Wonder',
  measuredDuration: 243.52,
  sampleRateHz: 44100,
  channels: 2,
  bitrateBitsPerSecond: 128000,
  bytes: 4961487,
  startedAt: '2026-10-21T10:00:01.000Z',
  completedAt: '2026-10-21T10:01:12.000Z',
  updatedAt: '2026-10-21T10:01:12.000Z',
};

const failedJobExample = {
  ...queuedJobExample,
  status: 'failed',
  progress: 100,
  errorCode: 'VERIFICATION_FAILED',
  errorMessage: 'ffprobe returned invalid metadata for the artifact.',
  startedAt: '2026-10-21T10:00:01.000Z',
  completedAt: '2026-10-21T10:00:03.000Z',
  updatedAt: '2026-10-21T10:00:03.000Z',
};

const sourceVideoExample = {
  id: 'QDYfEBY9NM4',
  url: 'https://www.youtube.com/watch?v=QDYfEBY9NM4',
  title: 'Let It Be (Piano)',
  channel: 'Piano Channel',
  durationSeconds: 243,
  thumbnailUrl: 'https://i.ytimg.com/vi/QDYfEBY9NM4/mqdefault.jpg',
};

const inspectionExample = {
  id: 'dQw4w9WgXcQ',
  title: 'All I Do',
  artist: 'Stevie Wonder',
  album: null,
  duration: 243.52,
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
  webpageUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  formats: [
    {
      formatId: '140',
      ext: 'm4a',
      acodec: 'mp4a.40.2',
      vcodec: 'none',
      abr: 128,
      asr: 44100,
      audioChannels: 2,
      filesize: 4961487,
      protocol: 'https',
      compatible: true,
      rejectionReason: null,
    },
    {
      formatId: '251',
      ext: 'webm',
      acodec: 'opus',
      vcodec: 'none',
      abr: 160,
      asr: 48000,
      audioChannels: 2,
      filesize: null,
      protocol: 'https',
      compatible: false,
      rejectionReason: 'container is not M4A/MP4',
    },
  ],
  compatibleFormats: [
    {
      formatId: '140',
      ext: 'm4a',
      acodec: 'mp4a.40.2',
      vcodec: 'none',
      abr: 128,
      asr: 44100,
      audioChannels: 2,
      filesize: 4961487,
      protocol: 'https',
      compatible: true,
      rejectionReason: null,
    },
  ],
  recommendedFormatId: '140',
  hasCompatible: true,
  policyMessage: 'Selected the highest-quality native AAC-LC stream provided by YouTube.',
};

const dependencyReadyExample = {
  ready: true,
  items: {
    yt_dlp: { available: true, message: 'yt_dlp is ready.' },
    ffmpeg: { available: true, message: 'ffmpeg is ready.' },
    ffprobe: { available: true, message: 'ffprobe is ready.' },
  },
};

const dependencyUnavailableExample = {
  ready: false,
  items: {
    yt_dlp: { available: false, message: 'yt_dlp could not be started.' },
    ffmpeg: { available: true, message: 'ffmpeg is ready.' },
    ffprobe: { available: true, message: 'ffprobe is ready.' },
  },
};

const errors = {
  invalidQuery: example('Invalid search query', error('INVALID_QUERY', 'Enter a song or artist to search for.')),
  invalidUrl: example('Invalid YouTube URL', error('INVALID_URL', 'Enter a single http(s) YouTube video URL.')),
  invalidMetadata: example('Missing metadata', error('INVALID_METADATA', 'title is required.')),
  invalidFormat: example('Invalid format identifier', error('INVALID_FORMAT', 'The selected format identifier is invalid.')),
  unsupportedLyricsVersion: example('Unsupported lyrics version', error('UNSUPPORTED_LYRICS_VERSION', 'Only lyrics schema version 1 is supported.')),
  invalidLyricsStatus: example('Incomplete lyrics are rejected', error('INVALID_LYRICS_STATUS', 'Only complete lyrics can be saved.')),
  songNotFound: example('Song not found', error('SONG_NOT_FOUND', 'Song not found')),
  audioNotFound: example('Audio is not available', error('AUDIO_NOT_FOUND', 'Song audio is not available')),
  lyricsNotFound: example('Lyrics not found', error('LYRICS_NOT_FOUND', 'Complete lyrics are not available for this recording')),
  invalidLyrics: example('Invalid lyrics', error('INVALID_LYRICS', 'Lyrics must contain between 1 and 2000 lines.')),
  nonMonotonic: example('Non-monotonic timestamps', error('NON_MONOTONIC_TIMESTAMPS', 'Line timestamps must be monotonic.')),
  audioVersionRequired: example('Current audio hash is required', error('AUDIO_VERSION_REQUIRED', 'Save the timing against the current recording hash.')),
  audioVersionMismatch: example('Audio hash does not match', error('AUDIO_VERSION_MISMATCH', 'Lyrics belong to a different audio recording.')),
  lyricsSongMismatch: example('Song ID does not match', error('LYRICS_SONG_MISMATCH', 'Lyrics songId does not match the requested song.')),
  jobNotFound: example('Import job not found', error('JOB_NOT_FOUND', 'Import job not found')),
  jobNotRetryable: example('Job cannot be retried', error('JOB_NOT_RETRYABLE', 'Only failed imports can be retried.')),
  dependencyUnavailable: example('Dependency unavailable', error('DEPENDENCY_UNAVAILABLE', 'yt-dlp could not be started.')),
  searchFailed: example('Search failed', error('SEARCH_FAILED', 'yt-dlp returned no usable search results.')),
  searchTimeout: example('Search timed out', error('SEARCH_TIMEOUT', 'YouTube search took too long. Try again.')),
  playlistUnsupported: example('Playlist is not supported', error('PLAYLIST_UNSUPPORTED', 'A single YouTube video is required; playlists are not supported.')),
  liveVideoUnsupported: example('Live video is not supported', error('LIVE_VIDEO_UNSUPPORTED', 'Live and upcoming videos are not supported; choose a prerecorded video.')),
  inspectionInvalidResponse: example('Invalid inspection output', error('INSPECTION_INVALID_RESPONSE', 'yt-dlp returned no usable video metadata.')),
  lyricsStorageInvalid: example('Stored lyrics are invalid', error('LYRICS_STORAGE_INVALID', 'Stored lyrics could not be decoded.')),
  lyricsStorageFailed: example('Lyrics storage failed', error('LYRICS_STORAGE_FAILED', 'Lyrics were not available after saving.')),
  internal: example('Unexpected server failure', error('INTERNAL_ERROR', 'Internal server error')),
};

const audioFullResponse = {
  description: 'Complete AAC-LC M4A representation. GET returns the bytes; HEAD returns these headers with no body and always describes the complete representation, even when Range is supplied.',
  headers: audioResponseHeaders(),
  content: {
    'audio/mp4': {
      schema: { type: 'string', format: 'binary' },
    },
  },
};

const audioPartialResponse = {
  description: 'A single satisfiable byte range from a GET request.',
  headers: audioResponseHeaders(true),
  content: {
    'audio/mp4': {
      schema: { type: 'string', format: 'binary' },
    },
  },
};

const audioHeadResponse = {
  description: 'Complete AAC-LC M4A representation headers. HEAD has no body and always describes the complete representation, even when Range is supplied.',
  headers: audioResponseHeaders(),
};

const audioNotModifiedResponse = {
  description: 'The selected audio representation has not changed. The response has no body.',
  headers: audioResponseHeaders(),
};

const audioRangeNotSatisfiableResponse = {
  description: 'The requested single byte range cannot be satisfied.',
  headers: {
    ...audioResponseHeaders(),
    'Content-Range': { $ref: '#/components/headers/UnsatisfiableContentRange' },
  },
};

const audioNotFoundResponse = errorResponse('The song or its playable audio file is not available.', {
  songNotFound: errors.songNotFound,
  audioNotFound: errors.audioNotFound,
});

const songNotFoundResponse = errorResponse('The requested song does not exist.', {
  songNotFound: errors.songNotFound,
});

const lyricsNotFoundResponse = errorResponse('The song or its complete lyrics does not exist for the current recording.', {
  songNotFound: errors.songNotFound,
  lyricsNotFound: errors.lyricsNotFound,
});

const paths: Record<string, OpenApiObject> = {
  '/health': {
    get: {
      operationId: 'getHealth',
      tags: ['Health'],
      summary: 'Check catalogue database health',
      description: 'Public, unauthenticated health check. It runs a trivial SQLite query and does not expose host paths or resource counts.',
      responses: {
        '200': jsonResponse('The database is healthy.', 'HealthOk', {
          ok: example('Healthy', { status: 'ok' }),
        }),
        '503': jsonResponse('The database health query failed.', 'HealthError', {
          unavailable: example('Unavailable', { status: 'error' }),
        }),
      },
    },
  },
  '/songs': {
    get: {
      operationId: 'listSongs',
      tags: ['Library'],
      summary: 'List public songs',
      description: 'Returns songs in deterministic title, artist, and ID order. Filesystem paths are intentionally omitted.',
      responses: {
        '200': jsonResponse('The public song list.', 'SongList', {
          songs: example('Song list', { songs: [songExample] }),
        }),
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
  },
  '/songs/{id}': {
    get: {
      operationId: 'getSong',
      tags: ['Library'],
      summary: 'Get one public song',
      parameters: [songId],
      responses: {
        '200': jsonResponse('The public song metadata.', 'Song', {
          song: example('Song metadata', songExample),
        }),
        '404': songNotFoundResponse,
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
  },
  '/songs/{id}/audio': {
    get: {
      operationId: 'getSongAudio',
      tags: ['Audio'],
      summary: 'Stream a song recording',
      description: 'Streams the stored native AAC-LC M4A with backpressure. Supports one GET byte range, If-Range, If-None-Match, and If-Modified-Since. Multiple, malformed, or unknown-unit ranges are ignored and return 200; an unsatisfiable single range returns 416. CORS exposes the audio validators and range headers listed below.',
      parameters: audioParameters,
      responses: {
        '200': audioFullResponse,
        '206': audioPartialResponse,
        '304': audioNotModifiedResponse,
        '416': audioRangeNotSatisfiableResponse,
        '404': audioNotFoundResponse,
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
    head: {
      operationId: 'headSongAudio',
      tags: ['Audio'],
      summary: 'Inspect song recording headers',
      description: 'Returns the same selected-representation headers as GET with no payload. HEAD ignores Range and If-Range and always describes the complete recording; conditional headers may still produce 304.',
      parameters: audioParameters,
      responses: {
        '200': {
          ...audioHeadResponse,
        },
        '304': audioNotModifiedResponse,
        '404': audioNotFoundResponse,
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
  },
  '/api/v1/import/search': {
    get: {
      operationId: 'searchImportSources',
      tags: ['Import'],
      summary: 'Search for Source Videos',
      description: 'Public search through one flat yt-dlp YouTube search. Whitespace is collapsed, at most 10 playable prerecorded videos are returned, and live, upcoming, unknown-duration, and non-video results are omitted. The legacy /import/search alias intentionally does not exist.',
      parameters: [
        {
          name: 'q',
          in: 'query',
          required: true,
          description: 'Song or artist text. Repeated, missing, or blank values are rejected.',
          schema: { type: 'string', minLength: 1 },
          example: 'let it be piano',
        },
      ],
      responses: {
        '200': jsonResponse('Up to 10 playable Source Videos.', 'SourceVideoList', {
          results: example('Search results', { sourceVideos: [sourceVideoExample] }),
        }),
        '400': errorResponse('The query is missing, repeated, or blank.', { invalidQuery: errors.invalidQuery }),
        '502': errorResponse('yt-dlp failed or returned unusable search output.', { searchFailed: errors.searchFailed }),
        '503': errorResponse('yt-dlp could not be started.', { dependencyUnavailable: errors.dependencyUnavailable }),
        '504': errorResponse('The 30-second search timeout elapsed.', { searchTimeout: errors.searchTimeout }),
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
  },
  '/*': {
    options: {
      operationId: 'corsPreflight',
      tags: ['CORS'],
      summary: 'Handle public CORS preflight',
      description: 'The catch-all OPTIONS route is public and returns the same fixed method and request-header allow lists for browser catalogue, audio, import, and lyrics clients. It does not echo the requested method or headers.',
      responses: {
        '204': {
          description: 'Preflight accepted with no body.',
          headers: {
            'Access-Control-Allow-Origin': { $ref: '#/components/headers/AccessControlAllowOrigin' },
            'Access-Control-Allow-Methods': { $ref: '#/components/headers/AccessControlAllowMethods' },
            'Access-Control-Allow-Headers': { $ref: '#/components/headers/AccessControlAllowHeaders' },
            'Access-Control-Expose-Headers': { $ref: '#/components/headers/AccessControlExposeHeaders' },
            Vary: { $ref: '#/components/headers/VaryOrigin' },
          },
        },
      },
      'x-fastify-route': '/*',
    },
  },
};

paths['/docs'] = {
  get: {
    operationId: 'redirectDocs',
    tags: ['Docs'],
    summary: 'Redirect to the interactive API reference',
    responses: {
      '301': {
        description: 'The reference has a trailing slash.',
        headers: { Location: { schema: { type: 'string', example: '/docs/' } } },
      },
    },
  },
};

paths['/docs/'] = {
  get: {
    operationId: 'getDocsReference',
    tags: ['Docs'],
    summary: 'Serve the interactive API reference',
    description: 'Self-hosted Scalar HTML. The page loads the bundled browser asset from this application origin and reads the local OpenAPI JSON endpoint.',
    responses: {
      '200': textResponse('The interactive API reference HTML.', 'text/html'),
    },
  },
};

paths['/docs/openapi.json'] = {
  get: {
    operationId: 'getOpenApiJson',
    tags: ['Docs'],
    summary: 'Get the OpenAPI document as JSON',
    responses: {
      '200': jsonResponse('The embedded OpenAPI document.', 'OpenApiDocument'),
    },
  },
};

paths['/docs/openapi.yaml'] = {
  get: {
    operationId: 'getOpenApiYaml',
    tags: ['Docs'],
    summary: 'Get the OpenAPI document as YAML',
    responses: {
      '200': textResponse('The embedded OpenAPI document in YAML.', 'application/yaml'),
    },
  },
};

paths['/docs/js/scalar.js'] = {
  get: {
    operationId: 'getScalarBrowserBundle',
    tags: ['Docs'],
    summary: 'Get the pinned Scalar browser bundle',
    responses: {
      '200': textResponse('The locally bundled Scalar browser JavaScript.', 'application/javascript'),
    },
  },
};

for (const prefix of ['/import', '/api/v1/import']) {
  paths[`${prefix}/health`] = {
    get: {
      operationId: `${prefix === '/import' ? 'getLegacy' : 'getVersioned'}ImportHealth`,
      tags: ['Import'],
      summary: 'Check importer dependencies',
      description: 'Public dependency check for yt-dlp, ffmpeg, and ffprobe. A missing dependency is reported in the response without exposing host paths.',
      responses: {
        '200': jsonResponse('All importer dependencies can start.', 'ImportDependencyStatus', {
          ready: example('Ready', dependencyReadyExample),
        }),
        '503': jsonResponse('At least one importer dependency is unavailable.', 'ImportDependencyStatus', {
          unavailable: example('Unavailable', dependencyUnavailableExample),
        }),
      },
    },
  };
  paths[`${prefix}/inspect`] = {
    post: {
      operationId: `${prefix === '/import' ? 'inspectLegacy' : 'inspectVersioned'}Import`,
      tags: ['Import'],
      summary: 'Inspect one YouTube video and its formats',
      description: 'Validates and canonicalizes one YouTube video URL, then returns editable metadata and public format metadata. Only audio-only, unencrypted AAC-LC (mp4a.40.2) in M4A/MP4 is compatible. Stream URLs are never returned.',
      requestBody: jsonRequestBody('ImportInspectRequest', {
        video: example('YouTube video URL', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      }),
      responses: {
        '200': jsonResponse('Video metadata and format choices.', 'ImportInspection', {
          inspection: example('Inspection result', inspectionExample),
        }),
        '400': errorResponse('The URL is invalid.', { invalidUrl: errors.invalidUrl }),
        '422': errorResponse('The URL identifies a playlist, live, or upcoming video.', {
          playlistUnsupported: errors.playlistUnsupported,
          liveVideoUnsupported: errors.liveVideoUnsupported,
        }),
        '502': errorResponse('yt-dlp failed or returned unusable metadata.', {
          failed: example('Inspection failed', error('INSPECTION_FAILED', 'yt-dlp failed while inspecting the video.')),
          invalidResponse: errors.inspectionInvalidResponse,
        }),
        '503': errorResponse('yt-dlp could not be started.', { dependencyUnavailable: errors.dependencyUnavailable }),
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
  };
  paths[`${prefix}/jobs`] = {
    get: {
      operationId: `${prefix === '/import' ? 'listLegacy' : 'listVersioned'}ImportJobs`,
      tags: ['Import'],
      summary: 'List recent import jobs',
      description: 'Returns up to the 50 most recent jobs, newest first. Jobs expose measured metadata and public error codes/messages but never absolute paths or downloader stream URLs.',
      responses: {
        '200': jsonResponse('Recent import jobs.', 'ImportJobList', {
          jobs: example('Queued job', { jobs: [queuedJobExample] }),
        }),
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
    post: {
      operationId: `${prefix === '/import' ? 'createLegacy' : 'createVersioned'}ImportJob`,
      tags: ['Import'],
      summary: 'Queue a confirmed native AAC-LC import',
      description: 'Validates the canonical YouTube URL, edited title/artist/album, and selected compatible format ID, then queues a job. The response is returned before the asynchronous worker finishes. format_id is accepted as a legacy alias for formatId.',
      requestBody: jsonRequestBody('CreateImportRequest', {
        camelCase: example('Confirmed import', {
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'All I Do',
          artist: 'Stevie Wonder',
          album: null,
          formatId: '140',
        }),
        snakeCaseAlias: example('Legacy format_id alias', {
          url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          title: 'All I Do',
          artist: 'Stevie Wonder',
          album: null,
          format_id: '140',
        }),
      }),
      responses: {
        '202': jsonResponse('The import job was queued.', 'ImportJob', {
          queued: example('Queued', queuedJobExample),
        }),
        '400': errorResponse('The URL, editable metadata, or format identifier is invalid.', {
          invalidUrl: errors.invalidUrl,
          invalidMetadata: errors.invalidMetadata,
          invalidFormat: errors.invalidFormat,
        }),
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
  };
  paths[`${prefix}/jobs/{id}`] = {
    get: {
      operationId: `${prefix === '/import' ? 'getLegacy' : 'getVersioned'}ImportJob`,
      tags: ['Import'],
      summary: 'Get one import job',
      parameters: [jobId],
      responses: {
        '200': jsonResponse('The current public import job state.', 'ImportJob', {
          queued: example('Queued', queuedJobExample),
          completed: example('Completed', completedJobExample),
          failed: example('Failed', failedJobExample),
        }),
        '404': errorResponse('The import job does not exist.', { jobNotFound: errors.jobNotFound }),
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
  };
  paths[`${prefix}/jobs/{id}/retry`] = {
    post: {
      operationId: `${prefix === '/import' ? 'retryLegacy' : 'retryVersioned'}ImportJob`,
      tags: ['Import'],
      summary: 'Retry a failed import',
      description: 'Only a failed job can be retried. A new queued job ID is returned and the retry starts from an empty staging directory.',
      parameters: [jobId],
      responses: {
        '202': jsonResponse('A new retry job was queued.', 'ImportJob', {
          queued: example('Retry queued', queuedJobExample),
        }),
        '404': errorResponse('The import job does not exist.', { jobNotFound: errors.jobNotFound }),
        '409': errorResponse('The existing job is not failed and cannot be retried.', { jobNotRetryable: errors.jobNotRetryable }),
        '500': errorResponse('Unexpected server failure.', { internal: errors.internal }),
      },
    },
  };
}

function lyricsPath(versioned: boolean): OpenApiObject {
  const prefix = versioned ? '/api/v1/songs' : '/songs';
  return {
    get: {
      operationId: `${versioned ? 'getVersioned' : 'getLegacy'}SongLyrics`,
      tags: ['Lyrics'],
      summary: 'Get complete lyrics for the current recording',
      description: versioned
        ? 'Returns only a complete lyrics document whose audioSha256 matches the song’s current exact recording hash. This versioned path is the canonical public contract.'
        : 'Returns only a complete lyrics document whose audioSha256 matches the song’s current exact recording hash. This short path is retained for local kiosk compatibility.',
      parameters: [songId],
      responses: {
        '200': jsonResponse('The complete, recording-specific lyrics document.', 'LyricsDocument', {
          lyrics: example('Timed lyrics', lyricsDocumentExample),
        }),
        '404': lyricsNotFoundResponse,
        '500': errorResponse('Stored lyrics could not be decoded.', {
          lyricsStorageInvalid: errors.lyricsStorageInvalid,
          internal: errors.internal,
        }),
      },
    },
    put: {
      operationId: `${versioned ? 'replaceVersioned' : 'replaceLegacy'}SongLyrics`,
      tags: ['Lyrics'],
      summary: 'Replace complete lyrics atomically',
      description: versioned
        ? 'Validates and atomically replaces complete, recording-specific lyrics. A hashed recording requires the current audioSha256 and replacement is atomic.'
        : 'Validates and atomically replaces complete, recording-specific lyrics. This short path is a compatibility alias.',
      parameters: [songId],
      requestBody: jsonRequestBody('LyricsPayload', {
        legacyMinimal: example('Legacy minimal payload', lyricsPayloadExample),
        hashedRecording: example('Recording-bound payload', hashedLyricsPayloadExample),
      }),
      responses: {
        '200': jsonResponse('The normalized, atomically saved lyrics document.', 'LyricsDocument', {
          saved: example('Saved lyrics', lyricsDocumentExample),
        }),
        '400': errorResponse('The document is invalid.', {
          invalidLyrics: errors.invalidLyrics,
          nonMonotonic: errors.nonMonotonic,
          unsupportedLyricsVersion: errors.unsupportedLyricsVersion,
          invalidLyricsStatus: errors.invalidLyricsStatus,
        }),
        '404': songNotFoundResponse,
        '409': errorResponse('The payload is tied to a different recording or song.', {
          audioVersionRequired: errors.audioVersionRequired,
          audioVersionMismatch: errors.audioVersionMismatch,
          lyricsSongMismatch: errors.lyricsSongMismatch,
        }),
        '500': errorResponse('Lyrics storage failed.', {
          lyricsStorageInvalid: errors.lyricsStorageInvalid,
          lyricsStorageFailed: errors.lyricsStorageFailed,
          internal: errors.internal,
        }),
      },
    },
  };
}

// Keep the canonical versioned path and its historical short alias as two
// explicit assignments so a later alias cannot overwrite a versioned entry.
paths['/api/v1/songs/{id}/lyrics'] = lyricsPath(true);
paths['/songs/{id}/lyrics'] = lyricsPath(false);

const sharedSchemas: Record<string, OpenApiObject> = {
  OpenApiDocument: {
    type: 'object',
    description: 'The embedded OpenAPI 3.0.3 document served by the documentation utility endpoint.',
  },
  ErrorResponse: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: 'SONG_NOT_FOUND' },
          message: { type: 'string', example: 'Song not found' },
        },
      },
    },
  },
  HealthOk: {
    type: 'object',
    required: ['status'],
    properties: { status: { type: 'string', enum: ['ok'] } },
  },
  HealthError: {
    type: 'object',
    required: ['status'],
    properties: { status: { type: 'string', enum: ['error'] } },
  },
  Song: {
    type: 'object',
    required: ['id', 'title', 'artist', 'album', 'duration', 'hasLyrics', 'audioSha256'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, example: 'song-1' },
      title: { type: 'string', minLength: 1, maxLength: 500, example: 'First Song' },
      artist: { type: 'string', minLength: 1, maxLength: 500, example: 'The Artist' },
      album: { type: 'string', nullable: true, minLength: 1, maxLength: 500, example: 'The Album' },
      duration: { type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 86400, example: 243.52 },
      hasLyrics: { type: 'boolean', example: true },
      audioSha256: { type: 'string', nullable: true, pattern: '^[a-fA-F0-9]{64}$', example: hash },
    },
  },
  SongList: {
    type: 'object',
    required: ['songs'],
    properties: {
      songs: { type: 'array', items: schemaRef('Song') },
    },
  },
  LyricWordInput: {
    type: 'object',
    required: ['text', 'startMs'],
    description: 'Input word. id is optional and is generated as line-N-word-M when omitted. endMs may be omitted or null; both normalize to an omitted output property.',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'Optional client ID; word IDs must be unique across the complete document.' },
      text: { type: 'string', minLength: 1, maxLength: 500, description: 'Trimmed, non-empty text.' },
      startMs: { type: 'integer', minimum: 0, description: 'Non-negative timestamp in milliseconds, within the containing line.' },
      endMs: { type: 'integer', minimum: 0, nullable: true, description: 'Optional exclusive end timestamp in milliseconds. null is treated like omission.' },
    },
  },
  LyricLineInput: {
    type: 'object',
    required: ['text', 'startMs', 'endMs', 'words'],
    description: 'Input line. id is optional and is generated as line-N when omitted. Lines must be ordered, non-overlapping, and have text equal to the whitespace-normalized words joined by single spaces.',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200, description: 'Optional client ID; line IDs must be unique.' },
      text: { type: 'string', minLength: 1, maxLength: 4000, description: 'Trimmed, non-empty line text.' },
      startMs: { type: 'integer', minimum: 0, description: 'Non-negative timestamp in milliseconds.' },
      endMs: { type: 'integer', minimum: 0, description: 'Exclusive line end; must be greater than startMs.' },
      words: { type: 'array', minItems: 1, maxItems: 300, items: schemaRef('LyricWordInput') },
    },
  },
  LyricWord: {
    type: 'object',
    required: ['id', 'text', 'startMs'],
    description: 'Normalized output word. The server always supplies id; endMs is omitted when the input omitted it or supplied null.',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200 },
      text: { type: 'string', minLength: 1, maxLength: 500 },
      startMs: { type: 'integer', minimum: 0, description: 'Non-negative timestamp in milliseconds.' },
      endMs: { type: 'integer', minimum: 0, description: 'Optional exclusive end timestamp in milliseconds.' },
    },
  },
  LyricLine: {
    type: 'object',
    required: ['id', 'text', 'startMs', 'endMs', 'words'],
    description: 'Normalized output line. The server always supplies id and preserves the validated line and word order.',
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200 },
      text: { type: 'string', minLength: 1, maxLength: 4000 },
      startMs: { type: 'integer', minimum: 0 },
      endMs: { type: 'integer', minimum: 0 },
      words: { type: 'array', minItems: 1, maxItems: 300, items: schemaRef('LyricWord') },
    },
  },
  LyricsPayload: {
    type: 'object',
    required: ['schemaVersion', 'language', 'lines'],
    description: 'Input for a complete lyrics replacement. songId, audioSha256, and reviewStatus are optional at the wire level: songId defaults to the path ID, reviewStatus defaults to complete, and a hashed recording still requires its current audioSha256. Lines must be ordered and non-overlapping; line and word IDs are unique; text is non-empty and must match the whitespace-normalized words; there are 1-2000 lines, 1-300 words per line, and a 200,000-character total text limit. Every line endMs must be no later than ceil(song duration in seconds * 1000) + 1000 ms, allowing a one-second duration tolerance.',
    properties: {
      schemaVersion: { type: 'integer', enum: [1], description: 'Only schema version 1 is accepted.' },
      songId: { type: 'string', minLength: 1, maxLength: 200, description: 'Optional; when present it must match the path song ID.' },
      audioSha256: { type: 'string', nullable: true, pattern: '^[a-fA-F0-9]{64}$', description: 'Optional at the wire level. For a recording with a current hash, the exact current 64-hex SHA-256 is required; omission or null returns AUDIO_VERSION_REQUIRED or AUDIO_VERSION_MISMATCH. null is valid for a legacy unhashed recording.' },
      language: { type: 'string', minLength: 1, maxLength: 32, example: 'en' },
      reviewStatus: { type: 'string', enum: ['complete'], description: 'Optional; omitted input is normalized to complete. Any other value returns INVALID_LYRICS_STATUS.' },
      lines: { type: 'array', minItems: 1, maxItems: 2000, items: schemaRef('LyricLineInput') },
    },
  },
  LyricsDocument: {
    type: 'object',
    required: ['schemaVersion', 'songId', 'audioSha256', 'language', 'reviewStatus', 'lines', 'documentVersion', 'createdAt', 'updatedAt'],
    description: 'Normalized, persisted lyrics output. It always includes songId, audioSha256 (a 64-hex recording hash or null for a legacy recording), reviewStatus, generated IDs when needed, and document timestamps/version.',
    properties: {
      schemaVersion: { type: 'integer', enum: [1] },
      songId: { type: 'string', minLength: 1, maxLength: 200 },
      audioSha256: { type: 'string', nullable: true, pattern: '^[a-fA-F0-9]{64}$' },
      language: { type: 'string', minLength: 1, maxLength: 32 },
      reviewStatus: { type: 'string', enum: ['complete'] },
      lines: { type: 'array', minItems: 1, maxItems: 2000, items: schemaRef('LyricLine') },
      documentVersion: { type: 'integer', minimum: 1 },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  SourceVideo: {
    type: 'object',
    required: ['id', 'url', 'title', 'channel', 'durationSeconds', 'thumbnailUrl'],
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$', example: 'QDYfEBY9NM4' },
      url: { type: 'string', format: 'uri', example: sourceVideoExample.url },
      title: { type: 'string', minLength: 1, example: sourceVideoExample.title },
      channel: { type: 'string', nullable: true, example: sourceVideoExample.channel },
      durationSeconds: { type: 'integer', minimum: 1, nullable: true, example: sourceVideoExample.durationSeconds },
      thumbnailUrl: { type: 'string', format: 'uri', example: sourceVideoExample.thumbnailUrl },
    },
  },
  SourceVideoList: {
    type: 'object',
    required: ['sourceVideos'],
    properties: {
      sourceVideos: { type: 'array', maxItems: 10, items: schemaRef('SourceVideo') },
    },
  },
  ImportFormat: {
    type: 'object',
    required: ['formatId', 'ext', 'acodec', 'vcodec', 'abr', 'asr', 'audioChannels', 'filesize', 'protocol', 'compatible', 'rejectionReason'],
    properties: {
      formatId: { type: 'string', example: '140' },
      ext: { type: 'string', example: 'm4a' },
      acodec: { type: 'string', example: 'mp4a.40.2' },
      vcodec: { type: 'string', example: 'none' },
      abr: { type: 'number', nullable: true, example: 128 },
      asr: { type: 'integer', nullable: true, example: 44100 },
      audioChannels: { type: 'integer', nullable: true, example: 2 },
      filesize: { type: 'integer', minimum: 0, nullable: true, example: 4961487 },
      protocol: { type: 'string', nullable: true, example: 'https' },
      compatible: { type: 'boolean', example: true },
      rejectionReason: { type: 'string', nullable: true, example: null },
    },
  },
  ImportInspection: {
    type: 'object',
    required: ['id', 'title', 'artist', 'album', 'duration', 'thumbnail', 'webpageUrl', 'formats', 'compatibleFormats', 'recommendedFormatId', 'hasCompatible', 'policyMessage'],
    properties: {
      id: { type: 'string', pattern: '^[A-Za-z0-9_-]{11}$', example: inspectionExample.id },
      title: { type: 'string', example: inspectionExample.title },
      artist: { type: 'string', nullable: true, example: inspectionExample.artist },
      album: { type: 'string', nullable: true, example: inspectionExample.album },
      duration: { type: 'number', nullable: true, example: inspectionExample.duration },
      thumbnail: { type: 'string', format: 'uri', nullable: true, example: inspectionExample.thumbnail },
      webpageUrl: { type: 'string', format: 'uri', example: inspectionExample.webpageUrl },
      formats: { type: 'array', items: schemaRef('ImportFormat') },
      compatibleFormats: { type: 'array', items: schemaRef('ImportFormat') },
      recommendedFormatId: { type: 'string', nullable: true, example: inspectionExample.recommendedFormatId },
      hasCompatible: { type: 'boolean', example: true },
      policyMessage: { type: 'string', example: inspectionExample.policyMessage },
    },
  },
  ImportInspectRequest: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', minLength: 1, maxLength: 2048, format: 'uri', description: 'One http(s) URL for a single YouTube video.' },
    },
  },
  CreateImportRequest: {
    type: 'object',
    required: ['url', 'title', 'artist'],
    anyOf: [
      { required: ['formatId'] },
      { required: ['format_id'] },
    ],
    properties: {
      url: { type: 'string', minLength: 1, maxLength: 2048, format: 'uri' },
      title: { type: 'string', minLength: 1, maxLength: 500 },
      artist: { type: 'string', minLength: 1, maxLength: 500 },
      album: { type: 'string', nullable: true, minLength: 1, maxLength: 500 },
      formatId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9+._-]+$', description: 'Preferred format ID spelling.' },
      format_id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9+._-]+$', description: 'Legacy alias accepted by the server.' },
    },
  },
  ImportJob: {
    type: 'object',
    required: ['id', 'title', 'artist', 'album', 'formatId', 'status', 'progress', 'errorCode', 'errorMessage', 'songId', 'sourceVideoId', 'sourceTitle', 'sourceArtist', 'measuredDuration', 'sampleRateHz', 'channels', 'bitrateBitsPerSecond', 'bytes', 'createdAt', 'startedAt', 'completedAt', 'updatedAt'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      title: { type: 'string' },
      artist: { type: 'string' },
      album: { type: 'string', nullable: true },
      formatId: { type: 'string' },
      status: { type: 'string', enum: ['queued', 'downloading', 'verifying', 'publishing', 'completed', 'failed'] },
      progress: { type: 'number', minimum: 0, maximum: 100 },
      errorCode: {
        type: 'string',
        nullable: true,
        enum: [
          'ARTIFACT_MISSING',
          'DEPENDENCY_UNAVAILABLE',
          'DOWNLOADER_FAILED',
          'FORMAT_UNAVAILABLE',
          'INCOMPATIBLE_FORMAT',
          'IMPORT_FAILED',
          'INSPECTION_FAILED',
          'INSPECTION_INVALID_RESPONSE',
          'INVALID_ARTIFACT',
          'INVALID_FORMAT',
          'INVALID_METADATA',
          'INVALID_URL',
          'LIVE_VIDEO_UNSUPPORTED',
          'PLAYLIST_UNSUPPORTED',
          'PROCESS_TIMEOUT',
          'REMUX_FAILED',
          'SERVER_RESTARTED',
          'VERIFICATION_FAILED',
        ],
      },
      errorMessage: { type: 'string', nullable: true },
      songId: { type: 'string', nullable: true },
      sourceVideoId: { type: 'string', nullable: true },
      sourceTitle: { type: 'string', nullable: true },
      sourceArtist: { type: 'string', nullable: true },
      measuredDuration: { type: 'number', nullable: true },
      sampleRateHz: { type: 'integer', nullable: true },
      channels: { type: 'integer', nullable: true },
      bitrateBitsPerSecond: { type: 'integer', nullable: true },
      bytes: { type: 'integer', minimum: 0, nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      startedAt: { type: 'string', format: 'date-time', nullable: true },
      completedAt: { type: 'string', format: 'date-time', nullable: true },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  ImportJobList: {
    type: 'object',
    required: ['jobs'],
    properties: {
      jobs: { type: 'array', maxItems: 50, items: schemaRef('ImportJob') },
    },
  },
  ImportDependencyItem: {
    type: 'object',
    required: ['available', 'message'],
    properties: {
      available: { type: 'boolean' },
      message: { type: 'string' },
    },
  },
  ImportDependencyStatus: {
    type: 'object',
    required: ['ready', 'items'],
    properties: {
      ready: { type: 'boolean' },
      items: {
        type: 'object',
        required: ['yt_dlp', 'ffmpeg', 'ffprobe'],
        properties: {
          yt_dlp: schemaRef('ImportDependencyItem'),
          ffmpeg: schemaRef('ImportDependencyItem'),
          ffprobe: schemaRef('ImportDependencyItem'),
        },
      },
    },
  },
};

const headers: Record<string, OpenApiObject> = {
  AcceptRanges: {
    description: 'The server supports byte ranges.',
    schema: { type: 'string', enum: ['bytes'] },
  },
  ContentLength: {
    description: 'Length in bytes of the selected representation. For 304 it describes the selected 200 representation; for 416 it is 0.',
    schema: { type: 'integer', format: 'int64', minimum: 0 },
  },
  ContentTypeAudio: {
    description: 'Native AAC-LC M4A media type.',
    schema: { type: 'string', enum: ['audio/mp4'] },
  },
  ETag: {
    description: 'Strong validator derived from the file size and modification time.',
    schema: { type: 'string', example: '"1a-65a8b2c1"' },
  },
  LastModified: {
    description: 'HTTP modification date for the recording.',
    schema: { type: 'string', example: 'Wed, 21 Oct 2026 10:00:00 GMT' },
  },
  CacheControl: {
    description: 'The representation must be revalidated before reuse.',
    schema: { type: 'string', enum: ['public, max-age=0, must-revalidate'] },
  },
  ContentRange: {
    description: 'Inclusive byte range and complete representation size for a 206 response.',
    schema: { type: 'string', pattern: '^bytes [0-9]+-[0-9]+/[0-9]+$', example: 'bytes 0-1023/4961487' },
  },
  UnsatisfiableContentRange: {
    description: 'The complete representation size when a requested range cannot be satisfied.',
    schema: { type: 'string', pattern: '^bytes \\*/[0-9]+$', example: 'bytes */4961487' },
  },
  AccessControlAllowOrigin: {
    description: 'Configured CORS origin; defaults to *.',
    schema: { type: 'string', example: '*' },
  },
  AccessControlAllowMethods: {
    description: 'Fixed CORS method allow list.',
    schema: { type: 'string', example: 'GET, HEAD, POST, PUT, OPTIONS' },
  },
  AccessControlAllowHeaders: {
    description: 'Fixed CORS request-header allow list.',
    schema: { type: 'string', example: 'Range, Content-Type, If-None-Match, If-Modified-Since, If-Range' },
  },
  AccessControlExposeHeaders: {
    description: 'Headers exposed to browser clients.',
    schema: { type: 'string', example: 'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified' },
  },
  VaryOrigin: {
    description: 'Present when CORS_ORIGIN is configured to a specific origin.',
    schema: { type: 'string', enum: ['Origin'] },
  },
};

// Fastify automatically registers HEAD for every GET route unless a custom
// HEAD route is already present. Keep those operations visible in the
// document so route discovery and the served contract remain one-to-one.
for (const [path, pathItem] of Object.entries(paths)) {
  const get = pathItem.get as OpenApiObject | undefined;
  if (!get || pathItem.head) continue;
  const getOperationId = typeof get.operationId === 'string' ? get.operationId : path.replaceAll('/', '_');
  pathItem.head = {
    ...get,
    operationId: `${getOperationId}Head`,
    summary: `HEAD ${get.summary ?? path}`,
    description: `${get.description ?? `Returns the headers for ${path}.`} Fastify registers this HEAD operation automatically for the GET route; the response body is omitted.`,
  };
}

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'SongStreamer API',
    version: '0.1.0',
    description: 'Public, self-hosted music library API. All API routes are intentionally unauthenticated; the service has no account layer. Metadata never exposes filesystem paths, imports preserve native AAC-LC audio, and complete lyrics are tied to the exact audioSha256 recording hash. Fastify automatically supplies HEAD for GET routes; documentation utility endpoints are included below.',
  },
  servers: [
    { url: '/', description: 'The current SongStreamer server' },
  ],
  security: [],
  tags: [
    { name: 'Health', description: 'Public liveness and dependency checks.' },
    { name: 'Library', description: 'Public song metadata.' },
    { name: 'Audio', description: 'Native AAC-LC M4A streaming and HTTP range validators.' },
    { name: 'Lyrics', description: 'Complete, recording-specific timed lyrics.' },
    { name: 'Import', description: 'Public YouTube source discovery, inspection, and asynchronous jobs.' },
    { name: 'CORS', description: 'Public browser preflight behavior.' },
    { name: 'Docs', description: 'The self-hosted Scalar reference, local browser bundle, and embedded OpenAPI documents.' },
  ],
  paths,
  components: {
    schemas: sharedSchemas,
    headers,
  },
} as const;

export type OpenApiDocument = typeof openApiDocument;
