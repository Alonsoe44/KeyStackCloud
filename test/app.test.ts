import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type AppResources } from '../src/app.js';
import { openDatabase } from '../src/database.js';
import type { AppConfig } from '../src/config.js';

let root = '';
let resources: AppResources;
let audioPath = '';

function config(): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    audioRoot: join(root, 'audio'),
    dbPath: join(root, 'data', 'songs.sqlite'),
    migrationsDir: join(process.cwd(), 'migrations'),
    corsOrigin: '*',
    logLevel: 'silent',
    requireSsdMarker: false,
    ssdMarkerPath: join(root, '.songstreamer-ssd'),
  };
}

function insertSong(overrides: Partial<Record<string, string | number | null>> = {}): void {
  resources.db.prepare(`
    INSERT INTO songs (id, title, artist, album, duration_seconds, file_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    overrides.id ?? 'song-1',
    overrides.title ?? 'First Song',
    overrides.artist ?? 'The Artist',
    overrides.album ?? 'The Album',
    overrides.duration ?? 4.25,
    overrides.filePath ?? 'first.m4a',
  );
}

async function request(app: FastifyInstance, options: InjectOptions): Promise<LightMyRequestResponse> {
  return app.inject(options);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'songstreamer-test-'));
  await mkdir(join(root, 'audio'), { recursive: true });
  await mkdir(join(root, 'data'), { recursive: true });
  audioPath = join(root, 'audio', 'first.m4a');
  await writeFile(audioPath, Buffer.from('abcdefghijklmnopqrstuvwxyz', 'ascii'));
  resources = await buildApp(config());
  insertSong();
});

afterEach(async () => {
  await resources.app.close();
  await rm(root, { recursive: true, force: true });
});

test('health and song metadata are public without exposing file paths', async () => {
  const health = await request(resources.app, { method: 'GET', url: '/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });

  const list = await request(resources.app, { method: 'GET', url: '/songs' });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json(), {
    songs: [{ id: 'song-1', title: 'First Song', artist: 'The Artist', album: 'The Album', duration: 4.25, hasLyrics: false, audioSha256: null }],
  });
  assert.equal(list.headers['access-control-allow-origin'], '*');

  const details = await request(resources.app, { method: 'GET', url: '/songs/song-1' });
  assert.equal(details.statusCode, 200);
  assert.deepEqual(details.json(), {
    id: 'song-1', title: 'First Song', artist: 'The Artist', album: 'The Album', duration: 4.25, hasLyrics: false, audioSha256: null,
  });

  const missing = await request(resources.app, { method: 'GET', url: '/songs/missing' });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: { code: 'SONG_NOT_FOUND', message: 'Song not found' } });
});

test('CORS preflight permits versioned lyric saves', async () => {
  const response = await request(resources.app, {
    method: 'OPTIONS',
    url: '/api/v1/songs/song-1/lyrics',
    headers: {
      origin: 'http://127.0.0.1:3100',
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(response.statusCode, 204);
  assert.match(String(response.headers['access-control-allow-methods']), /\bPUT\b/);
  assert.match(String(response.headers['access-control-allow-headers']), /\bContent-Type\b/i);
  assert.equal(response.headers['access-control-allow-origin'], '*');
});

test('full audio GET and HEAD return native playback headers', async () => {
  const response = await request(resources.app, { method: 'GET', url: '/songs/song-1/audio' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'audio/mp4');
  assert.equal(response.headers['accept-ranges'], 'bytes');
  assert.equal(response.headers['content-length'], '26');
  assert.match(String(response.headers.etag), /^"1a-[0-9a-f]+"$/);
  assert.equal(response.body, 'abcdefghijklmnopqrstuvwxyz');

  const head = await request(resources.app, { method: 'HEAD', url: '/songs/song-1/audio' });
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers['content-length'], '26');
  assert.equal(head.body, '');
});

test('single byte ranges support closed, open-ended, and suffix forms', async () => {
  const closed = await request(resources.app, {
    method: 'GET', url: '/songs/song-1/audio', headers: { range: 'bytes=2-5' },
  });
  assert.equal(closed.statusCode, 206);
  assert.equal(closed.headers['content-range'], 'bytes 2-5/26');
  assert.equal(closed.headers['content-length'], '4');
  assert.equal(closed.body, 'cdef');

  const open = await request(resources.app, {
    method: 'GET', url: '/songs/song-1/audio', headers: { range: 'bytes=24-' },
  });
  assert.equal(open.statusCode, 206);
  assert.equal(open.headers['content-range'], 'bytes 24-25/26');
  assert.equal(open.body, 'yz');

  const suffix = await request(resources.app, {
    method: 'HEAD', url: '/songs/song-1/audio', headers: { range: 'bytes=-3' },
  });
  assert.equal(suffix.statusCode, 200);
  assert.equal(suffix.headers['content-range'], undefined);
  assert.equal(suffix.headers['content-length'], '26');
  assert.equal(suffix.body, '');
});

test('unsatisfiable byte ranges return 416 while malformed or unknown ranges are ignored', async () => {
  for (const range of ['bytes=26-30', 'bytes=5-2']) {
    const response = await request(resources.app, {
      method: 'GET', url: '/songs/song-1/audio', headers: { range },
    });
    assert.equal(response.statusCode, 416, range);
    assert.equal(response.headers['content-range'], 'bytes */26');
    assert.equal(response.headers['content-length'], '0');
    assert.equal(response.body, '', range);
  }

  for (const range of ['bytes=0-1,3-4', 'items=0-1', 'bytes=abc-', 'bytes=+1-', 'bytes=1e1-']) {
    const response = await request(resources.app, {
      method: 'GET', url: '/songs/song-1/audio', headers: { range },
    });
    assert.equal(response.statusCode, 200, range);
    assert.equal(response.headers['content-length'], '26', range);
    assert.equal(response.body, 'abcdefghijklmnopqrstuvwxyz', range);
  }
});

test('conditional requests and If-Range preserve HTTP semantics', async () => {
  const first = await request(resources.app, { method: 'HEAD', url: '/songs/song-1/audio' });
  const etag = first.headers.etag;
  assert.ok(etag);

  const notModified = await request(resources.app, {
    method: 'GET', url: '/songs/song-1/audio', headers: { 'if-none-match': etag },
  });
  assert.equal(notModified.statusCode, 304);
  assert.equal(notModified.headers['content-length'], '26');
  assert.equal(notModified.body, '');

  const matchedRange = await request(resources.app, {
    method: 'GET', url: '/songs/song-1/audio', headers: { range: 'bytes=0-2', 'if-range': etag },
  });
  assert.equal(matchedRange.statusCode, 206);
  assert.equal(matchedRange.body, 'abc');

  const staleRange = await request(resources.app, {
    method: 'GET', url: '/songs/song-1/audio', headers: { range: 'bytes=0-2', 'if-range': '"stale"' },
  });
  assert.equal(staleRange.statusCode, 200);
  assert.equal(staleRange.body, 'abcdefghijklmnopqrstuvwxyz');
});

test('missing files and unsafe relative paths never escape the audio root', async () => {
  insertSong({ id: 'missing', title: 'Missing', filePath: 'missing.m4a' });
  const missing = await request(resources.app, { method: 'GET', url: '/songs/missing/audio' });
  assert.equal(missing.statusCode, 404);

  await writeFile(join(root, 'outside.m4a'), Buffer.from('secret', 'ascii'));
  insertSong({ id: 'escape', title: 'Escape', filePath: '../outside.m4a' });
  const escape = await request(resources.app, { method: 'GET', url: '/songs/escape/audio' });
  assert.equal(escape.statusCode, 404);

  await writeFile(join(root, 'audio', 'empty.m4a'), '');
  insertSong({ id: 'empty', title: 'Empty', filePath: 'empty.m4a' });
  const empty = await request(resources.app, { method: 'GET', url: '/songs/empty/audio' });
  assert.equal(empty.statusCode, 404);
});

test('migrations are ordered and idempotent', async () => {
  await resources.app.close();
  const second = await openDatabase(config().dbPath, config().migrationsDir);
  try {
    const migrations = (second.prepare('SELECT version, name FROM schema_migrations').all() as Array<{ version: number; name: string }>).map((row) => ({
      version: Number(row.version),
      name: String(row.name),
    }));
    assert.deepEqual(migrations, [
      { version: 1, name: '001_initial.sql' },
      { version: 2, name: '002_import_jobs.sql' },
      { version: 3, name: '003_lyrics.sql' },
    ]);
    assert.equal(Number(second.prepare('SELECT count(*) AS count FROM songs').get()?.count), 1);
  } finally {
    second.close();
  }
  resources = await buildApp(config());
});

test('complete lyrics are versioned to the exact recording and replaced atomically', async () => {
  const hash = 'a'.repeat(64);
  resources.db.prepare('UPDATE songs SET audio_sha256 = ? WHERE id = ?').run(hash, 'song-1');
  const payload = {
    schemaVersion: 1,
    songId: 'song-1',
    audioSha256: hash,
    language: 'en',
    reviewStatus: 'complete',
    lines: [{
      id: 'line-1',
      text: 'First Song',
      startMs: 0,
      endMs: 2000,
      words: [
        { id: 'line-1-word-1', text: 'First', startMs: 0 },
        { id: 'line-1-word-2', text: 'Song', startMs: 900 },
      ],
    }],
  };
  const saved = await request(resources.app, {
    method: 'PUT', url: '/api/v1/songs/song-1/lyrics', payload,
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().documentVersion, 1);
  assert.equal(saved.json().audioSha256, hash);

  const song = await request(resources.app, { method: 'GET', url: '/songs/song-1' });
  assert.equal(song.json().hasLyrics, true);
  assert.equal(song.json().audioSha256, hash);
  const loaded = await request(resources.app, { method: 'GET', url: '/api/v1/songs/song-1/lyrics' });
  assert.equal(loaded.statusCode, 200);
  assert.deepEqual(loaded.json().lines, payload.lines);

  const stale = await request(resources.app, {
    method: 'PUT', url: '/api/v1/songs/song-1/lyrics',
    payload: { ...payload, audioSha256: 'b'.repeat(64) },
  });
  assert.equal(stale.statusCode, 409);
  const missingHash = await request(resources.app, {
    method: 'PUT', url: '/api/v1/songs/song-1/lyrics',
    payload: { ...payload, audioSha256: undefined },
  });
  assert.equal(missingHash.statusCode, 409);
  assert.equal(missingHash.json().error.code, 'AUDIO_VERSION_REQUIRED');
  assert.equal((await request(resources.app, { method: 'GET', url: '/api/v1/songs/song-1/lyrics' })).json().documentVersion, 1);
});

test('lyrics reject non-monotonic and text-inconsistent timestamps without replacing old data', async () => {
  const hash = 'c'.repeat(64);
  resources.db.prepare('UPDATE songs SET audio_sha256 = ? WHERE id = ?').run(hash, 'song-1');
  const invalid = {
    schemaVersion: 1,
    songId: 'song-1',
    audioSha256: hash,
    language: 'en',
    reviewStatus: 'complete',
    lines: [{
      id: 'line-1', text: 'First Song', startMs: 1000, endMs: 900,
      words: [{ id: 'w1', text: 'Different', startMs: 1000 }],
    }],
  };
  const response = await request(resources.app, { method: 'PUT', url: '/api/v1/songs/song-1/lyrics', payload: invalid });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'INVALID_LYRICS');
  const missing = await request(resources.app, { method: 'GET', url: '/api/v1/songs/song-1/lyrics' });
  assert.equal(missing.statusCode, 404);
});

test('lyrics reject duplicate IDs, zero-length words, and overlapping word spans', async () => {
  const hash = 'd'.repeat(64);
  resources.db.prepare('UPDATE songs SET audio_sha256 = ? WHERE id = ?').run(hash, 'song-1');
  const base = {
    schemaVersion: 1,
    songId: 'song-1',
    audioSha256: hash,
    language: 'en',
    reviewStatus: 'complete',
  };
  const invalidPayloads = [
    {
      ...base,
      lines: [{
        id: 'line-1', text: 'First Song', startMs: 0, endMs: 2000,
        words: [{ id: 'same', text: 'First', startMs: 0 }, { id: 'same', text: 'Song', startMs: 900 }],
      }],
    },
    {
      ...base,
      lines: [{
        id: 'line-1', text: 'First Song', startMs: 0, endMs: 2000,
        words: [{ id: 'w1', text: 'First', startMs: 0, endMs: 0 }, { id: 'w2', text: 'Song', startMs: 900 }],
      }],
    },
    {
      ...base,
      lines: [{
        id: 'line-1', text: 'First Song', startMs: 0, endMs: 2000,
        words: [{ id: 'w1', text: 'First', startMs: 0, endMs: 1200 }, { id: 'w2', text: 'Song', startMs: 900 }],
      }],
    },
  ];

  for (const payload of invalidPayloads) {
    const response = await request(resources.app, { method: 'PUT', url: '/api/v1/songs/song-1/lyrics', payload });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'INVALID_LYRICS');
  }
  const missing = await request(resources.app, { method: 'GET', url: '/api/v1/songs/song-1/lyrics' });
  assert.equal(missing.statusCode, 404);
});
