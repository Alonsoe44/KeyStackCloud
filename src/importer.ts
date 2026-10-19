import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export type ImportJobStatus = 'queued' | 'downloading' | 'verifying' | 'publishing' | 'completed' | 'failed';

export interface ImportFormat {
  formatId: string;
  ext: string;
  acodec: string;
  vcodec: string;
  abr: number | null;
  asr: number | null;
  audioChannels: number | null;
  filesize: number | null;
  protocol: string | null;
  compatible: boolean;
  rejectionReason: string | null;
}

export interface ImportInspection {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration: number | null;
  thumbnail: string | null;
  webpageUrl: string;
  formats: ImportFormat[];
  compatibleFormats: ImportFormat[];
  recommendedFormatId: string | null;
  hasCompatible: boolean;
  policyMessage: string;
}

export interface ImportJob {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  formatId: string;
  status: ImportJobStatus;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  songId: string | null;
  sourceVideoId: string | null;
  sourceTitle: string | null;
  sourceArtist: string | null;
  measuredDuration: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  bitrateBitsPerSecond: number | null;
  bytes: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface CreateImportInput {
  url: string;
  title: string;
  artist: string;
  album?: string | null;
  formatId: string;
}

export interface DownloadedArtifact {
  path: string;
  sourceVideoId: string;
  sourceTitle: string;
  sourceArtist: string | null;
  sourceDuration: number | null;
  expectedSampleRate: number | null;
  expectedChannels: number | null;
  expectedBitrate: number | null;
}

export interface VerifiedArtifact {
  duration: number;
  sampleRateHz: number;
  channels: number;
  bitrateBitsPerSecond: number | null;
  bytes: number;
}

export interface ImportDependencyStatus {
  ready: boolean;
  items: Record<string, { available: boolean; message: string }>;
}

export class ImportError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

type RawFormat = Record<string, unknown>;
type RawInfo = Record<string, unknown>;
type SqlRow = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function lower(value: unknown): string {
  return text(value).toLowerCase();
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function integerOrNull(value: unknown): number | null {
  const result = numberOrNull(value);
  return result !== null && Number.isSafeInteger(Math.round(result)) ? Math.round(result) : null;
}

function safeJsonOutput(stdout: string): RawInfo {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed: unknown = JSON.parse(lines[index] as string);
      if (typeof parsed === 'object' && parsed !== null) return parsed as RawInfo;
    } catch {
      // A wrapper may print a harmless line before yt-dlp's JSON. Keep looking.
    }
  }
  throw new ImportError('INSPECTION_INVALID_RESPONSE', 'yt-dlp returned no usable video metadata.');
}

function processError(command: string, stderr: string, code: number | null): ImportError {
  const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
  return new ImportError(
    'DOWNLOADER_FAILED',
    `${command} failed${code === null ? '' : ` with exit code ${code}`}${detail ? `: ${detail}` : '.'}`,
  );
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

interface ProcessOptions {
  onStderr?: (chunk: string) => void;
  onChild?: (child: ChildProcess) => void;
  timeoutMs?: number;
}

function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  return new Promise((resolveProcess, rejectProcess) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      rejectProcess(new ImportError('DEPENDENCY_UNAVAILABLE', `${command} could not be started: ${String(error)}`));
      return;
    }
    options.onChild?.(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    timeout?.unref();
    if (!child.stdout || !child.stderr) {
      rejectProcess(new ImportError('DEPENDENCY_UNAVAILABLE', `${command} did not expose process output.`));
      child.kill();
      return;
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      // Metadata output is small. Bound unexpected output so a broken binary
      // cannot consume the import worker's memory budget.
      if (stdout.length < 4 * 1024 * 1024) stdout += chunk.slice(0, 4 * 1024 * 1024 - stdout.length);
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 4 * 1024 * 1024) stderr += chunk.slice(0, 4 * 1024 * 1024 - stderr.length);
      options.onStderr?.(chunk);
    });
    child.once('error', (error) => {
      rejectProcess(new ImportError('DEPENDENCY_UNAVAILABLE', `${command} could not be started: ${error.message}`));
    });
    child.once('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (timedOut) rejectProcess(new ImportError('PROCESS_TIMEOUT', `${command} exceeded its time limit.`));
      else if (code === 0) resolveProcess({ stdout, stderr });
      else rejectProcess(processError(command, stderr, code));
    });
  });
}

