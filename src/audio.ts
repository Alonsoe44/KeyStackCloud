import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface AudioFile {
  absolutePath: string;
  size: number;
  mtimeMs: number;
  etag: string;
  lastModified: string;
}

export function isSafeRelativePath(filePath: string): boolean {
  if (filePath.length === 0 || filePath.includes('\0') || filePath.includes('\\') || isAbsolute(filePath)) {
    return false;
  }
  return !filePath.split('/').some((segment) => segment === '..');
}

function isContained(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate);
  return remainder === '' || (!remainder.startsWith(`..${sep}`) && remainder !== '..' && !isAbsolute(remainder));
}

export async function resolveAudioFile(audioRoot: string, filePath: string): Promise<AudioFile | undefined> {
  if (!isSafeRelativePath(filePath)) return undefined;

  let root: string;
  let candidate: string;
  try {
    root = await realpath(audioRoot);
    candidate = resolve(root, filePath);
    if (!isContained(root, candidate)) return undefined;
    candidate = await realpath(candidate);
    if (!isContained(root, candidate)) return undefined;
    const details = await stat(candidate);
    // An empty object cannot be a playable M4A and would otherwise produce an
    // invalid createReadStream range (0--1).
    if (!details.isFile() || details.size <= 0) return undefined;
    return {
      absolutePath: candidate,
      size: details.size,
      mtimeMs: details.mtimeMs,
      etag: `"${details.size.toString(16)}-${Math.floor(details.mtimeMs).toString(16)}"`,
      lastModified: new Date(details.mtimeMs).toUTCString(),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parse a byte range for a GET request. Malformed ranges and unknown range
 * units are ignored, while a syntactically valid range that cannot overlap
 * the selected representation is reported as unsatisfiable.
 */
export function parseSingleRange(value: string | undefined, size: number): ByteRange | 'unsatisfiable' | undefined {
  if (value === undefined) return undefined;
  const input = value.trim();
  const equals = input.indexOf('=');
  if (equals <= 0 || input.slice(0, equals).trim() !== 'bytes') return undefined;
  const expression = input.slice(equals + 1).trim();
  if (expression === '' || expression.includes(',')) return undefined;
  const separator = expression.indexOf('-');
  if (separator < 0 || expression.indexOf('-', separator + 1) >= 0) return undefined;
  const startText = expression.slice(0, separator).trim();
  const endText = expression.slice(separator + 1).trim();
  const decimal = (text: string): number | undefined => {
    if (!/^\d+$/.test(text)) return undefined;
    const number = Number(text);
    return Number.isSafeInteger(number) ? number : Number.MAX_SAFE_INTEGER;
  };
  if (startText === '' && endText === '') return undefined;

  if (startText === '') {
    const suffixLength = decimal(endText);
    if (suffixLength === undefined) return undefined;
    if (suffixLength <= 0 || size <= 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = decimal(startText);
  if (start === undefined) return undefined;
  if (start < 0 || start >= size) return 'unsatisfiable';
  if (endText === '') return { start, end: size - 1 };
  const requestedEnd = decimal(endText);
  if (requestedEnd === undefined) return undefined;
  if (requestedEnd < start) return 'unsatisfiable';
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function matchesIfRange(value: string | undefined, file: AudioFile): boolean {
  if (value === undefined) return true;
  const candidate = value.trim();
  if (candidate === file.etag) return true;
  const timestamp = Date.parse(candidate);
  return Number.isFinite(timestamp) && Math.floor(file.mtimeMs / 1000) * 1000 <= timestamp;
}

export function matchesIfNoneMatch(value: string | undefined, etag: string): boolean {
  if (value === undefined) return false;
  return value
    .split(',')
    .map((part) => part.trim())
    .some((part) => part === '*' || part === etag || part.replace(/^W\//, '') === etag);
}
