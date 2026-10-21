import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { Ajv } from 'ajv';
import * as AjvFormats from 'ajv-formats';
import type { AnySchema } from 'ajv';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildApp, type AppResources } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { openApiDocument } from '../src/openapi.js';

let root = '';
let resources: AppResources;
let discoveredRoutes = new Set<string>();
type AjvInstance = InstanceType<typeof Ajv>;
const addFormats = AjvFormats.default as unknown as (ajv: AjvInstance) => void;

type Schema = Record<string, unknown>;
type DereferencedDocument = {
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, Schema>;
    headers: Record<string, { schema: Schema }>;
  };
};

const httpMethods = new Set(['get', 'head', 'post', 'put', 'delete', 'options', 'patch', 'trace']);

function config(): AppConfig {
  return {
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
}

function toFastifyPath(path: string): string {
  return path.replace(/\{[^}]+\}/g, (parameter) => `:${parameter.slice(1, -1)}`);
}

function documentedRoutes(document: DereferencedDocument): Set<string> {
  const result = new Set<string>();
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (httpMethods.has(method) && operation && typeof operation === 'object') {
        result.add(`${method.toUpperCase()} ${toFastifyPath(path)}`);
      }
    }
  }
  return result;
}

function ajvSchema(schema: Schema): AnySchema {
  const clone = JSON.parse(JSON.stringify(schema)) as unknown;
  const convert = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(convert);
    if (typeof value !== 'object' || value === null) return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, convert(item)])) as Schema;
    // OpenAPI 3.0 spells exclusiveMinimum as a boolean alongside minimum;
    // Ajv's JSON Schema dialect expects the numeric boundary instead.
    if (result.exclusiveMinimum === true && typeof result.minimum === 'number') result.exclusiveMinimum = result.minimum;
    if (result.exclusiveMinimum === false) delete result.exclusiveMinimum;
    if (result.nullable === true) {
      if (typeof result.type === 'string') result.type = [result.type, 'null'];
      else if (Array.isArray(result.type) && !result.type.includes('null')) result.type = [...result.type, 'null'];
      if (Array.isArray(result.enum) && !result.enum.includes(null)) result.enum = [...result.enum, null];
      delete result.nullable;
    }
    return result;
  };
  return convert(clone) as AnySchema;
}

function assertValid(ajv: AjvInstance, schema: unknown, value: unknown, label: string): void {
  assert.equal(ajv.validate(ajvSchema(schema as Schema), value), true, `${label}: ${ajv.errorsText(ajv.errors)}`);
}

async function dereferencedDocument(): Promise<DereferencedDocument> {
  const cloned = JSON.parse(JSON.stringify(openApiDocument));
  await SwaggerParser.validate(cloned as never);
  return await SwaggerParser.dereference(cloned as never) as unknown as DereferencedDocument;
}

function assertExamplesValidate(document: DereferencedDocument, ajv: AjvInstance): number {
  let exampleCount = 0;
  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!httpMethods.has(method) || !operationValue || typeof operationValue !== 'object') continue;
      const operation = operationValue as Record<string, unknown>;
      const requestBody = operation.requestBody as Record<string, unknown> | undefined;
      const requestMedia = (requestBody?.content as Record<string, Record<string, unknown>> | undefined)?.['application/json'];
      const requestExamples = requestMedia?.examples as Record<string, Record<string, unknown>> | undefined;
      if (requestMedia?.schema && requestExamples) {
        for (const [name, item] of Object.entries(requestExamples)) {
          exampleCount += 1;
          assertValid(ajv, requestMedia.schema, item.value, `${method.toUpperCase()} ${path} request example ${name}`);
        }
      }

      const responses = operation.responses as Record<string, Record<string, unknown>>;
      for (const [status, response] of Object.entries(responses)) {
        const media = (response.content as Record<string, Record<string, unknown>> | undefined)?.['application/json'];
        const responseExamples = media?.examples as Record<string, Record<string, unknown>> | undefined;
        if (!media?.schema || !responseExamples) continue;
        for (const [name, item] of Object.entries(responseExamples)) {
          exampleCount += 1;
          assertValid(ajv, media.schema, item.value, `${method.toUpperCase()} ${path} ${status} example ${name}`);
        }
      }
    }
  }
  assert.ok(exampleCount >= 50, `expected substantial full example coverage, found ${exampleCount}`);
  return exampleCount;
}