function ensurePrerecorded(info: RawInfo): void {
  const status = lower(info.live_status);
  if (info.is_live === true || ['is_live', 'is_upcoming', 'scheduled'].includes(status)) {
    throw new ImportError('LIVE_VIDEO_UNSUPPORTED', 'Live and upcoming videos are not supported; choose a prerecorded video.');
  }
}

export function validateYoutubeUrl(rawUrl: string): string {
  const candidate = rawUrl.trim();
  if (candidate.length === 0 || candidate.length > 2048) {
    throw new ImportError('INVALID_URL', 'Enter a single http(s) YouTube video URL.');
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ImportError('INVALID_URL', 'Enter a valid http(s) YouTube video URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new ImportError('INVALID_URL', 'Enter an http(s) YouTube URL without credentials.');
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const allowedHosts = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'www.youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
  ]);
  if (!allowedHosts.has(hostname)) throw new ImportError('INVALID_URL', 'Only YouTube video URLs are supported.');
  if (parsed.port !== '' && parsed.port !== '80' && parsed.port !== '443') {
    throw new ImportError('INVALID_URL', 'Non-standard URL ports are not accepted.');
  }
  let videoId = '';
  if (hostname.endsWith('youtu.be')) {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) throw new ImportError('INVALID_URL', 'Only one YouTube video URL is supported.');
    videoId = parts[0] ?? '';
  } else {
    const pathname = parsed.pathname.replace(/\/$/, '') || '/';
    if (pathname === '/watch') {
      videoId = parsed.searchParams.get('v') ?? '';
    } else {
      videoId = /^(?:\/shorts|\/embed|\/live)\/([^/?#]+)$/.exec(pathname)?.[1] ?? '';
      if (!videoId) throw new ImportError('INVALID_URL', 'Only one YouTube video URL is supported.');
    }
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new ImportError('INVALID_URL', 'Enter a single YouTube video URL with a video ID.');
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function rejectionReason(format: RawFormat): string | null {
  const ext = lower(format.ext);
  if (!['m4a', 'mp4'].includes(ext)) return 'container is not M4A/MP4';
  if (format.has_drm || format.drm || ['true', 'yes'].includes(lower(format.drm))) return 'stream is DRM-protected';
  const vcodec = lower(format.vcodec);
  if (vcodec !== '' && !['none', '-'].includes(vcodec)) return 'stream also contains video';
  const acodec = lower(format.acodec);
  if (acodec !== 'mp4a.40.2') {
    if (acodec.startsWith('mp4a.40.5') || acodec.startsWith('mp4a.40.29')) return 'AAC profile is HE-AAC, not AAC-LC';
    if (['opus', 'vorbis', 'mp4a.40.34'].includes(acodec)) return `codec is ${acodec}, not AAC-LC`;
    return 'codec is not the native AAC-LC profile (mp4a.40.2)';
  }
  return null;
}

function formatQuality(format: RawFormat): [number, number, number, number] {
  return [
    numberOrNull(format.abr) ?? numberOrNull(format.tbr) ?? 0,
    numberOrNull(format.asr) ?? 0,
    numberOrNull(format.audio_channels) ?? 0,
    lower(format.ext) === 'm4a' ? 1 : 0,
  ];
}

function compareQuality(left: RawFormat, right: RawFormat): number {
  const a = formatQuality(left);
  const b = formatQuality(right);
  for (let index = 0; index < a.length; index += 1) {
    const leftValue = a[index] ?? 0;
    const rightValue = b[index] ?? 0;
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  return text(right.format_id).localeCompare(text(left.format_id));
}

function publicFormat(format: RawFormat): ImportFormat {
  const reason = rejectionReason(format);
  return {
    formatId: text(format.format_id),
    ext: lower(format.ext),
    acodec: text(format.acodec),
    vcodec: text(format.vcodec),
    abr: numberOrNull(format.abr),
    asr: integerOrNull(format.asr),
    audioChannels: integerOrNull(format.audio_channels),
    filesize: integerOrNull(format.filesize) ?? integerOrNull(format.filesize_approx),
    protocol: text(format.protocol) || null,
    compatible: reason === null,
    rejectionReason: reason,
  };
}

function chooseFormat(formats: RawFormat[], requestedFormatId?: string): RawFormat {
  if (requestedFormatId) {
    const requested = formats.find((format) => text(format.format_id) === requestedFormatId);
    if (!requested) throw new ImportError('FORMAT_UNAVAILABLE', `Requested format ${requestedFormatId} was not found.`);
    const reason = rejectionReason(requested);
    if (reason) {
      throw new ImportError(
        'INCOMPATIBLE_FORMAT',
        `Requested format ${requestedFormatId} is rejected: ${reason}. Choose a native AAC-LC M4A stream.`,
      );
    }
    return requested;
  }
  const compatible = formats.filter((format) => rejectionReason(format) === null).sort(compareQuality);
  if (compatible.length === 0) {
    const observed = [...new Set(formats.map((format) => text(format.acodec)).filter(Boolean))].sort().join(', ') || 'no audio formats';
    throw new ImportError(
      'INCOMPATIBLE_FORMAT',
      `This video does not provide a native AAC-LC audio stream in an M4A/MP4 container (observed codecs: ${observed}). No lossy fallback or transcoding is available.`,
    );
  }
  return compatible[0] as RawFormat;
}

function ytDlpArgs(_executable: string, url: string, mode: 'inspect' | 'download', formatId?: string, outputPath?: string, ffmpegPath?: string): string[] {
  const args = [
    '--ignore-config',
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes',
    'node',
    '--socket-timeout',
    '30',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
  ];
  const remoteComponents = process.env.YTDLP_REMOTE_COMPONENTS?.trim();
  if (remoteComponents) args.push('--remote-components', remoteComponents);
  const cacheDirectory = process.env.YTDLP_CACHE_DIR?.trim();
  if (cacheDirectory) args.push('--cache-dir', cacheDirectory);
  if (mode === 'inspect') return [...args, '--dump-single-json', '--skip-download', url];
  return [
    ...args,
    '--format',
    formatId ?? '',
    '--output',
    outputPath ?? '',
    '--progress',
    '--newline',
    '--progress-template',
    'download:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s',
    '--ffmpeg-location',
    ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg',
    url,
  ];
}

function infoFormats(info: RawInfo): RawFormat[] {
  return Array.isArray(info.formats) ? info.formats.filter((format): format is RawFormat => typeof format === 'object' && format !== null) : [];
}

export async function inspectVideo(url: string, ytDlpPath = 'yt-dlp'): Promise<ImportInspection> {
  const canonicalUrl = validateYoutubeUrl(url);
  let result: ProcessResult;
  try {
    result = await runProcess(ytDlpPath, ytDlpArgs(ytDlpPath, canonicalUrl, 'inspect'), { timeoutMs: 90_000 });
  } catch (error) {
    if (error instanceof ImportError && error.code === 'DEPENDENCY_UNAVAILABLE') throw error;
    throw new ImportError('INSPECTION_FAILED', error instanceof Error ? error.message : String(error));
  }
  const info = safeJsonOutput(result.stdout);
  if (text(info._type) === 'playlist' || Array.isArray(info.entries)) {
    throw new ImportError('PLAYLIST_UNSUPPORTED', 'A single YouTube video is required; playlists are not supported.');
  }
  ensurePrerecorded(info);
  const formats = infoFormats(info);
  let recommended: RawFormat | undefined;
  try {
    recommended = chooseFormat(formats);
  } catch (error) {
    if (!(error instanceof ImportError) || error.code !== 'INCOMPATIBLE_FORMAT') throw error;
  }
  const publicFormats = formats.filter((format) => text(format.acodec)).map(publicFormat);
  const compatibleFormats = publicFormats.filter((format) => format.compatible);
  return {
    id: text(info.id),
    title: text(info.title) || 'Untitled video',
    artist: text(info.artist) || (Array.isArray(info.artists) ? text(info.artists[0]) : '') || text(info.uploader) || text(info.channel) || null,
    album: text(info.album) || null,
    duration: numberOrNull(info.duration),
    thumbnail: text(info.thumbnail) || null,
    webpageUrl: text(info.webpage_url) || canonicalUrl,
    formats: publicFormats,
    compatibleFormats,
    recommendedFormatId: recommended ? text(recommended.format_id) : null,
    hasCompatible: compatibleFormats.length > 0,
    policyMessage: recommended
      ? 'Selected the highest-quality native AAC-LC stream provided by YouTube.'
      : 'No native AAC-LC M4A stream is available. The app will not transcode another codec.',
  };
}

async function findArtifact(directory: string): Promise<string> {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && ['.m4a', '.mp4'].some((extension) => entry.name.toLowerCase().endsWith(extension)))
    .map((entry) => entry.name);
  if (names.length === 0) throw new ImportError('ARTIFACT_MISSING', 'yt-dlp finished without producing an M4A/MP4 audio artifact.');
  const details = await Promise.all(names.map(async (name) => ({ name, mtime: (await stat(join(directory, name))).mtimeMs })));
  details.sort((left, right) => right.mtime - left.mtime);
  return join(directory, details[0]?.name as string);
}

async function streamCopyToM4a(source: string, destination: string, ffmpegPath: string): Promise<void> {
  try {
    await runProcess(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      source,
      '-map',
      '0:a:0',
      '-vn',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      destination,
    ], { timeoutMs: 120_000 });
  } catch (error) {
    throw new ImportError('REMUX_FAILED', error instanceof Error ? error.message : String(error));
  }
  await unlink(source).catch(() => undefined);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array);
  return hash.digest('hex');
}

export async function downloadNativeAac(
  url: string,
  outputDirectory: string,
  requestedFormatId: string,
  paths: { ytDlpPath?: string; ffmpegPath?: string; ffprobePath?: string } = {},
  onProgress?: (progress: number) => void,
): Promise<DownloadedArtifact> {
  const canonicalUrl = validateYoutubeUrl(url);
  const inspection = await inspectVideo(canonicalUrl, paths.ytDlpPath ?? 'yt-dlp');
  const requested = inspection.formats.find((format) => format.formatId === requestedFormatId);
  if (!requested) throw new ImportError('FORMAT_UNAVAILABLE', `Requested format ${requestedFormatId} was not found.`);
  if (!requested.compatible) {
    throw new ImportError(
      'INCOMPATIBLE_FORMAT',
      `Requested format ${requestedFormatId} is rejected: ${requested.rejectionReason ?? 'it is not a native AAC-LC stream'}.`,
    );
  }
  const selected = chooseFormat([{
    format_id: requested.formatId,
    ext: requested.ext,
    acodec: requested.acodec,
    vcodec: requested.vcodec,
    abr: requested.abr,
    asr: requested.asr,
    audio_channels: requested.audioChannels,
  }], requestedFormatId);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  const outputTemplate = join(outputDirectory, 'audio.%(ext)s');
  let lastProgress = 0;
  await runProcess(
    paths.ytDlpPath ?? 'yt-dlp',
    ytDlpArgs(paths.ytDlpPath ?? 'yt-dlp', canonicalUrl, 'download', text(selected.format_id), outputTemplate, paths.ffmpegPath),
    {
      timeoutMs: 30 * 60 * 1000,
      onStderr: (chunk) => {
        for (const line of chunk.split(/\r?\n/)) {
          const match = /download:\s*([0-9]+(?:\.[0-9]+)?)%\|/.exec(line);
          if (match) {
            const value = Math.max(0, Math.min(100, Number(match[1])));
            if (Number.isFinite(value) && value >= lastProgress) {
              lastProgress = value;
              onProgress?.(value);
            }
          }
        }
      },
    },
  );
  const artifact = await findArtifact(outputDirectory);
  const expected = {
    expectedSampleRate: integerOrNull(selected.asr),
    expectedChannels: integerOrNull(selected.audio_channels),
    expectedBitrate: (numberOrNull(selected.abr) ?? numberOrNull(selected.tbr)) === null
      ? null
      : Math.round((numberOrNull(selected.abr) ?? numberOrNull(selected.tbr) ?? 0) * 1000),
  };
  // Verify the file produced for the selected format before any MP4 → M4A
  // stream copy. This prevents a changed format ID containing video from
  // being silently reduced to its audio stream by the remux step.
  await probeNativeAac(artifact, expected, paths.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe');
  const finalArtifact = join(outputDirectory, 'native-audio.m4a');
  if (artifact.toLowerCase().endsWith('.mp4')) {
    await streamCopyToM4a(artifact, finalArtifact, paths.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg');
  } else if (artifact !== finalArtifact) {
    await rename(artifact, finalArtifact);
  }
  onProgress?.(100);
  return {
    path: finalArtifact,
    sourceVideoId: inspection.id,
    sourceTitle: inspection.title,
    sourceArtist: inspection.artist,
    sourceDuration: inspection.duration,
    expectedSampleRate: expected.expectedSampleRate,
    expectedChannels: expected.expectedChannels,
    expectedBitrate: expected.expectedBitrate,
  };
}

export async function probeNativeAac(
  artifactPath: string,
  expected: Pick<DownloadedArtifact, 'expectedSampleRate' | 'expectedChannels' | 'expectedBitrate'>,
  ffprobePath = 'ffprobe',
): Promise<VerifiedArtifact> {
  if (!['.m4a', '.mp4'].includes(resolve(artifactPath).toLowerCase().slice(-4))) {
    throw new ImportError('INVALID_ARTIFACT', 'The downloaded artifact is not an M4A/MP4 file.');
  }
  let result: ProcessResult;
  try {
    result = await runProcess(ffprobePath, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      artifactPath,
    ], { timeoutMs: 30_000 });
  } catch (error) {
    throw new ImportError('VERIFICATION_FAILED', error instanceof Error ? error.message : String(error));
  }
  let payload: { streams?: unknown; format?: unknown };
  try {
    payload = JSON.parse(result.stdout) as { streams?: unknown; format?: unknown };
  } catch {
    throw new ImportError('VERIFICATION_FAILED', 'ffprobe returned invalid metadata for the artifact.');
  }
  const streams = Array.isArray(payload.streams) ? payload.streams.filter((value): value is RawInfo => typeof value === 'object' && value !== null) : [];
  const audioStreams = streams.filter((stream) => lower(stream.codec_type) === 'audio');
  if (streams.length !== 1 || audioStreams.length !== 1) {
    throw new ImportError('INVALID_ARTIFACT', 'The output is not an audio-only M4A artifact.');
  }
  const stream = audioStreams[0] as RawInfo;
  const codec = lower(stream.codec_name);
  const profile = upperProfile(stream.profile);
  if (codec !== 'aac' || profile !== 'LC') {
    throw new ImportError('INVALID_ARTIFACT', `The output is not native AAC-LC (ffprobe reported codec=${codec || 'unknown'}, profile=${profile || 'unknown'}).`);
  }
  if (lower(stream.codec_tag_string) !== 'mp4a') {
    throw new ImportError('INVALID_ARTIFACT', `The output does not use the unencrypted MP4 AAC tag (ffprobe reported ${text(stream.codec_tag_string) || 'unknown'}).`);
  }
  const format = typeof payload.format === 'object' && payload.format !== null ? (payload.format as RawInfo) : {};
  const formatName = lower(format.format_name);
  if (!formatName.split(',').some((name) => ['mov', 'mp4', 'm4a'].includes(name))) {
    throw new ImportError('INVALID_ARTIFACT', 'The output container is not an MP4/M4A container.');
  }
  const sampleRate = integerOrNull(stream.sample_rate);
  const channels = integerOrNull(stream.channels);
  const bitrate = integerOrNull(stream.bit_rate) ?? integerOrNull(format.bit_rate);
  if (sampleRate === null || channels === null) throw new ImportError('INVALID_ARTIFACT', 'ffprobe did not measure sample rate and channels.');
  if (expected.expectedSampleRate !== null && sampleRate !== expected.expectedSampleRate) {
    throw new ImportError('INVALID_ARTIFACT', `Sample rate changed from ${expected.expectedSampleRate} Hz to ${sampleRate} Hz; refusing the output.`);
  }
  if (expected.expectedChannels !== null && channels !== expected.expectedChannels) {
    throw new ImportError('INVALID_ARTIFACT', `Channel count changed from ${expected.expectedChannels} to ${channels}; refusing the output.`);
  }
  if (expected.expectedBitrate !== null && bitrate !== null) {
    const tolerance = Math.max(5000, expected.expectedBitrate * 0.12);
    if (Math.abs(bitrate - expected.expectedBitrate) > tolerance) {
      throw new ImportError('INVALID_ARTIFACT', `Bitrate changed from about ${expected.expectedBitrate} bit/s to ${bitrate} bit/s; refusing the output.`);
    }
  }
  const duration = numberOrNull(format.duration) ?? numberOrNull(stream.duration);
  if (duration === null || duration <= 0 || duration > 86400) throw new ImportError('INVALID_ARTIFACT', 'ffprobe did not measure a valid audio duration.');
  return {
    duration,
    sampleRateHz: sampleRate,
    channels,
    bitrateBitsPerSecond: bitrate,
    bytes: (await stat(artifactPath)).size,
  };
}

function upperProfile(value: unknown): string {
  return text(value).toUpperCase().replace(/^AAC[- ]?/, '');
}

type SqlInput = null | number | bigint | string;

function sqlValue(value: unknown): SqlInput {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  throw new Error('Import job field cannot be stored in SQLite');
}

export class ImportStore {
  public constructor(private readonly db: DatabaseSync) {}

  public create(input: CreateImportInput): ImportJob {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO import_jobs (id, url, title, artist, album, format_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `).run(id, input.url, input.title, input.artist, input.album ?? null, input.formatId, now, now);
    return this.get(id) as ImportJob;
  }

  public get(id: string): ImportJob | undefined {
    const row = this.db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id) as SqlRow | undefined;
    return row ? mapJob(row) : undefined;
  }

  public list(limit = 50): ImportJob[] {
    const rows = this.db.prepare('SELECT * FROM import_jobs ORDER BY created_at DESC, id DESC LIMIT ?').all(Math.max(1, Math.min(200, limit))) as SqlRow[];
    return rows.map(mapJob);
  }

  public getInternal(id: string): SqlRow | undefined {
    return this.db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(id) as SqlRow | undefined;
  }

  public update(id: string, fields: Record<string, unknown>): ImportJob {
    const allowed = new Set([
      'status',
      'progress',
      'error_code',
      'error_message',
      'song_id',
      'source_video_id',
      'source_title',
      'source_artist',
      'measured_duration_seconds',
      'sample_rate_hz',
      'channels',
      'bitrate_bits_per_second',
      'bytes',
      'started_at',
      'completed_at',
    ]);
    for (const key of Object.keys(fields)) if (!allowed.has(key)) throw new Error(`Unsupported import job field: ${key}`);
    const assignments = Object.keys(fields).map((key) => `${key} = ?`);
    assignments.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
    const values = [...Object.keys(fields).map((key) => sqlValue(fields[key])), id];
    this.db.prepare(`UPDATE import_jobs SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
    const updated = this.get(id);
    if (!updated) throw new Error(`Import job disappeared: ${id}`);
    return updated;
  }

  public markInterrupted(): number {
    const result = this.db.prepare(`
      UPDATE import_jobs
      SET status = 'failed', error_code = 'SERVER_RESTARTED',
          error_message = 'The server restarted before this import finished.',
          completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE status IN ('queued', 'downloading', 'verifying', 'publishing')
    `).run();
    return Number(result.changes);
  }

  public publishSong(
    jobId: string,
    song: { id: string; title: string; artist: string; album: string | null; duration: number; filePath: string; audioSha256: string },
    measured: VerifiedArtifact,
    source: DownloadedArtifact,
  ): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO songs (id, title, artist, album, duration_seconds, file_path, audio_sha256, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).run(song.id, song.title, song.artist, song.album, song.duration, song.filePath, song.audioSha256);
      this.db.prepare(`
        UPDATE import_jobs
        SET status = 'completed', progress = 100, song_id = ?, source_video_id = ?,
            source_title = ?, source_artist = ?, measured_duration_seconds = ?,
            sample_rate_hz = ?, channels = ?, bitrate_bits_per_second = ?, bytes = ?,
            completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(
        song.id,
        source.sourceVideoId,
        source.sourceTitle,
        source.sourceArtist,
        measured.duration,
        measured.sampleRateHz,
        measured.channels,
        measured.bitrateBitsPerSecond,
        measured.bytes,
        jobId,
      );
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Preserve the original database failure.
      }
      throw error;
    }
  }
}

function mapJob(row: SqlRow): ImportJob {
  return {
    id: text(row.id),
    title: text(row.title),
    artist: text(row.artist),
    album: row.album === null || row.album === undefined ? null : text(row.album),
    formatId: text(row.format_id),
    status: text(row.status) as ImportJobStatus,
    progress: numberOrNull(row.progress) ?? 0,
    errorCode: row.error_code === null || row.error_code === undefined ? null : text(row.error_code),
    errorMessage: row.error_message === null || row.error_message === undefined ? null : text(row.error_message),
    songId: row.song_id === null || row.song_id === undefined ? null : text(row.song_id),
    sourceVideoId: row.source_video_id === null || row.source_video_id === undefined ? null : text(row.source_video_id),
    sourceTitle: row.source_title === null || row.source_title === undefined ? null : text(row.source_title),
    sourceArtist: row.source_artist === null || row.source_artist === undefined ? null : text(row.source_artist),
    measuredDuration: numberOrNull(row.measured_duration_seconds),
    sampleRateHz: integerOrNull(row.sample_rate_hz),
    channels: integerOrNull(row.channels),
    bitrateBitsPerSecond: integerOrNull(row.bitrate_bits_per_second),
    bytes: integerOrNull(row.bytes),
    createdAt: text(row.created_at),
    startedAt: row.started_at === null || row.started_at === undefined ? null : text(row.started_at),
    completedAt: row.completed_at === null || row.completed_at === undefined ? null : text(row.completed_at),
    updatedAt: text(row.updated_at),
  };
}

interface ImportServiceOptions {
  ytDlpPath?: string | undefined;
  ffmpegPath?: string | undefined;
  ffprobePath?: string | undefined;
  stagingRoot?: string | undefined;
  inspect?: (url: string, path: string) => Promise<ImportInspection>;
  download?: typeof downloadNativeAac;
  probe?: typeof probeNativeAac;
}

export class ImportService {
  private readonly store: ImportStore;
  private readonly audioRoot: string;
  private readonly ytDlpPath: string;
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly stagingRoot: string;
  private readonly inspectFn: NonNullable<ImportServiceOptions['inspect']>;
  private readonly downloadFn: NonNullable<ImportServiceOptions['download']>;
  private readonly probeFn: NonNullable<ImportServiceOptions['probe']>;
  private readonly pending: string[] = [];
  private running = false;

  public constructor(private readonly db: DatabaseSync, audioRoot: string, options: ImportServiceOptions = {}) {
    this.store = new ImportStore(db);
    this.audioRoot = resolve(audioRoot);
    this.ytDlpPath = options.ytDlpPath ?? 'yt-dlp';
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.stagingRoot = resolve(options.stagingRoot ?? join(this.audioRoot, '.import-staging'));
    const stagingRemainder = relative(this.audioRoot, this.stagingRoot);
    if (stagingRemainder === '' || stagingRemainder === '..' || stagingRemainder.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(stagingRemainder)) {
      throw new Error('IMPORT_STAGING_ROOT must be a child directory of AUDIO_ROOT for atomic publication.');
    }
    this.inspectFn = options.inspect ?? inspectVideo;
    this.downloadFn = options.download ?? downloadNativeAac;
    this.probeFn = options.probe ?? probeNativeAac;
    this.store.markInterrupted();
  }

  public async inspect(url: string): Promise<ImportInspection> {
    return this.inspectFn(validateYoutubeUrl(url), this.ytDlpPath);
  }

  public create(input: CreateImportInput): ImportJob {
    const canonicalUrl = validateYoutubeUrl(input.url);
    const title = requiredText(input.title, 'title', 500);
    const artist = requiredText(input.artist, 'artist', 500);
    const album = optionalText(input.album, 500);
    const formatId = requiredText(input.formatId, 'format_id', 128);
    if (!/^[A-Za-z0-9+._-]+$/.test(formatId)) throw new ImportError('INVALID_FORMAT', 'The selected format identifier is invalid.');
    const job = this.store.create({ url: canonicalUrl, title, artist, album, formatId });
    this.pending.push(job.id);
    void this.pump();
    return job;
  }

  public retry(id: string): ImportJob {
    const previous = this.store.getInternal(id);
    if (!previous) throw new ImportError('JOB_NOT_FOUND', 'Import job not found.');
    if (text(previous.status) !== 'failed') throw new ImportError('JOB_NOT_RETRYABLE', 'Only failed imports can be retried.');
    return this.create({
      url: text(previous.url),
      title: text(previous.title),
      artist: text(previous.artist),
      album: previous.album === null || previous.album === undefined ? null : text(previous.album),
      formatId: text(previous.format_id),
    });
  }

  public get(id: string): ImportJob | undefined {
    return this.store.get(id);
  }

  public list(limit?: number): ImportJob[] {
    return this.store.list(limit);
  }

  public async dependencyStatus(): Promise<ImportDependencyStatus> {
    const entries = await Promise.all([
      ['yt_dlp', this.ytDlpPath, '--version'],
      ['ffmpeg', this.ffmpegPath, '-version'],
      ['ffprobe', this.ffprobePath, '-version'],
    ].map(async ([name, command, versionArg]) => {
      try {
        await runProcess(command as string, [versionArg as string], { timeoutMs: 5_000 });
        return [name, { available: true, message: `${name} is ready.` }] as const;
      } catch (error) {
        return [name, { available: false, message: error instanceof Error ? error.message : `${name} is unavailable.` }] as const;
      }
    }));
    const items: Record<string, { available: boolean; message: string }> = Object.fromEntries(entries);
    return { ready: Object.values(items).every((item) => item.available), items };
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length > 0) {
        const id = this.pending.shift() as string;
        await this.run(id);
      }
    } finally {
      this.running = false;
    }
  }

  private async run(id: string): Promise<void> {
    const internal = this.store.getInternal(id);
    if (!internal) return;
    const staging = join(this.stagingRoot, id);
    let finalPath: string | undefined;
    let committed = false;
    try {
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      this.store.update(id, { status: 'downloading', progress: 0, started_at: new Date().toISOString(), error_code: null, error_message: null });
      const downloaded = await this.downloadFn(
        text(internal.url),
        staging,
        text(internal.format_id),
        { ytDlpPath: this.ytDlpPath, ffmpegPath: this.ffmpegPath, ffprobePath: this.ffprobePath },
        (progress) => {
          try {
            this.store.update(id, { status: 'downloading', progress });
          } catch {
            // A late progress line must not hide the worker's actual failure.
          }
        },
      );
      this.store.update(id, { status: 'verifying', progress: 100 });
      const measured = await this.probeFn(downloaded.path, downloaded, this.ffprobePath);
      this.store.update(id, {
        status: 'publishing',
        progress: 100,
        source_video_id: downloaded.sourceVideoId,
        source_title: downloaded.sourceTitle,
        source_artist: downloaded.sourceArtist,
        measured_duration_seconds: measured.duration,
        sample_rate_hz: measured.sampleRateHz,
        channels: measured.channels,
        bitrate_bits_per_second: measured.bitrateBitsPerSecond,
        bytes: measured.bytes,
      });
      const songId = `import-${randomUUID()}`;
      const filePath = `imports/${songId}.m4a`;
      finalPath = join(this.audioRoot, filePath);
      await mkdir(join(this.audioRoot, 'imports'), { recursive: true });
      await rename(downloaded.path, finalPath);
      const audioSha256 = await sha256File(finalPath);
      this.store.publishSong(
        id,
        {
          id: songId,
          title: text(internal.title),
          artist: text(internal.artist),
          album: internal.album === null || internal.album === undefined ? null : text(internal.album),
          duration: measured.duration,
          filePath,
          audioSha256,
        },
        measured,
        downloaded,
      );
      committed = true;
      // The catalogue row and final file are already published. Staging
      // cleanup is best-effort and must never turn a successful import into a
      // broken catalogue row.
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    } catch (error) {
      if (finalPath && !committed) await unlink(finalPath).catch(() => undefined);
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      const failure = error instanceof ImportError ? error : new ImportError('IMPORT_FAILED', error instanceof Error ? error.message : String(error));
      try {
        this.store.update(id, { status: 'failed', error_code: failure.code, error_message: failure.message, completed_at: new Date().toISOString() });
      } catch {
        // Preserve the original failure if the database is already closing.
      }
    }
  }
}

function requiredText(value: unknown, field: string, max: number): string {
  const result = text(value);
  if (!result) throw new ImportError('INVALID_METADATA', `${field} is required.`);
  if (result.length > max) throw new ImportError('INVALID_METADATA', `${field} is too long.`);
  return result;
}

function optionalText(value: unknown, max: number): string | null {
  const result = text(value);
  if (!result) return null;
  if (result.length > max) throw new ImportError('INVALID_METADATA', 'album is too long.');
  return result;
}
