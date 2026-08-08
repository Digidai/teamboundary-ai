import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const dist = resolve(root, 'dist');

if (basename(dist) !== 'dist' || dirname(dist) !== root) {
  throw new Error('Refusing to clean an unexpected build output path.');
}

await rm(dist, { recursive: true, force: true });
console.log('Removed the exact generated dist directory.');