function responseSchema(document: DereferencedDocument, path: string, method: string, status: string): Schema {
  const operation = document.paths[path]?.[method] as Record<string, unknown> | undefined;
  if (!operation) throw new Error(`Missing ${method.toUpperCase()} ${path}`);
  const response = (operation.responses as Record<string, Record<string, unknown>>)[status];
  if (!response) throw new Error(`Missing ${status} response for ${method.toUpperCase()} ${path}`);
  const media = (response.content as Record<string, Record<string, unknown>> | undefined)?.['application/json'];
  if (!media?.schema) throw new Error(`Missing JSON schema for ${status} response of ${method.toUpperCase()} ${path}`);
  return media.schema as Schema;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'songstreamer-openapi-test-'));
  await mkdir(join(root, 'audio'), { recursive: true });
  await mkdir(join(root, 'data'), { recursive: true });
  discoveredRoutes = new Set<string>();
  resources = await buildApp(config(), {
    onRoute: (route) => discoveredRoutes.add(`${route.method.toUpperCase()} ${route.url}`),
  });
});

afterEach(async () => {
  await resources.app.close();
  await rm(root, { recursive: true, force: true });
});

test('the OpenAPI document validates, covers the discovered route table, and has full examples', async () => {
  const document = await dereferencedDocument();
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const exampleCount = assertExamplesValidate(document, ajv);
  assert.deepEqual([...discoveredRoutes].sort(), [...documentedRoutes(document)].sort());
  assert.deepEqual(openApiDocument.security, []);
  assert.ok(exampleCount >= 50);
});

test('Scalar is served publicly with local pinned assets and a local JSON/YAML specification', async () => {
  const redirect = await resources.app.inject({ method: 'GET', url: '/docs' });
  assert.equal(redirect.statusCode, 301);
  assert.equal(redirect.headers.location, '/docs/');

  const html = await resources.app.inject({ method: 'GET', url: '/docs/' });
  assert.equal(html.statusCode, 200);
  assert.match(String(html.headers['content-type']), /^text\/html/);
  assert.match(html.body, /js\/scalar\.js/);
  assert.doesNotMatch(html.body, /cdn\.jsdelivr\.net|dashboard\.scalar\.com|registry\.scalar\.com|proxy\.scalar\.com/);
  assert.match(html.body, /"telemetry": false/);
  assert.match(html.body, /"disabled": true/);
  assert.match(html.body, /"proxyUrl": ""/);
  assert.match(html.body, /"dashboardUrl": ""/);
  assert.match(html.body, /"hideTestRequestButton": false/);
  assert.match(html.body, /"withDefaultFonts": false/);
  assert.match(html.body, /<title>SongStreamer API Reference<\/title>/);
  assert.match(html.body, /generate-sdk-button/);
  assert.match(html.body, /display: none !important/);

  const asset = await resources.app.inject({ method: 'GET', url: '/docs/js/scalar.js' });
  assert.equal(asset.statusCode, 200);
  assert.match(String(asset.headers['content-type']), /^application\/javascript/);
  assert.ok(asset.body.length > 100_000);
  assert.match(asset.body, /scalar-style/);

  const json = await resources.app.inject({ method: 'GET', url: '/docs/openapi.json' });
  assert.equal(json.statusCode, 200);
  assert.match(String(json.headers['content-type']), /^application\/json/);
  assert.deepEqual(json.json().paths, openApiDocument.paths);

  const yaml = await resources.app.inject({ method: 'GET', url: '/docs/openapi.yaml' });
  assert.equal(yaml.statusCode, 200);
  assert.match(String(yaml.headers['content-type']), /^application\/yaml/);
  assert.match(yaml.body, /openapi: 3\.0\.3/);
  assert.match(yaml.body, /\/songs\/\{id\}\/audio/);
});

