import type { UpdateMode } from '@cs/shared';

/**
 * Which update mode this build was compiled for.
 *
 * `process.env.CS_AUTO_UPDATE` is substituted by esbuild at build time (see
 * packages/main/esbuild.config.mjs) — it is *not* read from the environment at
 * runtime, and deliberately so: whether the app can replace its own bundle is a
 * property of how it was signed, not of how it was started. Setting it on a
 * locally signed build would only produce a Squirrel.Mac signature error at the
 * worst possible moment.
 *
 * The release workflow sets it exactly when it has a Developer-ID certificate
 * and notarization credentials.
 */
export function resolveUpdateMode(isPackaged: boolean): UpdateMode {
  // A dev run has no bundle to replace and no version worth comparing.
  if (!isPackaged) return 'disabled';
  return process.env['CS_AUTO_UPDATE'] === '1' ? 'auto' : 'manual';
}
