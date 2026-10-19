import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export interface SongRecord {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number;
  filePath: string;
  audioSha256: string | null;
  hasLyrics: boolean;
}

interface MigrationFile {
  version: number;
  name: string;
  path: string;
}

type SqlRow = Record<string, unknown>;

function migrationFiles(names: string[], directory: string): MigrationFile[] {
  const migrations = names
    .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
    .map((name) => {
      const match = /^(\d+)_([a-z0-9_-]+)\.sql$/i.exec(name);
      if (!match) throw new Error(`Invalid migration filename: ${name}`);
      return {
        version: Number(match[1]),
        name,
        path: join(directory, name),
      };
    })
    .sort((left, right) => left.version - right.version);

  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index]?.version === migrations[index - 1]?.version) {
      throw new Error(`Duplicate migration version in ${directory}`);
    }
  }
  return migrations;
}

async function applyMigrations(db: DatabaseSync, directory: string): Promise<void> {
  const names = await readdir(directory);
  const migrations = migrationFiles(names, directory);
  if (migrations.length === 0) throw new Error(`No SQL migrations found in ${directory}`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as SqlRow[];
  const appliedVersions = new Map<number, string>();
  for (const row of applied) {
    appliedVersions.set(Number(row.version), String(row.name));
  }

  for (const migration of migrations) {
    const priorName = appliedVersions.get(migration.version);
    if (priorName !== undefined) {
      if (priorName !== migration.name) {
        throw new Error(`Migration ${migration.version} was recorded as ${priorName}, not ${migration.name}`);
      }
      continue;
    }

    const sql = await readFile(migration.path, 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare(
        `INSERT INTO schema_migrations (version, name, applied_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      ).run(migration.version, migration.name);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the migration failure if rollback itself cannot run.
      }
      throw error;
    }
  }
}

export async function openDatabase(dbPath: string, migrationsDir: string): Promise<DatabaseSync> {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    await stat(migrationsDir);
    await applyMigrations(db, migrationsDir);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export class SongStore {
  private readonly listStatement: ReturnType<DatabaseSync['prepare']>;
  private readonly getStatement: ReturnType<DatabaseSync['prepare']>;

  public constructor(private readonly db: DatabaseSync) {
    this.listStatement = db.prepare(`
      SELECT songs.id, songs.title, songs.artist, songs.album,
             songs.duration_seconds AS duration, songs.file_path, songs.audio_sha256,
             EXISTS (
               SELECT 1 FROM song_lyrics
               WHERE song_lyrics.song_id = songs.id
                 AND (song_lyrics.audio_sha256 = songs.audio_sha256
                   OR (song_lyrics.audio_sha256 IS NULL AND songs.audio_sha256 IS NULL))
             ) AS has_lyrics
      FROM songs
      ORDER BY title COLLATE NOCASE ASC, artist COLLATE NOCASE ASC, id COLLATE BINARY ASC
    `);
    this.getStatement = db.prepare(`
      SELECT songs.id, songs.title, songs.artist, songs.album,
             songs.duration_seconds AS duration, songs.file_path, songs.audio_sha256,
             EXISTS (
               SELECT 1 FROM song_lyrics
               WHERE song_lyrics.song_id = songs.id
                 AND (song_lyrics.audio_sha256 = songs.audio_sha256
                   OR (song_lyrics.audio_sha256 IS NULL AND songs.audio_sha256 IS NULL))
             ) AS has_lyrics
      FROM songs
      WHERE songs.id = ?
    `);
  }

  public list(): SongRecord[] {
    return (this.listStatement.all() as SqlRow[]).map(mapSongRow);
  }

  public get(id: string): SongRecord | undefined {
    const row = this.getStatement.get(id) as SqlRow | undefined;
    return row === undefined ? undefined : mapSongRow(row);
  }
}

function mapSongRow(row: SqlRow): SongRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    artist: String(row.artist),
    album: row.album === null || row.album === undefined ? null : String(row.album),
    duration: Number(row.duration),
    filePath: String(row.file_path),
    audioSha256: row.audio_sha256 === null || row.audio_sha256 === undefined ? null : String(row.audio_sha256),
    hasLyrics: row.has_lyrics === true || Number(row.has_lyrics) === 1,
  };
}
