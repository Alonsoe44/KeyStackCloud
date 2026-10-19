import type { DatabaseSync } from 'node:sqlite';

export const LYRICS_SCHEMA_VERSION = 1 as const;
export const LYRICS_REVIEW_STATUS = 'complete' as const;

export interface LyricWord {
  id: string;
  text: string;
  startMs: number;
  endMs?: number;
}

export interface LyricLine {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  words: LyricWord[];
}

export interface LyricsDocument {
  schemaVersion: typeof LYRICS_SCHEMA_VERSION;
  songId: string;
  audioSha256: string | null;
  language: string;
  reviewStatus: typeof LYRICS_REVIEW_STATUS;
  lines: LyricLine[];
  documentVersion: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ValidatedLyricsInput {
  schemaVersion: typeof LYRICS_SCHEMA_VERSION;
  songId: string;
  audioSha256: string | null;
  language: string;
  reviewStatus: typeof LYRICS_REVIEW_STATUS;
  lines: LyricLine[];
}

export class LyricsError extends Error {
  public constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'LyricsError';
  }
}

type RecordValue = Record<string, unknown>;

function record(value: unknown, message: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LyricsError('INVALID_LYRICS', message);
  }
  return value as RecordValue;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new LyricsError('INVALID_LYRICS', `${field} must be text.`);
  const result = value.trim();
  if (result.length === 0) throw new LyricsError('INVALID_LYRICS', `${field} must not be empty.`);
  if (result.length > max) throw new LyricsError('INVALID_LYRICS', `${field} is too long.`);
  return result;
}

function id(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  return text(value, 'id', 200);
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new LyricsError('INVALID_LYRICS', `${field} must be a non-negative integer in milliseconds.`);
  }
  return Number(value);
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return integer(value, field);
}

function sha256(value: unknown, expected: string | null): string | null {
  if (value === undefined) {
    if (expected !== null) throw new LyricsError('AUDIO_VERSION_REQUIRED', 'Save the timing against the current recording hash.');
    return null;
  }
  if (value === null) {
    if (expected !== null) throw new LyricsError('AUDIO_VERSION_MISMATCH', 'Lyrics belong to a different audio recording.');
    return null;
  }
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new LyricsError('INVALID_LYRICS', 'audioSha256 must be a SHA-256 hex string or null.');
  }
  if (expected === null || value.toLowerCase() !== expected.toLowerCase()) {
    throw new LyricsError('AUDIO_VERSION_MISMATCH', 'Lyrics belong to a different audio recording.');
  }
  return expected;
}

function parseWord(value: unknown, lineIndex: number, wordIndex: number, lineStart: number, lineEnd: number): LyricWord {
  const item = record(value, `Line ${lineIndex + 1} has an invalid word.`);
  const wordStart = integer(item.startMs, `Line ${lineIndex + 1} word ${wordIndex + 1} startMs`);
  const wordEnd = optionalInteger(item.endMs, `Line ${lineIndex + 1} word ${wordIndex + 1} endMs`);
  if (wordStart < lineStart || wordStart >= lineEnd) {
    throw new LyricsError('INVALID_LYRICS', `Word ${wordIndex + 1} in line ${lineIndex + 1} is outside its line.`);
  }
  if (wordEnd !== undefined && (wordEnd <= wordStart || wordEnd > lineEnd)) {
    throw new LyricsError('INVALID_LYRICS', `Word ${wordIndex + 1} in line ${lineIndex + 1} has an invalid end.`);
  }
  return {
    id: id(item.id, `line-${lineIndex + 1}-word-${wordIndex + 1}`),
    text: text(item.text, `Line ${lineIndex + 1} word ${wordIndex + 1} text`, 500),
    startMs: wordStart,
    ...(wordEnd === undefined ? {} : { endMs: wordEnd }),
  };
}

