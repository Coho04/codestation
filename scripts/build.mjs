#!/usr/bin/env node
/** Production build: main, preload and indexer bundles, then the Angular renderer. */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { options: mainOptions } = await import('../packages/main/esbuild.config.mjs');
const { options: preloadOptions } = await import('../packages/preload/esbuild.config.mjs');
// The indexer is a separate bundle because utilityProcess.fork needs a real
// file on disk, not a module inside the main bundle. Leaving it out of this
// script produced an app that started, rendered and silently never indexed
// anything -- the kind of failure that only shows up on a clean checkout.
const { options: indexerOptions } = await import('../packages/indexer/esbuild.config.mjs');

await Promise.all([build(mainOptions), build(preloadOptions), build(indexerOptions)]);

const ng = spawnSync(resolve(root, 'node_modules/.bin/ng'), ['build'], {
  cwd: resolve(root, 'packages/renderer'),
  stdio: 'inherit',
});
if (ng.status !== 0) process.exit(ng.status ?? 1);

// Assert what the app will look for at runtime. Each of these is loaded by path
// rather than imported, so a missing one is not a build error but a feature
// that quietly does nothing.
const required = [
  'packages/main/dist/main.cjs',
  'packages/preload/dist/preload.cjs',
  'packages/indexer/dist/indexer.cjs',
  'packages/renderer/dist/renderer/browser/index.html',
];
const missing = required.filter((path) => !existsSync(resolve(root, path)));
if (missing.length > 0) {
  console.error(`build incomplete, missing:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
