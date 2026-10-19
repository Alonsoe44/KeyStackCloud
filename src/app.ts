import { createReadStream } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { type AppConfig } from './config.js';
import { resolveAudioFile, matchesIfNoneMatch, matchesIfRange, parseSingleRange, type AudioFile } from './audio.js';
import { type DatabaseSync } from 'node:sqlite';
import { openDatabase, SongStore, type SongRecord } from './database.js';
import { HttpError, isNodeError } from './errors.js';
import { ImportError, ImportService } from './importer.js';
import { LyricsError, LyricsStore, validateLyricsPayload } from './lyrics.js';

interface SongParams {
  id: string;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

interface ImportBody {
  url?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  formatId?: unknown;
  format_id?: unknown;
}

interface ImportParams {
  id: string;
}

export interface AppResources {
  app: FastifyInstance;
  db: DatabaseSync;
  importer: ImportService;
}

function publicSong(song: SongRecord): Omit<SongRecord, 'filePath'> {
  const { filePath: _filePath, ...result } = song;
  return result;
}

function lyricsStatusCode(error: LyricsError): number {
  if (error.code === 'AUDIO_VERSION_MISMATCH' || error.code === 'AUDIO_VERSION_REQUIRED' || error.code === 'LYRICS_SONG_MISMATCH') return 409;
  if (error.code === 'LYRICS_STORAGE_INVALID' || error.code === 'LYRICS_STORAGE_FAILED') return 500;
  return 400;
}

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string): void {
  const body: ErrorBody = { error: { code, message } };
  reply.code(statusCode).send(body);
}

function setCors(reply: FastifyReply, origin: string): void {
  reply.header('Access-Control-Allow-Origin', origin);
  reply.header('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified');
  if (origin !== '*') reply.header('Vary', 'Origin');
}

