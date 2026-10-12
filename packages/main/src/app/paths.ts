import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Resolves a file that must exist as a real file on disk.
 *
 * Most of the app is read through Electron's asar shim and never notices the
 * archive. `utilityProcess.fork` does not go through that shim — it spawns an OS
 * process — so its entry point has to be unpacked. In a dev build both paths are
 * the same file, which is exactly why this only breaks once packaged.
 */
export function resolveUnpacked(appPath: string, relative: string): string {
  const packed = join(appPath, relative);
  if (appPath.includes('app.asar')) {
    const unpacked = join(appPath.replace('app.asar', 'app.asar.unpacked'), relative);
    if (existsSync(unpacked)) return unpacked;
  }
  return packed;
}

export const indexerEntryPath = (appPath: string): string =>
  resolveUnpacked(appPath, 'packages/indexer/dist/indexer.cjs');
