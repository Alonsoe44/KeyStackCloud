import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openDatabase } from '../src/database.js';
import {
  ImportError,
  ImportService,
  probeNativeAac,
  rejectionReason,
  validateYoutubeUrl,
  type ImportInspection,
} from '../src/importer.js';

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function inspection(): ImportInspection {
  return {
    id: 'dQw4w9WgXcQ',
    title: 'Source title',
    artist: 'Source artist',
    album: null,
    duration: 1.25,
    thumbnail: null,
    webpageUrl: URL,
    formats: [
      {
        formatId: '140',
        ext: 'm4a',
        acodec: 'mp4a.40.2',
        vcodec: 'none',
        abr: 128,
        asr: 44100,
        audioChannels: 2,
        filesize: 100,
        protocol: 'https',
        compatible: true,
        rejectionReason: null,
      },
    ],
    compatibleFormats: [],
    recommendedFormatId: '140',
    hasCompatible: true,
    policyMessage: 'native',
  };
}

async function waitFor(service: ImportService, id: string, status: string): Promise<ReturnType<ImportService['get']>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = service.get(id);
    if (current?.status === status) return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return service.get(id);
}

test('YouTube validation canonicalizes one video and rejects playlists/other hosts', () => {
  assert.equal(validateYoutubeUrl('https://youtu.be/dQw4w9WgXcQ?si=tracking'), URL);
  assert.equal(validateYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123'), URL);
  assert.equal(validateYoutubeUrl('http://youtube.com:80/watch?v=dQw4w9WgXcQ'), URL);
  assert.throws(() => validateYoutubeUrl('https://www.youtube.com/playlist?list=PL1234567890'), ImportError);
  assert.throws(() => validateYoutubeUrl('https://www.youtube.com/playlist?v=dQw4w9WgXcQ'), /one YouTube video/);
  assert.throws(() => validateYoutubeUrl('https://youtu.be/dQw4w9WgXcQ/extra'), /one YouTube video/);
  assert.throws(() => validateYoutubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), /Only YouTube/);
});

