import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function runLibrary(root: string, args: string[]) {
  const result = spawnSync(process.execPath, ['scripts/library.mjs', ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_PATH: join(root, 'data', 'songstreamer.sqlite'),
      AUDIO_ROOT: join(root, 'audio'),
      MIGRATIONS_DIR: join(root, 'migrations'),
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('a maintenance backup can be copied and reopened as a restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'songstreamer-restore-'));
  try {
    await mkdir(join(root, 'audio'), { recursive: true });
    await mkdir(join(root, 'data'), { recursive: true });
    await mkdir(join(root, 'backups'), { recursive: true });
    await mkdir(join(root, 'restored'), { recursive: true });
    await mkdir(join(root, 'migrations'), { recursive: true });
    await copyFile(join(process.cwd(), 'migrations', '001_initial.sql'), join(root, 'migrations', '001_initial.sql'));
    await writeFile(join(root, 'audio', 'restore.m4a'), 'fixture');

    runLibrary(root, [
      'add', '--id', 'restore', '--title', 'Restore', '--artist', 'Test',
      '--duration', '1', '--file', 'restore.m4a',
    ]);
    // A future migration is present when the backup command runs. The backup
    // must preserve the current database without applying this migration.
    await writeFile(join(root, 'migrations', '002_future.sql'), 'CREATE TABLE future_marker (id INTEGER PRIMARY KEY);');
    runLibrary(root, ['backup', join(root, 'backups')]);
    const backups = (await readdir(join(root, 'backups'))).filter((name) => name.endsWith('.sqlite'));
    assert.equal(backups.length, 1);
    const restoredPath = join(root, 'restored', 'songstreamer.sqlite');
    await copyFile(join(root, 'backups', backups[0]!), restoredPath);

    const restored = new DatabaseSync(restoredPath);
    try {
      const song = restored.prepare('SELECT id FROM songs WHERE id = ?').get('restore') as { id?: string } | undefined;
      assert.equal(song?.id, 'restore');
      const future = restored.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'future_marker'").get();
      assert.equal(future, undefined);
    } finally {
      restored.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