test('legacy minimal lyrics input is normalized and validates as the response schema', async () => {
  resources.db.prepare(`
    INSERT INTO songs (id, title, artist, album, duration_seconds, file_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('song-1', 'First Song', 'The Artist', 'The Album', 4.25, 'first.m4a');

  const payload = {
    schemaVersion: 1,
    language: 'en',
    lines: [{
      text: 'First Song',
      startMs: 0,
      endMs: 2000,
      words: [
        { text: 'First', startMs: 0 },
        { text: 'Song', startMs: 900, endMs: null },
      ],
    }],
  };
  const document = await dereferencedDocument();
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  assertValid(ajv, document.components.schemas.LyricsPayload, payload, 'legacy lyrics input');

  const saved = await resources.app.inject({ method: 'PUT', url: '/songs/song-1/lyrics', payload });
  assert.equal(saved.statusCode, 200);
  const normalized = saved.json();
  assert.deepEqual(normalized.lines, [{
    id: 'line-1',
    text: 'First Song',
    startMs: 0,
    endMs: 2000,
    words: [
      { id: 'line-1-word-1', text: 'First', startMs: 0 },
      { id: 'line-1-word-2', text: 'Song', startMs: 900 },
    ],
  }]);
  assert.equal(normalized.songId, 'song-1');
  assert.equal(normalized.audioSha256, null);
  assert.equal(normalized.reviewStatus, 'complete');
  assertValid(ajv, document.components.schemas.LyricsDocument, normalized, 'normalized lyrics response');

  const loaded = await resources.app.inject({ method: 'GET', url: '/songs/song-1/lyrics' });
  assert.equal(loaded.statusCode, 200);
  assertValid(ajv, responseSchema(document, '/songs/{id}/lyrics', 'get', '200'), loaded.json(), 'loaded lyrics response');

  const song = await resources.app.inject({ method: 'GET', url: '/songs/song-1' });
  assertValid(ajv, responseSchema(document, '/songs/{id}', 'get', '200'), song.json(), 'song response');
  const songs = await resources.app.inject({ method: 'GET', url: '/songs' });
  assertValid(ajv, responseSchema(document, '/songs', 'get', '200'), songs.json(), 'song list response');
});

test('search query errors and audio range headers match the documented schemas', async () => {
  const document = await dereferencedDocument();
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const invalidQuerySchema = responseSchema(document, '/api/v1/import/search', 'get', '400');
  for (const url of ['/api/v1/import/search', '/api/v1/import/search?q=', '/api/v1/import/search?q=one&q=two']) {
    const response = await resources.app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().error.code, 'INVALID_QUERY');
    assertValid(ajv, invalidQuerySchema, response.json(), `${url} error response`);
  }

  await writeFile(join(root, 'audio', 'first.m4a'), Buffer.from('abcdefghijklmnopqrstuvwxyz', 'ascii'));
  resources.db.prepare(`
    INSERT INTO songs (id, title, artist, album, duration_seconds, file_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('song-1', 'First Song', 'The Artist', 'The Album', 4.25, 'first.m4a');

  const partial = await resources.app.inject({
    method: 'GET', url: '/songs/song-1/audio', headers: { range: 'bytes=2-5' },
  });
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.headers['content-range'], 'bytes 2-5/26');
  assertValid(ajv, document.components.headers.ContentRange!.schema, partial.headers['content-range'], '206 Content-Range');

  const unsatisfiable = await resources.app.inject({
    method: 'GET', url: '/songs/song-1/audio', headers: { range: 'bytes=26-30' },
  });
  assert.equal(unsatisfiable.statusCode, 416);
  assert.equal(unsatisfiable.headers['content-range'], 'bytes */26');
  assertValid(ajv, document.components.headers.UnsatisfiableContentRange!.schema, unsatisfiable.headers['content-range'], '416 Content-Range');
  const pattern = String((openApiDocument.components.headers.UnsatisfiableContentRange!.schema as { pattern?: unknown }).pattern);
  assert.equal(new RegExp(pattern).test('bytes */26'), true);
  assert.equal(new RegExp(pattern).test('bytes /26'), false);
});
