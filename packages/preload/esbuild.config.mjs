import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

/**
 * CJS is mandatory here: ESM preload scripts remain a source of subtle
 * failures in sandboxed renderers.
 */
export const options = {
  entryPoints: [resolve(here, 'src/preload.ts')],
  outfile: resolve(here, 'dist/preload.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
  alias: { '@cs/shared': resolve(root, 'packages/shared/src/index.ts') },
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else if (import.meta.url === `file://${process.argv[1]}`) {
  await build(options);
}
