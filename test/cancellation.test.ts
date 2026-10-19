import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildApp, type AppResources } from '../src/app.js';
import type { AppConfig } from '../src/config.js';

const enabled = process.env.SONGSTREAMER_NETWORK_TEST === '1';

test('an aborted audio connection does not prevent the next request', { skip: !enabled }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'songstreamer-cancel-'));
  let resources: AppResources | undefined;
  try {
    await mkdir(join(root, 'audio'), { recursive: true });
    await mkdir(join(root, 'data'), { recursive: true });
    await writeFile(join(root, 'audio', 'large.m4a'), Buffer.alloc(8 * 1024 * 1024, 97));
    const config: AppConfig = {
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
    resources = await buildApp(config);
    resources.db.prepare(`
      INSERT INTO songs (id, title, artist, album, duration_seconds, file_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('large', 'Large', 'Test', null, 1, 'large.m4a');
    await resources.app.listen({ host: '127.0.0.1', port: 0 });
    const address = resources.app.server.address();
    assert.equal(typeof address, 'object');
    if (address === null || typeof address === 'string') throw new Error('test server did not expose a port');

    await new Promise<void>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port: address.port, path: '/songs/large/audio' });
      request.once('response', (response) => {
        response.once('data', () => {
          response.destroy();
          request.destroy();
        });
        response.once('close', resolve);
      });
      request.once('error', (error) => {
        // Destroying the client request after the first chunk can surface an
        // expected ECONNRESET; the response close event remains the success
        // signal for this cancellation test.
        if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error);
      });
      request.end();
    });

    const health = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
  } finally {
    if (resources !== undefined) await resources.app.close();
    await rm(root, { recursive: true, force: true });
  }
});
