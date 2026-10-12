#!/usr/bin/env node
/** Production build: main + preload bundles, then the Angular renderer. */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { options: mainOptions } = await import('../packages/main/esbuild.config.mjs');
const { options: preloadOptions } = await import('../packages/preload/esbuild.config.mjs');

await Promise.all([build(mainOptions), build(preloadOptions)]);

const ng = spawnSync(resolve(root, 'node_modules/.bin/ng'), ['build'], {
  cwd: resolve(root, 'packages/renderer'),
  stdio: 'inherit',
});
if (ng.status !== 0) process.exit(ng.status ?? 1);
