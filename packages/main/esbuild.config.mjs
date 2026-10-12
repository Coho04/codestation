import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

/**
 * CJS output: the Electron main process loads `main.cjs` directly. Native
 * modules and `electron` itself stay external — they are resolved from
 * node_modules at runtime, already rebuilt against the Electron ABI.
 */
export const options = {
  entryPoints: [resolve(here, 'src/main.ts')],
  outfile: resolve(here, 'dist/main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  // electron-updater stays external and is imported dynamically, so a build
  // that cannot install itself never loads it.
  external: ['electron', 'node-pty', 'better-sqlite3', 'electron-updater'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    // Substituted here on purpose: whether the app may replace its own
    // bundle follows from how it was signed, which is a build-time fact.
    'process.env.CS_AUTO_UPDATE': JSON.stringify(process.env.CS_AUTO_UPDATE ?? ''),
  },
  alias: { '@cs/shared': resolve(root, 'packages/shared/src/index.ts') },
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else if (import.meta.url === `file://${process.argv[1]}`) {
  await build(options);
}