/** Validate and normalize a complete document before it is persisted. */
export function validateLyricsPayload(
  value: unknown,
  songId: string,
  audioSha256: string | null,
  durationSeconds: number,
): ValidatedLyricsInput {
  const body = record(value, 'Lyrics must be a JSON object.');
  if (body.schemaVersion !== LYRICS_SCHEMA_VERSION) {
    throw new LyricsError('UNSUPPORTED_LYRICS_VERSION', `Only lyrics schema version ${LYRICS_SCHEMA_VERSION} is supported.`);
  }
  if (body.songId !== undefined && body.songId !== songId) {
    throw new LyricsError('LYRICS_SONG_MISMATCH', 'Lyrics songId does not match the requested song.');
  }
  const language = text(body.language, 'language', 32);
  if (body.reviewStatus !== undefined && body.reviewStatus !== LYRICS_REVIEW_STATUS) {
    throw new LyricsError('INVALID_LYRICS_STATUS', 'Only complete lyrics can be saved.');
  }
  const sourceLines = body.lines;
  if (!Array.isArray(sourceLines) || sourceLines.length === 0 || sourceLines.length > 2000) {
    throw new LyricsError('INVALID_LYRICS', 'Lyrics must contain between 1 and 2000 lines.');
  }
  const maxTimestamp = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.ceil(durationSeconds * 1000) + 1000
    : Number.MAX_SAFE_INTEGER;
  const lines: LyricLine[] = [];
  let previousStart = -1;
  let previousEnd = -1;
  let totalCharacters = 0;
  const lineIds = new Set<string>();
  const wordIds = new Set<string>();
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const item = record(sourceLines[lineIndex], `Line ${lineIndex + 1} is invalid.`);
    const startMs = integer(item.startMs, `Line ${lineIndex + 1} startMs`);
    const endMs = integer(item.endMs, `Line ${lineIndex + 1} endMs`);
    const lineText = text(item.text, `Line ${lineIndex + 1} text`, 4000);
    if (endMs <= startMs) throw new LyricsError('INVALID_LYRICS', `Line ${lineIndex + 1} must end after it starts.`);
    if (startMs < previousStart || startMs < previousEnd || endMs < previousEnd) {
      throw new LyricsError('NON_MONOTONIC_TIMESTAMPS', 'Line timestamps must be monotonic.');
    }
    if (endMs > maxTimestamp) throw new LyricsError('INVALID_LYRICS', `Line ${lineIndex + 1} is beyond the audio duration.`);
    const sourceWords = item.words;
    if (!Array.isArray(sourceWords) || sourceWords.length === 0 || sourceWords.length > 300) {
      throw new LyricsError('INVALID_LYRICS', `Line ${lineIndex + 1} must contain between 1 and 300 words.`);
    }
    const words: LyricWord[] = [];
    const lineId = id(item.id, `line-${lineIndex + 1}`);
    if (lineIds.has(lineId)) throw new LyricsError('INVALID_LYRICS', 'Line IDs must be unique.');
    lineIds.add(lineId);
    let previousWordStart = -1;
    let previousWordEnd: number | undefined;
    for (let wordIndex = 0; wordIndex < sourceWords.length; wordIndex += 1) {
      const word = parseWord(sourceWords[wordIndex], lineIndex, wordIndex, startMs, endMs);
      if (word.startMs < previousWordStart || (previousWordEnd !== undefined && word.startMs < previousWordEnd)) {
        throw new LyricsError('NON_MONOTONIC_TIMESTAMPS', `Word timestamps in line ${lineIndex + 1} must be monotonic.`);
      }
      if (wordIds.has(word.id)) throw new LyricsError('INVALID_LYRICS', 'Word IDs must be unique.');
      wordIds.add(word.id);
      previousWordStart = word.startMs;
      previousWordEnd = word.endMs;
      words.push(word);
    }
    const normalizedLineText = lineText.split(/\s+/).join(' ');
    const normalizedWordText = words.map((word) => word.text).join(' ');
    if (normalizedLineText !== normalizedWordText) {
      throw new LyricsError('INVALID_LYRICS', `Words in line ${lineIndex + 1} must match its text.`);
    }
    totalCharacters += lineText.length + words.reduce((sum, word) => sum + word.text.length, 0);
    if (totalCharacters > 200_000) throw new LyricsError('INVALID_LYRICS', 'Lyrics text is too large.');
    lines.push({ id: lineId, text: lineText, startMs, endMs, words });
    previousStart = startMs;
    previousEnd = endMs;
  }
  return {
    schemaVersion: LYRICS_SCHEMA_VERSION,
    songId,
    audioSha256: sha256(body.audioSha256, audioSha256),
    language,
    reviewStatus: LYRICS_REVIEW_STATUS,
    lines,
  };
}

type SqlRow = Record<string, unknown>;

function storedDocument(row: SqlRow): LyricsDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(row.lyrics_json));
  } catch {
    throw new LyricsError('LYRICS_STORAGE_INVALID', 'Stored lyrics could not be decoded.');
  }
  const validated = validateLyricsPayload(
    parsed,
    String(row.song_id),
    row.audio_sha256 === null || row.audio_sha256 === undefined ? null : String(row.audio_sha256),
    Number.MAX_SAFE_INTEGER,
  );
  return {
    ...validated,
    documentVersion: Number(row.document_version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class LyricsStore {
  public constructor(private readonly db: DatabaseSync) {}

  public get(songId: string): LyricsDocument | undefined {
    const row = this.db.prepare('SELECT * FROM song_lyrics WHERE song_id = ?').get(songId) as SqlRow | undefined;
    return row === undefined ? undefined : storedDocument(row);
  }

  public has(songId: string, audioSha256: string | null): boolean {
    const row = this.db.prepare(`
      SELECT 1 AS present
      FROM song_lyrics
      WHERE song_id = ?
        AND (audio_sha256 = ? OR (audio_sha256 IS NULL AND ? IS NULL))
      LIMIT 1
    `).get(songId, audioSha256, audioSha256) as SqlRow | undefined;
    return row !== undefined;
  }

  /** Replace the complete document atomically; the previous row survives any failure. */
  public replace(document: ValidatedLyricsInput): LyricsDocument {
    const now = new Date().toISOString();
    const previous = this.get(document.songId);
    const documentVersion = (previous?.documentVersion ?? 0) + 1;
    const json = JSON.stringify(document);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`
        INSERT INTO song_lyrics (
          song_id, schema_version, document_version, audio_sha256, language,
          review_status, lyrics_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(song_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          document_version = excluded.document_version,
          audio_sha256 = excluded.audio_sha256,
          language = excluded.language,
          review_status = excluded.review_status,
          lyrics_json = excluded.lyrics_json,
          updated_at = excluded.updated_at
      `).run(
        document.songId,
        document.schemaVersion,
        documentVersion,
        document.audioSha256,
        document.language,
        document.reviewStatus,
        json,
        previous?.createdAt ?? now,
        now,
      );
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Preserve the original storage error.
      }
      throw error;
    }
    const saved = this.get(document.songId);
    if (!saved) throw new LyricsError('LYRICS_STORAGE_FAILED', 'Lyrics were not available after saving.');
    return saved;
  }
}