function setAudioHeaders(reply: FastifyReply, file: AudioFile, length: number): void {
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', 'audio/mp4');
  reply.header('Content-Length', String(length));
  reply.header('ETag', file.etag);
  reply.header('Last-Modified', file.lastModified);
  reply.header('Cache-Control', 'public, max-age=0, must-revalidate');
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function conditionalNotModified(request: FastifyRequest, file: AudioFile): boolean {
  const ifNoneMatch = request.headers['if-none-match'];
  if (typeof ifNoneMatch === 'string' && matchesIfNoneMatch(ifNoneMatch, file.etag)) return true;
  if (ifNoneMatch !== undefined) return false;
  const ifModifiedSince = request.headers['if-modified-since'];
  if (typeof ifModifiedSince !== 'string') return false;
  const timestamp = Date.parse(ifModifiedSince);
  return Number.isFinite(timestamp) && Math.floor(file.mtimeMs / 1000) * 1000 <= timestamp;
}

async function sendAudio(
  request: FastifyRequest,
  reply: FastifyReply,
  file: AudioFile,
  method: 'GET' | 'HEAD',
): Promise<void> {
  const rangeHeader = request.headers.range;
  // RFC 9110 applies Range to GET. HEAD still describes the complete selected
  // representation, even when a client sends a Range header with it.
  const rangeRequested = method === 'GET' && typeof rangeHeader === 'string' && matchesIfRange(singleHeader(request.headers['if-range']), file);
  const parsedRange = rangeRequested ? parseSingleRange(rangeHeader, file.size) : undefined;

  setAudioHeaders(reply, file, file.size);
  if (conditionalNotModified(request, file)) {
    // A 304 has no body, but Content-Length describes the selected 200
    // representation when present (RFC 9110 section 8.6).
    reply.code(304).header('Content-Length', String(file.size)).send();
    return;
  }

  if (parsedRange === 'unsatisfiable') {
    reply
      .code(416)
      .header('Content-Range', `bytes */${file.size}`)
      .header('Content-Length', '0')
      .send();
    return;
  }

  const statusCode = parsedRange === undefined ? 200 : 206;
  const start = parsedRange?.start ?? 0;
  const end = parsedRange?.end ?? file.size - 1;
  const length = parsedRange === undefined ? file.size : end - start + 1;
  setAudioHeaders(reply, file, length);
  if (parsedRange !== undefined) reply.header('Content-Range', `bytes ${start}-${end}/${file.size}`);
  reply.code(statusCode);

  if (method === 'HEAD') {
    reply.send();
    return;
  }

  const responseHeaders = Object.fromEntries(
    Object.entries(reply.getHeaders())
      .filter((entry): entry is [string, string | number | string[]] => entry[1] !== undefined)
      .map(([name, value]) => [name, typeof value === 'number' ? String(value) : value]),
  ) as Record<string, string | string[]>;
  reply.hijack();
  reply.raw.writeHead(statusCode, responseHeaders);
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  request.raw.once('aborted', abort);
  reply.raw.once('close', abort);
  try {
    await pipeline(
      createReadStream(file.absolutePath, {
        start,
        end,
        highWaterMark: 64 * 1024,
      }),
      reply.raw,
      { signal: controller.signal },
    );
  } catch (error) {
    if (!controller.signal.aborted && !reply.raw.destroyed) throw error;
  } finally {
    request.raw.removeListener('aborted', abort);
    reply.raw.removeListener('close', abort);
  }
}

function getSongOrThrow(store: SongStore, id: string): SongRecord {
  const song = store.get(id);
  if (song === undefined) throw new HttpError(404, 'SONG_NOT_FOUND', 'Song not found');
  return song;
}

function importStatusCode(error: ImportError): number {
  if (['INVALID_URL', 'INVALID_METADATA', 'INVALID_FORMAT'].includes(error.code)) return 400;
  if (error.code === 'JOB_NOT_FOUND') return 404;
  if (error.code === 'JOB_NOT_RETRYABLE') return 409;
  if (error.code === 'DEPENDENCY_UNAVAILABLE') return 503;
  if (['PLAYLIST_UNSUPPORTED', 'LIVE_VIDEO_UNSUPPORTED', 'INCOMPATIBLE_FORMAT', 'FORMAT_UNAVAILABLE'].includes(error.code)) return 422;
  return 502;
}

function getImportBody(request: FastifyRequest): ImportBody {
  return typeof request.body === 'object' && request.body !== null ? request.body as ImportBody : {};
}

function bodyText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function buildApp(config: AppConfig): Promise<AppResources> {
  if (config.requireSsdMarker) {
    await access(config.ssdMarkerPath, constants.R_OK).catch(() => {
      throw new Error(`Required SSD marker is missing: ${config.ssdMarkerPath}`);
    });
  }
  await access(config.audioRoot, constants.R_OK).catch(() => {
    throw new Error(`Audio root is not readable: ${config.audioRoot}`);
  });

  const db = await openDatabase(config.dbPath, config.migrationsDir);
  const store = new SongStore(db);
  const lyrics = new LyricsStore(db);
  const importer = new ImportService(db, config.audioRoot, {
    ytDlpPath: config.ytDlpPath,
    ffmpegPath: config.ffmpegPath,
    ffprobePath: config.ffprobePath,
    stagingRoot: config.importStagingRoot,
  });
  const app = Fastify({ logger: { level: config.logLevel } });

  app.addHook('onRequest', async (_request, reply) => {
    setCors(reply, config.corsOrigin);
  });

  app.options('/*', async (_request, reply) => {
    reply
      .header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Range, Content-Type, If-None-Match, If-Modified-Since, If-Range')
      .code(204)
      .send();
  });

  app.get('/health', async (_request, reply) => {
    try {
      db.prepare('SELECT 1 AS ok').get();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'error' });
    }
  });

  const importHealth = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const status = await importer.dependencyStatus();
    reply.code(status.ready ? 200 : 503).send(status);
  };

  const inspectImport = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const body = getImportBody(request);
      reply.send(await importer.inspect(bodyText(body.url)));
    } catch (error) {
      if (error instanceof ImportError) {
        sendError(reply, importStatusCode(error), error.code, error.message);
        return;
      }
      throw error;
    }
  };

  const createImport = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      const body = getImportBody(request);
      const job = importer.create({
        url: bodyText(body.url),
        title: bodyText(body.title),
        artist: bodyText(body.artist),
        album: body.album === null ? null : bodyText(body.album),
        formatId: bodyText(body.formatId ?? body.format_id),
      });
      reply.code(202).send(job);
    } catch (error) {
      if (error instanceof ImportError) {
        sendError(reply, importStatusCode(error), error.code, error.message);
        return;
      }
      throw error;
    }
  };

  const listImports = async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.send({ jobs: importer.list() });
  };

  const getImport = async (request: FastifyRequest<{ Params: ImportParams }>, reply: FastifyReply): Promise<void> => {
    const job = importer.get(request.params.id);
    if (!job) {
      sendError(reply, 404, 'JOB_NOT_FOUND', 'Import job not found');
      return;
    }
    reply.send(job);
  };

  const retryImport = async (request: FastifyRequest<{ Params: ImportParams }>, reply: FastifyReply): Promise<void> => {
    try {
      reply.code(202).send(importer.retry(request.params.id));
    } catch (error) {
      if (error instanceof ImportError) {
        sendError(reply, importStatusCode(error), error.code, error.message);
        return;
      }
      throw error;
    }
  };

  // Keep the short routes aligned with the existing public API and expose
  for (const prefix of ['/import', '/api/v1/import']) {
    app.get(`${prefix}/health`, importHealth);
    app.post(`${prefix}/inspect`, inspectImport);
    app.post(`${prefix}/jobs`, createImport);
    app.get(`${prefix}/jobs`, listImports);
    app.get<{ Params: ImportParams }>(`${prefix}/jobs/:id`, getImport);
    app.post<{ Params: ImportParams }>(`${prefix}/jobs/:id/retry`, retryImport);
  }

  app.get('/songs', async () => ({ songs: store.list().map(publicSong) }));

  app.get<{ Params: SongParams }>('/songs/:id', async (request) => {
    return publicSong(getSongOrThrow(store, request.params.id));
  });

  const getLyrics = async (request: FastifyRequest<{ Params: SongParams }>, reply: FastifyReply): Promise<void> => {
    const song = getSongOrThrow(store, request.params.id);
    const document = lyrics.get(song.id);
    if (document === undefined || document.audioSha256 !== song.audioSha256) {
      sendError(reply, 404, 'LYRICS_NOT_FOUND', 'Complete lyrics are not available for this recording');
      return;
    }
    reply.send(document);
  };

  const saveLyrics = async (request: FastifyRequest<{ Params: SongParams; Body: unknown }>, reply: FastifyReply): Promise<void> => {
    const song = getSongOrThrow(store, request.params.id);
    try {
      const document = validateLyricsPayload(request.body, song.id, song.audioSha256, song.duration);
      reply.send(lyrics.replace(document));
    } catch (error) {
      if (error instanceof LyricsError) {
        sendError(reply, lyricsStatusCode(error), error.code, error.message);
        return;
      }
      throw error;
    }
  };

  // The versioned routes are the public contract. The short aliases mirror
  // the historical import routes for local kiosk deployments.
  for (const prefix of ['/api/v1/songs', '/songs']) {
    app.get<{ Params: SongParams }>(`${prefix}/:id/lyrics`, getLyrics);
    app.put<{ Params: SongParams; Body: unknown }>(`${prefix}/:id/lyrics`, saveLyrics);
  }

  const audioHandler = async (request: FastifyRequest<{ Params: SongParams }>, reply: FastifyReply) => {
    const song = getSongOrThrow(store, request.params.id);
    const file = await resolveAudioFile(config.audioRoot, song.filePath);
    if (file === undefined) throw new HttpError(404, 'AUDIO_NOT_FOUND', 'Song audio is not available');
    const method = request.method as 'GET' | 'HEAD';
    await sendAudio(request, reply, file, method);
  };

  app.head<{ Params: SongParams }>('/songs/:id/audio', audioHandler);
  app.get<{ Params: SongParams }>('/songs/:id/audio', audioHandler);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      sendError(reply, error.statusCode, error.code, error.message);
      return;
    }
    if (error instanceof Error && 'validation' in error && error.validation !== undefined) {
      sendError(reply, 400, 'INVALID_REQUEST', 'Invalid request');
      return;
    }
    if (isNodeError(error, 'ENOENT')) {
      sendError(reply, 404, 'NOT_FOUND', 'Resource not found');
      return;
    }
    request.log.error(error);
    if (!reply.sent) sendError(reply, 500, 'INTERNAL_ERROR', 'Internal server error');
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  return { app, db, importer };
}
