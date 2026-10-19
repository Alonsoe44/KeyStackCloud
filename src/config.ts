import { join, resolve } from 'node:path';

export interface AppConfig {
  host: string;
  port: number;
  audioRoot: string;
  dbPath: string;
  migrationsDir: string;
  corsOrigin: string;
  logLevel: string;
  requireSsdMarker: boolean;
  ssdMarkerPath: string;
  /** Executable paths are configurable so the Pi image and local tests share the worker. */
  ytDlpPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  importStagingRoot?: string;
}

function readPort(value: string | undefined): number {
  const port = Number(value ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got ${value ?? ''}`);
  }
  return port;
}

function readBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  throw new Error(`Expected a boolean value, got ${value}`);
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataRoot = resolve(env.DATA_ROOT ?? '/data');
  const audioRoot = resolve(env.AUDIO_ROOT ?? '/audio');
  const dbPath = resolve(env.DB_PATH ?? `${dataRoot}/songstreamer.sqlite`);
  const ssdMarkerPath = resolve(env.SSD_MARKER_PATH ?? `${dataRoot}/.songstreamer-ssd`);

  return {
    host: env.HOST ?? '127.0.0.1',
    port: readPort(env.PORT),
    audioRoot,
    dbPath,
    migrationsDir: resolve(env.MIGRATIONS_DIR ?? `${process.cwd()}/migrations`),
    corsOrigin: env.CORS_ORIGIN ?? '*',
    logLevel: env.LOG_LEVEL ?? 'info',
    requireSsdMarker: readBoolean(env.REQUIRE_SSD_MARKER, false),
    ssdMarkerPath,
    ytDlpPath: env.YTDLP_PATH ?? 'yt-dlp',
    ffmpegPath: env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH ?? 'ffprobe',
    importStagingRoot: resolve(env.IMPORT_STAGING_ROOT ?? join(audioRoot, '.import-staging')),
  };
}
