#!/usr/bin/env node

import { readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const [directoryArgument, ...options] = process.argv.slice(2);
if (directoryArgument === undefined) {
  console.error('Usage: node scripts/retain-backups.mjs DIRECTORY [--keep N]');
  process.exit(2);
}

const keepIndex = options.indexOf('--keep');
const keep = keepIndex < 0 ? 5 : Number(options[keepIndex + 1]);
if (!Number.isInteger(keep) || keep <= 0) {
  console.error('--keep must be a positive integer');
  process.exit(2);
}

const directory = resolve(directoryArgument);
const entries = await readdir(directory, { withFileTypes: true });
const backups = entries
  .filter((entry) => entry.isFile() && /^songstreamer-.*\.sqlite$/.test(entry.name))
  .sort((left, right) => right.name.localeCompare(left.name));

for (const entry of backups.slice(keep)) {
  await rm(resolve(directory, entry.name));
  console.log(`Removed ${entry.name}`);
}
console.log(`Retained ${Math.min(keep, backups.length)} backup(s) in ${directory}`);
