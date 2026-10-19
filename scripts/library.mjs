#!/usr/bin/env node
import { access, mkdir, realpath, readdir, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, SongStore } from '../dist/src/database.js';
import { isSafeRelativePath } from '../dist/src/audio.js';

const dbPath = resolve(process.env.DB_PATH ?? '/srv/keystack-data/songstreamer/data/songstreamer.sqlite');
const migrationsDir = resolve(process.env.MIGRATIONS_DIR ?? new URL('../migrations/', import.meta.url).pathname);
const audioRoot = resolve(process.env.AUDIO_ROOT ?? '/srv/keystack-data/songstreamer/audio');
const [command = 'help', ...args] = process.argv.slice(2);

function usage() {
  console.error(`Usage:
  node scripts/library.mjs list
  node scripts/library.mjs add --id ID --title TITLE --artist ARTIST [--album ALBUM] --duration SECONDS --file PATH
  node scripts/library.mjs remove --id ID
  node scripts/library.mjs check
  node scripts/library.mjs backup [DESTINATION_DIR]

Environment: DB_PATH, MIGRATIONS_DIR, AUDIO_ROOT`);
  process.exit(2);
}

function option(name) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
  return value;
}

function requiredOption(name) {
  const value = option(name);
  if (value === undefined) throw new Error(`Missing required --${name}`);
  return value;
}

function contained(root, candidate) {
  const rest = relative(root, candidate);
  return rest === '' || (!rest.startsWith(`..${sep}`) && rest !== '..' && !isAbsolute(rest));
}

async function verifiedAudioPath(filePath) {
  if (!isSafeRelativePath(filePath) || !filePath.toLowerCase().endsWith('.m4a')) {
    throw new Error('file path must be a safe relative .m4a path');
  }
  const root = await realpath(audioRoot);
  const candidate = resolve(root, filePath);
  const published = await realpath(candidate);
  if (!contained(root, published)) throw new Error('file path escapes the audio root');
  const details = await stat(published);
  if (!details.isFile() || details.size === 0) throw new Error('audio path must be a non-empty regular file');
}

async function open() {
  return openDatabase(dbPath, migrationsDir);
}

async function listSongs() {
  const db = await open();
  try {
    console.log(JSON.stringify(new SongStore(db).list(), null, 2));
  } finally {
    db.close();
  }
}

async function addSong() {
  const id = requiredOption('id');
  const title = requiredOption('title');
  const artist = requiredOption('artist');
  const album = option('album') ?? null;
  const duration = Number(requiredOption('duration'));
  const filePath = requiredOption('file');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) throw new Error('duration must be between 0 and 86400 seconds');
  await verifiedAudioPath(filePath);
  const db = await open();
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        INSERT INTO songs (id, title, artist, album, duration_seconds, file_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, title, artist, album, duration, filePath);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log(`Added ${id}`);
  } finally {
    db.close();
  }
}

async function removeSong() {
  const id = requiredOption('id');
  const db = await open();
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare('DELETE FROM songs WHERE id = ?').run(id);
      db.exec('COMMIT');
      console.log(`Removed ${id} (${Number(result.changes)} row${Number(result.changes) === 1 ? '' : 's'})`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

async function checkSongs() {
  const db = await open();
  let failures = 0;
  try {
    const songs = new SongStore(db).list();
    for (const song of songs) {
      try {
        await verifiedAudioPath(song.filePath);
        console.log(`OK\t${song.id}\t${song.filePath}`);
      } catch (error) {
        failures += 1;
        console.error(`MISSING/INVALID\t${song.id}\t${song.filePath}\t${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    db.close();
  }
  if (failures > 0) process.exitCode = 1;
}

async function backupDatabase() {
  const destinationDir = resolve(args[0] ?? process.env.BACKUP_DIR ?? '/srv/keystack-data/songstreamer/backups');
  await mkdir(destinationDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '');
  const destination = resolve(destinationDir, `songstreamer-${stamp}.sqlite`);
  // Backups must be taken before a release starts the new image. Opening the
  // existing file directly avoids applying pending migrations as a side effect
  // of the backup command.
  await access(dbPath, constants.R_OK | constants.W_OK);
  const details = await stat(dbPath);
  if (!details.isFile()) throw new Error(`Database path is not a regular file: ${dbPath}`);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    // VACUUM INTO creates a consistent standalone database. The destination is
    // generated above and never user SQL.
    db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
    await access(destination, constants.R_OK);
    console.log(destination);
  } finally {
    db.close();
  }
  const entries = await readdir(destinationDir, { withFileTypes: true });
  const backups = entries.filter((entry) => /^songstreamer-.*\.sqlite$/.test(entry.name)).sort((a, b) => b.name.localeCompare(a.name));
  for (const entry of backups.slice(5)) {
    await rm(resolve(destinationDir, entry.name));
  }
}

try {
  if (command === 'list') await listSongs();
  else if (command === 'add') await addSong();
  else if (command === 'remove') await removeSong();
  else if (command === 'check') await checkSongs();
  else if (command === 'backup') await backupDatabase();
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
