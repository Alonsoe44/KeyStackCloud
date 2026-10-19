#!/usr/bin/env node

const [url, ...options] = process.argv.slice(2);
if (!url) {
  console.error('Usage: node scripts/load-test.mjs URL [--clients N] [--seconds N] [--chunk-bytes N] [--pause-ms N]');
  process.exit(2);
}

function numberOption(name, fallback) {
  const index = options.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(options[index + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer`);
  return value;
}

const clients = numberOption('clients', 10);
const seconds = numberOption('seconds', 30);
const chunkBytes = numberOption('chunk-bytes', 256 * 1024);
const pauseMs = numberOption('pause-ms', 25);

function parseRangeEnd(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^bytes\s+(\d+)-(\d+)\/\d+$/.exec(value);
  return match === null ? undefined : Number(match[2]);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function streamOne(index) {
  const deadline = Date.now() + seconds * 1000;
  let bytes = 0;
  let requests = 0;
  let rangeResponses = 0;
  let fullResponses = 0;
  let offset = 0;
  let lastStatus = 0;
  let timedOut = false;
  let errorMessage;

  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
    try {
      const end = offset + chunkBytes - 1;
      const response = await fetch(url, {
        headers: { Range: `bytes=${offset}-${end}` },
        signal: controller.signal,
      });
      requests += 1;
      lastStatus = response.status;
      if (response.status === 416) {
        // The previous byte window reached the end of a finite track. Start
        // the next simulated track at byte zero.
        offset = 0;
        continue;
      }
      if (!response.ok || response.body === null) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (response.status === 206) rangeResponses += 1;
      else if (response.status === 200) fullResponses += 1;

      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (Date.now() >= deadline) break;
      }

      const responseEnd = parseRangeEnd(response.headers.get('content-range'));
      if (response.status === 206 && responseEnd !== undefined) offset = responseEnd + 1;
      else offset = 0;
      timedOut = Date.now() >= deadline;
    } catch (error) {
      if (controller.signal.aborted && Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      errorMessage = error instanceof Error ? error.message : String(error);
      break;
    } finally {
      clearTimeout(timeout);
    }
    if (!timedOut) await sleep(pauseMs);
  }

  if (Date.now() >= deadline) timedOut = true;
  if (errorMessage === undefined && bytes === 0) errorMessage = 'deadline reached before receiving bytes';
  const ok = errorMessage === undefined;
  return {
    index,
    ok,
    bytes,
    requests,
    rangeResponses,
    fullResponses,
    lastStatus,
    timedOut,
    ...(errorMessage === undefined ? {} : { error: errorMessage }),
  };
}

const startedAt = Date.now();
const results = await Promise.all(Array.from({ length: clients }, (_, index) => streamOne(index + 1)));
const totalBytes = results.reduce((sum, result) => sum + result.bytes, 0);
const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({
  url,
  clients,
  seconds,
  chunkBytes,
  pauseMs,
  elapsedMs: Date.now() - startedAt,
  totalBytes,
  failedClients: failed.length,
  results,
}, null, 2));
if (failed.length > 0) process.exitCode = 1;
