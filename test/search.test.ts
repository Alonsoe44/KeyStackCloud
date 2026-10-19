import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { ImportError, searchSourceVideos, sourceVideoFromEntry } from '../src/importer.js';

const searchOutput = {
  _type: 'playlist',
  id: 'let it be piano',
  entries: [
    { _type: 'url', ie_key: 'Youtube', id: 'QDYfEBY9NM4', title: 'Let It Be (Piano)', channel: 'Piano Channel', duration: 243.0 },
    { _type: 'url', ie_key: 'Youtube', id: 'aaaaaaaaaaa', title: 'Live radio', channel: 'Radio', duration: null, live_status: 'is_live' },
    { _type: 'url', ie_key: 'Youtube', id: 'bbbbbbbbbbb', title: 'Premiere soon', duration: 200, live_status: 'is_upcoming' },
    { _type: 'url', ie_key: 'Youtube', id: 'ccccccccccc', title: 'No duration', uploader: 'Someone' },
    { _type: 'url', ie_key: 'YoutubeTab', id: 'UCxxxxxxxxxxxxxxxxxxxxxx', title: 'A channel' },
    { _type: 'url', ie_key: 'Youtube', id: 'ddddddddddd', title: 'Ten hour loop', uploader: 'Loops', duration: 36000.4 },
  ],
};

async function fakeYtDlp(root: string, body: string): Promise<string> {
  const path = join(root, 'yt-dlp');
  await writeFile(path, `#!/usr/bin/env node\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'songstreamer-search-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('search returns playable Source Videos and hides live, upcoming, unknown-length and non-video entries', async () => {
  await withRoot(async (root) => {
    const argsPath = join(root, 'args.json');
    const ytDlp = await fakeYtDlp(root, `
require('node:fs').writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write('harmless wrapper line\\n' + ${JSON.stringify(JSON.stringify(searchOutput))});`);
    const videos = await searchSourceVideos('  let   it be\npiano ', ytDlp);
    assert.deepEqual(videos, [
      {
        id: 'QDYfEBY9NM4',
        url: 'https://www.youtube.com/watch?v=QDYfEBY9NM4',
        title: 'Let It Be (Piano)',
        channel: 'Piano Channel',
        durationSeconds: 243,
        thumbnailUrl: 'https://i.ytimg.com/vi/QDYfEBY9NM4/mqdefault.jpg',
      },
      {
        id: 'ddddddddddd',
        url: 'https://www.youtube.com/watch?v=ddddddddddd',
        title: 'Ten hour loop',
        channel: 'Loops',
        durationSeconds: 36000,
        thumbnailUrl: 'https://i.ytimg.com/vi/ddddddddddd/mqdefault.jpg',
      },
    ]);
    const args = JSON.parse(await readFile(argsPath, 'utf8')) as string[];
    assert.ok(args.includes('--flat-playlist'));
    assert.ok(args.includes('--dump-single-json'));
    assert.equal(args.at(-1), 'ytsearch10:let it be piano');
  });
});

test('a query that looks like a flag stays inside the search term', async () => {
  await withRoot(async (root) => {
    const argsPath = join(root, 'args.json');
    const ytDlp = await fakeYtDlp(root, `
require('node:fs').writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write('{"_type":"playlist","entries":[]}');`);
    assert.deepEqual(await searchSourceVideos('--exec rm', ytDlp), []);
    const args = JSON.parse(await readFile(argsPath, 'utf8')) as string[];
    assert.equal(args.at(-1), 'ytsearch10:--exec rm');
    assert.ok(!args.includes('--exec'));
  });
});

test('empty and whitespace queries are rejected before yt-dlp runs', async () => {
  for (const query of ['', '   ', '\n\t']) {
    await assert.rejects(searchSourceVideos(query, '/nonexistent/yt-dlp'), (error: unknown) => {
      return error instanceof ImportError && error.code === 'INVALID_QUERY';
    });
  }
});

test('a hung search is killed and reported as SEARCH_TIMEOUT', async () => {
  await withRoot(async (root) => {
    const ytDlp = await fakeYtDlp(root, 'setTimeout(() => {}, 60_000);');
    await assert.rejects(searchSourceVideos('slow', ytDlp, 200), (error: unknown) => {
      return error instanceof ImportError && error.code === 'SEARCH_TIMEOUT';
    });
  });
});

test('yt-dlp failures and unusable output are reported as SEARCH_FAILED', async () => {
  await withRoot(async (root) => {
    const failing = await fakeYtDlp(root, "process.stderr.write('ERROR: blocked'); process.exit(1);");
    await assert.rejects(searchSourceVideos('anything', failing), (error: unknown) => {
      return error instanceof ImportError && error.code === 'SEARCH_FAILED' && error.message.includes('blocked');
    });
    const garbage = await fakeYtDlp(root, "process.stdout.write('not json');");
    await assert.rejects(searchSourceVideos('anything', garbage), (error: unknown) => {
      return error instanceof ImportError && error.code === 'SEARCH_FAILED';
    });
  });
});

test('a missing yt-dlp binary is reported as DEPENDENCY_UNAVAILABLE', async () => {
  await assert.rejects(searchSourceVideos('anything', '/nonexistent/yt-dlp'), (error: unknown) => {
    return error instanceof ImportError && error.code === 'DEPENDENCY_UNAVAILABLE';
  });
});

test('entries without a valid video id are dropped', () => {
  assert.equal(sourceVideoFromEntry({ id: 'short', duration: 10 }), null);
  assert.equal(sourceVideoFromEntry({ id: '../../etc/pa', duration: 10 }), null);
});

test('GET /api/v1/import/search returns Source Videos and explicit errors', async () => {
  await withRoot(async (root) => {
    await mkdir(join(root, 'audio'), { recursive: true });
    await mkdir(join(root, 'data'), { recursive: true });
    const ytDlp = await fakeYtDlp(root, `process.stdout.write(${JSON.stringify(JSON.stringify(searchOutput))});`);
    const { app } = await buildApp({
      host: '127.0.0.1',
      port: 0,
      audioRoot: join(root, 'audio'),
      dbPath: join(root, 'data', 'songs.sqlite'),
      migrationsDir: join(process.cwd(), 'migrations'),
      corsOrigin: '*',
      logLevel: 'silent',
      requireSsdMarker: false,
      ssdMarkerPath: join(root, '.songstreamer-ssd'),
      ytDlpPath: ytDlp,
    });
    try {
      const ok = await app.inject({ method: 'GET', url: '/api/v1/import/search?q=let%20it%20be' });
      assert.equal(ok.statusCode, 200);
      assert.equal(ok.headers['access-control-allow-origin'], '*');
      const body = ok.json() as { sourceVideos: Array<{ id: string }> };
      assert.deepEqual(body.sourceVideos.map((video) => video.id), ['QDYfEBY9NM4', 'ddddddddddd']);

      const missing = await app.inject({ method: 'GET', url: '/api/v1/import/search' });
      assert.equal(missing.statusCode, 400);
      assert.equal((missing.json() as { error: { code: string } }).error.code, 'INVALID_QUERY');

      const repeated = await app.inject({ method: 'GET', url: '/api/v1/import/search?q=a&q=b' });
      assert.equal(repeated.statusCode, 400);

      const legacy = await app.inject({ method: 'GET', url: '/import/search?q=x' });
      assert.equal(legacy.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});