test('format policy accepts only native AAC-LC audio in M4A/MP4', () => {
  assert.equal(rejectionReason({ ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none' }), null);
  assert.match(rejectionReason({ ext: 'webm', acodec: 'opus', vcodec: 'none' }) ?? '', /M4A/);
  assert.match(rejectionReason({ ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'avc1' }) ?? '', /video/);
  assert.match(rejectionReason({ ext: 'm4a', acodec: 'mp4a.40.5', vcodec: 'none' }) ?? '', /HE-AAC/);
  assert.match(rejectionReason({ ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', has_drm: true }) ?? '', /DRM/);
});

async function fakeFfprobe(root: string, payload: unknown): Promise<string> {
  const path = join(root, 'ffprobe-fixture');
  const json = JSON.stringify(payload);
  await writeFile(path, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(json)})\n`);
  await chmod(path, 0o755);
  return path;
}

function validProbePayload(streamOverrides: Record<string, unknown> = {}, extraStreams: unknown[] = []): unknown {
  return {
    streams: [{
      codec_type: 'audio',
      codec_name: 'aac',
      profile: 'LC',
      codec_tag_string: 'mp4a',
      sample_rate: '44100',
      channels: 2,
      bit_rate: '128000',
      ...streamOverrides,
    }, ...extraStreams],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '1.234', bit_rate: '128000' },
  };
}

test('verification rejects extra streams and encrypted AAC tags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'songstreamer-probe-'));
  const artifact = join(root, 'audio.m4a');
  await writeFile(artifact, 'fixture');
  const expected = { expectedSampleRate: 44100, expectedChannels: 2, expectedBitrate: 128000 };
  try {
    const extraStreamProbe = await fakeFfprobe(root, validProbePayload({}, [{ codec_type: 'data' }]));
    await assert.rejects(() => probeNativeAac(artifact, expected, extraStreamProbe), /audio-only/);
    const encryptedProbe = await fakeFfprobe(root, validProbePayload({ codec_tag_string: 'enca' }));
    await assert.rejects(() => probeNativeAac(artifact, expected, encryptedProbe), /unencrypted MP4 AAC tag/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verified import publishes file and catalogue row atomically enough for readers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'songstreamer-import-'));
  const audioRoot = join(root, 'audio');
  const stagingRoot = join(audioRoot, '.import-staging');
  await mkdir(audioRoot, { recursive: true });
  const db = await openDatabase(join(root, 'songs.sqlite'), join(process.cwd(), 'migrations'));
  try {
    const service = new ImportService(db, audioRoot, {
      stagingRoot,
      inspect: async () => inspection(),
      download: async (_url, outputDirectory, _format, _paths, onProgress) => {
        await mkdir(outputDirectory, { recursive: true });
        const path = join(outputDirectory, 'native-audio.m4a');
        await import('node:fs/promises').then(({ writeFile }) => writeFile(path, 'verified-audio'));
        onProgress?.(100);
        return {
          path,
          sourceVideoId: 'dQw4w9WgXcQ',
          sourceTitle: 'Source title',
          sourceArtist: 'Source artist',
          sourceDuration: 1.25,
          expectedSampleRate: 44100,
          expectedChannels: 2,
          expectedBitrate: 128000,
        };
      },
      probe: async () => ({ duration: 1.234, sampleRateHz: 44100, channels: 2, bitrateBitsPerSecond: 128000, bytes: 13 }),
    });
    const job = service.create({ url: URL, title: 'Edited title', artist: 'Edited artist', album: null, formatId: '140' });
    const completed = await waitFor(service, job.id, 'completed');
    assert.equal(completed?.songId?.startsWith('import-'), true);
    assert.equal(completed?.measuredDuration, 1.234);
    const song = db.prepare('SELECT id, title, artist, duration_seconds, file_path, audio_sha256 FROM songs').get() as Record<string, unknown>;
    assert.equal(song.title, 'Edited title');
    assert.equal(song.artist, 'Edited artist');
    assert.equal(song.duration_seconds, 1.234);
    assert.equal(typeof song.audio_sha256, 'string');
    const published = join(audioRoot, String(song.file_path));
    assert.equal(await readFile(published, 'utf8'), 'verified-audio');
    assert.deepEqual(await readdir(stagingRoot), []);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('failed verification leaves no catalogue row or published file and can be retried', async () => {
  const root = await mkdtemp(join(tmpdir(), 'songstreamer-import-fail-'));
  const audioRoot = join(root, 'audio');
  await mkdir(audioRoot, { recursive: true });
  const db = await openDatabase(join(root, 'songs.sqlite'), join(process.cwd(), 'migrations'));
  try {
    const service = new ImportService(db, audioRoot, {
      inspect: async () => inspection(),
      download: async (_url, outputDirectory) => {
        await mkdir(outputDirectory, { recursive: true });
        const path = join(outputDirectory, 'native-audio.m4a');
        await import('node:fs/promises').then(({ writeFile }) => writeFile(path, 'bad'));
        return {
          path,
          sourceVideoId: 'dQw4w9WgXcQ',
          sourceTitle: 'Source title',
          sourceArtist: 'Source artist',
          sourceDuration: 1,
          expectedSampleRate: 44100,
          expectedChannels: 2,
          expectedBitrate: 128000,
        };
      },
      probe: async () => {
        throw new ImportError('INVALID_ARTIFACT', 'fixture rejected');
      },
    });
    const job = service.create({ url: URL, title: 'Title', artist: 'Artist', formatId: '140' });
    const failed = await waitFor(service, job.id, 'failed');
    assert.equal(failed?.errorCode, 'INVALID_ARTIFACT');
    assert.equal(Number((db.prepare('SELECT count(*) AS count FROM songs').get() as { count: number }).count), 0);
    const retry = service.retry(job.id);
    assert.notEqual(retry.id, job.id);
    assert.equal(retry.status, 'queued');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('server restart marks unfinished imports failed for explicit retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'songstreamer-restart-'));
  const audioRoot = join(root, 'audio');
  await mkdir(audioRoot, { recursive: true });
  const db = await openDatabase(join(root, 'songs.sqlite'), join(process.cwd(), 'migrations'));
  try {
    db.prepare(`
      INSERT INTO import_jobs (id, url, title, artist, album, format_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'downloading')
    `).run('interrupted-job', URL, 'Title', 'Artist', null, '140');
    const service = new ImportService(db, audioRoot);
    const failed = service.get('interrupted-job');
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.errorCode, 'SERVER_RESTARTED');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
